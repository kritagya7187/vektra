"""api.routers.simulations: the Step 19 job-lifecycle HTTP surface.

Pure orchestration -- every route calls exactly one already-frozen
persistence operation (``enqueue``/``read_run``/``read_completed_output``/
``read_output_locations``/``mark_cancelled``) and translates its result to
an HTTP response. No route ever calls ``core.solver``, ``core.timestepping``,
or ``simulation.controller`` directly -- matching the frozen architecture's
"FastAPI never executes a simulation itself" rule (``jobs/worker.py``'s own
docstring, Decision 2): the async job queue (Step 16), not this process,
is what eventually runs a submitted job.

Endpoint shape is a direct, disclosed departure from SDS Section 8's
original (pre-Step-17) sketch, which assumed a ``flood_scenario`` object
that still does not exist (``flood_engine.scenario`` remains a stub) --
building that abstraction is its own future step, not something this
router invents a workaround for. Instead, submission mirrors
``PostgresJobRepository.enqueue()``'s real, current, frozen shape exactly
(a scenario id plus five already-prepared array file paths), per the
Step 19 architecture-verification resolution recorded in ``VALIDATION.md``.
"""

from pathlib import Path
from typing import Annotated, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from flood_engine.api.dependencies import get_repository
from flood_engine.api.schemas.jobs import (
    SimulationRunStatusResponse,
    SubmitSimulationRequest,
    SubmitSimulationResponse,
)
from flood_engine.api.schemas.simulation import FloodOutputSummarySchema
from flood_engine.jobs.models import JobStatus
from flood_engine.logging_config import LogSubsystem, get_logger
from flood_engine.persistence.repository import (
    IllegalTransitionError,
    PersistenceError,
    PostgresJobRepository,
    read_completed_output,
    read_output_locations,
    read_run,
)

logger = get_logger(LogSubsystem.API, "simulations")

router = APIRouter(prefix="/api/v1/simulations", tags=["simulations"])

RepositoryDep = Annotated[PostgresJobRepository, Depends(get_repository)]

_ARTIFACT_ATTRIBUTES: dict[str, str] = {
    "max-depth": "max_depth_location",
    "arrival-time": "arrival_time_location",
    "duration-above-threshold": "duration_above_threshold_location",
}
"""URL-facing artifact names -> SimulationOutputRow attribute names.

Kebab-case in the URL (REST convention for path segments) mapped to the
domain type's own snake_case field names -- a naming-convention
translation only, not a new concept.
"""


@router.post("", status_code=202, response_model=SubmitSimulationResponse)
def submit_simulation(
    request: SubmitSimulationRequest, repository: RepositoryDep
) -> SubmitSimulationResponse:
    """Enqueue a new simulation run. Returns immediately with status ``pending``.

    202 Accepted, not 201 Created: the run record is created immediately,
    but the resource this endpoint is "about" (a completed simulation) is
    not yet ready -- 202 is the standard HTTP status for "request
    accepted for asynchronous processing," matching the frozen
    architecture's own async job-queue design exactly.
    """
    try:
        run_id = repository.enqueue(
            scenario_id=request.scenario_id,
            elevation_path=request.elevation_path,
            building_mask_path=request.building_mask_path,
            manning_n_path=request.manning_n_path,
            infiltration_loss_path=request.infiltration_loss_path,
            rainfall_rates_path=request.rainfall_rates_path,
            solver_parameters=request.solver_parameters.to_domain()
            if request.solver_parameters
            else None,
            timestepping_parameters=request.timestepping_parameters.to_domain()
            if request.timestepping_parameters
            else None,
            aoi_bounds_wgs84=request.aoi_bounds_wgs84,
        )
    except (PersistenceError, psycopg.Error) as exc:
        logger.exception("Failed to enqueue simulation")
        raise HTTPException(status_code=500, detail="Failed to enqueue simulation.") from exc

    return SubmitSimulationResponse(run_id=run_id, status=JobStatus.PENDING)


@router.get("/{run_id}", response_model=SimulationRunStatusResponse)
def get_simulation_status(run_id: str, repository: RepositoryDep) -> SimulationRunStatusResponse:
    """Retrieve a run's current lifecycle status. The database is the source of truth."""
    try:
        with repository._pool.connection() as conn:
            row = read_run(conn, run_id)
    except (PersistenceError, psycopg.Error) as exc:
        logger.exception("Failed to read simulation status", extra={"run_id": run_id})
        raise HTTPException(status_code=500, detail="Failed to read simulation status.") from exc

    if row is None:
        raise HTTPException(status_code=404, detail=f"No simulation run found with id {run_id!r}.")
    return SimulationRunStatusResponse.from_domain(row)


