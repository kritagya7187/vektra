"""api.app: the FastAPI application shell (Step 15) and route registration (Step 19).

Step 15 built the shell and its exception-handling infrastructure with
zero routes -- every endpoint needed persistence (Step 17) or the async
job queue (Step 16), neither of which existed yet. Both now exist; Step
19's own architecture verification confirmed this was the one remaining
blocker for real Node-backend integration, and resolved it by building
the job-lifecycle routes in ``api.routers.simulations`` (see that
module's own docstring, and ``VALIDATION.md``, for the full resolution).

**Exception handlers cover exactly the exceptions
:func:`~flood_engine.simulation.controller.run` can raise** (its own
docstring's ``Raises`` section, unchanged, is the source of truth here):
``WCA2DError``/``TimesteppingError`` (invalid caller input -- HTTP 400,
with the specific validation message, since the client can act on it) and
``SimulationControllerError`` (an internal invariant violation, not
anything the client did wrong -- HTTP 500, with a generic message; the
full diagnostic detail is logged server-side only, never returned in the
response). A catch-all handler covers anything else, logged with its full
traceback and returned as a generic HTTP 500 -- "never expose stack
traces" applies to the response body, not the server-side log. No handler
is registered for ``SolverStateError``: the controller's own initial state
is always constructed as an all-zero array, which
:class:`~flood_engine.core.state.SolverState` can never reject, so that
exception cannot actually propagate through the only entry point this
layer is allowed to call.

**Logging configuration is deliberately not called here.**
:func:`~flood_engine.logging_config.configure_logging`'s own docstring is
explicit: "called once at process startup... not re-invoked per request or
per run." ``create_app()`` is a factory precisely because it *can* be
called more than once (by tests, in particular) -- calling a "once per
process" function from inside it would contradict that on its own terms,
and did during this module's own development: it made merely *importing*
this module mutate global logging state as a side effect, corrupting
``caplog`` for every other test module in the same session. Configuring
logging is the responsibility of whatever real process entrypoint
eventually starts this service (deployment, out of Step 15's scope) --
this module's own loggers work via Python's normal propagation regardless,
so nothing here needs it configured to function correctly.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from flood_engine.api.routers.simulations import router as simulations_router
from flood_engine.config import APIConfig
from flood_engine.core.solver.wca2d import WCA2DError
from flood_engine.core.timestepping import TimesteppingError
from flood_engine.logging_config import LogSubsystem, get_logger
from flood_engine.simulation.controller import SimulationControllerError

logger = get_logger(LogSubsystem.API, "app")


def create_app() -> FastAPI:
    """Build a fresh FastAPI application with routes and exception handling configured.

    A factory, not a bare module-level singleton, so tests can construct
    independent app instances (e.g. to override ``get_repository`` with a
    fake, or to attach a temporary route while exercising an exception
    handler) without sharing state across tests. :data:`app` below is the
    one real callers use.

    Returns:
        A configured :class:`fastapi.FastAPI` instance with the Step 19
        job-lifecycle routes registered.
    """
    api_config = APIConfig()

    fastapi_app = FastAPI(
        title="VEKTRA Flood Engine",
        version="0.1.0",
        description=(
            "Internal HTTP service exposing the VEKTRA Stage 1 WCA2D flood "
            "simulation engine's job-submission/status/summary/download/cancel "
            "lifecycle -- called by the Node backend (Step 19), never directly "
            "by a browser."
        ),
    )
    fastapi_app.include_router(simulations_router)
    logger.info(
        "FastAPI application created",
        extra={"host": api_config.host, "port": api_config.port},
    )

    @fastapi_app.exception_handler(WCA2DError)
    async def handle_wca2d_error(request: Request, exc: WCA2DError) -> JSONResponse:
        """Invalid domain/solver input -- the caller's fault, message is actionable."""
        logger.warning(
            "Invalid solver input", extra={"path": str(request.url), "error": str(exc)}
        )
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @fastapi_app.exception_handler(TimesteppingError)
    async def handle_timestepping_error(request: Request, exc: TimesteppingError) -> JSONResponse:
        """Invalid timestepping input -- the caller's fault, message is actionable."""
        logger.warning(
            "Invalid timestepping input", extra={"path": str(request.url), "error": str(exc)}
        )
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @fastapi_app.exception_handler(SimulationControllerError)
    async def handle_simulation_controller_error(
        request: Request, exc: SimulationControllerError
    ) -> JSONResponse:
        """A run-level invariant (mass conservation) failed -- not the caller's fault.

        The full diagnostic message (final/expected storage, relative
        error, ledger breakdown) is logged server-side only; the response
        body stays generic, matching this layer's "never expose internal
        detail in a 500" discipline.
        """
        logger.error(
            "Simulation controller invariant violated",
            extra={"path": str(request.url), "error": str(exc)},
        )
        return JSONResponse(
            status_code=500, content={"detail": "Internal simulation error."}
        )

    @fastapi_app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        """Anything not covered above -- logged with its full traceback, never returned."""
        logger.exception("Unhandled exception", extra={"path": str(request.url)})
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})

    return fastapi_app


app = create_app()

__all__ = ["app", "create_app"]
