"""Unit tests for flood_engine.api.app.

The exception-handler tests below attach a temporary, test-only route to
a fresh ``create_app()`` instance to exercise one handler in isolation,
then discard it -- this never touches the real ``app`` singleton other
modules import, and does not depend on the Step 19 production routes
(covered separately, against a real database, in
``tests/integration/test_api_simulations_router.py``).

Uses plain ``caplog`` for the logging assertions: unlike an earlier version
of ``flood_engine.api.app``, ``create_app()`` no longer calls
``configure_logging()`` (see that module's docstring for why that was a
real bug, not a style choice), so this module's loggers propagate normally
and ``caplog``'s default capture works without the workaround
``test_logging_config.py`` needs for code that *does* call
``configure_logging()``.
"""

import logging

import pytest
from fastapi.testclient import TestClient

from flood_engine.api.app import create_app
from flood_engine.core.solver.wca2d import WCA2DError
from flood_engine.core.timestepping import TimesteppingError
from flood_engine.simulation.controller import SimulationControllerError


def _client_raising(exc: Exception) -> TestClient:
    test_app = create_app()

    @test_app.get("/__raise__")
    def _raise() -> None:
        raise exc

    return TestClient(test_app, raise_server_exceptions=False)


class TestWCA2DErrorHandler:
    def test_returns_400_with_the_specific_message(self) -> None:
        client = _client_raising(WCA2DError("manning_n must be strictly positive."))

        response = client.get("/__raise__")

        assert response.status_code == 400
        assert response.json() == {"detail": "manning_n must be strictly positive."}

    def test_logs_exactly_once(self, caplog: pytest.LogCaptureFixture) -> None:
        client = _client_raising(WCA2DError("bad input"))

        with caplog.at_level(logging.WARNING, logger="flood_engine.api.app"):
            client.get("/__raise__")

        matching = [r for r in caplog.records if "Invalid solver input" in r.message]
        assert len(matching) == 1


class TestTimesteppingErrorHandler:
    def test_returns_400_with_the_specific_message(self) -> None:
        client = _client_raising(
            TimesteppingError("rainfall_rates_mm_per_hr must have at least one entry.")
        )

        response = client.get("/__raise__")

        assert response.status_code == 400
        assert response.json() == {
            "detail": "rainfall_rates_mm_per_hr must have at least one entry."
        }


class TestSimulationControllerErrorHandler:
    def test_returns_500_with_a_generic_message_not_the_diagnostic_detail(self) -> None:
        client = _client_raising(
            SimulationControllerError(
                "Full-run mass conservation failed: final storage 1.0 m3, expected 2.0 m3."
            )
        )

        response = client.get("/__raise__")

        assert response.status_code == 500
        assert response.json() == {"detail": "Internal simulation error."}
        assert "final storage" not in response.text


class TestUnhandledExceptionHandler:
    def test_returns_a_generic_500_never_a_stack_trace(self) -> None:
        client = _client_raising(ValueError("something truly unexpected"))

        response = client.get("/__raise__")

        assert response.status_code == 500
        assert response.json() == {"detail": "Internal server error."}
        assert "Traceback" not in response.text
        assert "ValueError" not in response.text


class TestCreateApp:
    def test_registers_the_step_19_simulations_routes(self) -> None:
        # Step 15 registered zero routes (its own frozen scope); Step 19
        # registers exactly the job-lifecycle routes -- verified via the
        # OpenAPI schema rather than app.routes directly, since
        # include_router() wraps a sub-router as an opaque
        # _IncludedRouter with no .path attribute of its own in this
        # FastAPI version (an internal representation detail, not part
        # of any frozen contract this test should depend on).
        test_app = create_app()

        paths = set(test_app.openapi()["paths"].keys())

        assert paths == {
            "/api/v1/simulations",
            "/api/v1/simulations/{run_id}",
            "/api/v1/simulations/{run_id}/summary",
            "/api/v1/simulations/{run_id}/download/{artifact}",
            "/api/v1/simulations/{run_id}/cancel",
        }

    def test_two_instances_do_not_share_route_state(self) -> None:
        app_a = create_app()

        @app_a.get("/__only_on_a__")
        def _handler() -> dict[str, str]:
            return {"ok": "true"}

        app_b = create_app()
        paths_b = set(app_b.openapi()["paths"].keys())

        assert "/__only_on_a__" not in paths_b