@router.get("/{run_id}/summary", response_model=FloodOutputSummarySchema)
def get_simulation_summary(run_id: str, repository: RepositoryDep) -> FloodOutputSummarySchema:
    """Retrieve a completed run's output summary.

    404 if the run does not exist at all; 409 if it exists but has not
    reached ``completed`` yet (the summary genuinely does not exist yet,
    which is a state conflict, not a missing resource) -- distinguishing
    these two is exactly what a caller needs to decide whether to keep
    polling (409) or stop (404).
    """
    try:
        with repository._pool.connection() as conn:
            status_row = read_run(conn, run_id)
            if status_row is None:
                raise HTTPException(
                    status_code=404, detail=f"No simulation run found with id {run_id!r}."
                )
            if status_row.status is not JobStatus.COMPLETED:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Simulation run {run_id!r} is {status_row.status.value!r}, "
                        "not completed -- no summary is available yet."
                    ),
                )
            summary = read_completed_output(conn, run_id)
    except (PersistenceError, psycopg.Error) as exc:
        logger.exception("Failed to read simulation summary", extra={"run_id": run_id})
        raise HTTPException(status_code=500, detail="Failed to read simulation summary.") from exc

    if summary is None:
        # Status says completed but no output row exists -- an internal
        # inconsistency (mark_completed writes both in one transaction),
        # never the caller's fault.
        logger.error(
            "Run marked completed but no output row exists", extra={"run_id": run_id}
        )
        raise HTTPException(status_code=500, detail="Simulation output is missing.")
    return FloodOutputSummarySchema.from_domain(summary)


@router.get("/{run_id}/download/{artifact}")
def download_simulation_artifact(
    run_id: str, artifact: Literal["max-depth", "arrival-time", "duration-above-threshold"],
    repository: RepositoryDep,
) -> FileResponse:
    """Stream one raw ``.npy`` output array directly from disk.

    Distinct from ``/summary``: this streams the real file
    ``persistence.serialization.write_array`` wrote, not a JSON-serialized
    copy of its contents -- for a caller that wants the raw array (e.g.
    to hand off to a raster-rendering pipeline) without the
    list-of-lists JSON inflation ``FloodOutputSummarySchema`` requires.
    """
    try:
        with repository._pool.connection() as conn:
            status_row = read_run(conn, run_id)
            if status_row is None:
                raise HTTPException(
                    status_code=404, detail=f"No simulation run found with id {run_id!r}."
                )
            if status_row.status is not JobStatus.COMPLETED:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Simulation run {run_id!r} is {status_row.status.value!r}, "
                        "not completed -- no output is available yet."
                    ),
                )
            locations = read_output_locations(conn, run_id)
    except (PersistenceError, psycopg.Error) as exc:
        logger.exception("Failed to read output locations", extra={"run_id": run_id})
        raise HTTPException(status_code=500, detail="Failed to read output locations.") from exc

    if locations is None:
        logger.error(
            "Run marked completed but no output row exists", extra={"run_id": run_id}
        )
        raise HTTPException(status_code=500, detail="Simulation output is missing.")

    attribute_name = _ARTIFACT_ATTRIBUTES[artifact]
    file_path = Path(getattr(locations, attribute_name))
    if not file_path.exists():
        logger.error(
            "Output array file is missing from disk",
            extra={"run_id": run_id, "path": str(file_path)},
        )
        raise HTTPException(status_code=500, detail="Output array file is missing from disk.")
    return FileResponse(
        path=file_path,
        media_type="application/octet-stream",
        filename=f"{run_id}-{artifact}.npy",
    )


@router.post("/{run_id}/cancel", response_model=SimulationRunStatusResponse)
def cancel_simulation(run_id: str, repository: RepositoryDep) -> SimulationRunStatusResponse:
    """Cancel a pending run. Only a ``pending`` run can be cancelled.

    Matches ``jobs.worker.cancel_pending_job``'s own frozen semantics
    exactly (this route is the first real HTTP path ever built to reach
    it -- that function's own docstring anticipated this: "No HTTP path
    reaches this function anywhere in this codebase"). A ``running`` job
    cannot be safely interrupted (no cancellation checkpoint exists in
    the frozen synchronous controller call) -- attempting to cancel one
    is a real state conflict, 409, not silently accepted or a 404.
    """
    try:
        with repository._pool.connection() as conn:
            status_row = read_run(conn, run_id)
        if status_row is None:
            raise HTTPException(
                status_code=404, detail=f"No simulation run found with id {run_id!r}."
            )
        repository.mark_cancelled(run_id)
    except IllegalTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (PersistenceError, psycopg.Error) as exc:
        logger.exception("Failed to cancel simulation", extra={"run_id": run_id})
        raise HTTPException(status_code=500, detail="Failed to cancel simulation.") from exc

    with repository._pool.connection() as conn:
        row = read_run(conn, run_id)
    if row is None:  # pragma: no cover -- cannot happen: mark_cancelled() above already succeeded
        logger.error("Run disappeared immediately after being cancelled", extra={"run_id": run_id})
        raise HTTPException(status_code=500, detail="Simulation run is missing after cancel.")
    return SimulationRunStatusResponse.from_domain(row)


__all__ = ["router"]
