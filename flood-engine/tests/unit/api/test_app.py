"""Unit tests for flood_engine.api.app.

No production route exists yet (Step 15 registers none -- see the module
docstring), so each test attaches a temporary, test-only route to a fresh
``create_app()`` instance to exercise one exception handler in isolation,
then discards it -- this never touches the real ``app`` singleton other
modules import.

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
    def test_registers_no_application_routes(self) -> None:
        test_app = create_app()

        # Only FastAPI's own built-in docs/openapi routes exist -- no
        # application route has been registered, per Step 15's own scope.
        paths = {route.path for route in test_app.routes}
        assert paths <= {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}

    def test_two_instances_do_not_share_route_state(self) -> None:
        app_a = create_app()

        @app_a.get("/__only_on_a__")
        def _handler() -> dict[str, str]:
            return {"ok": "true"}

        app_b = create_app()
        paths_b = {route.path for route in app_b.routes}

        assert "/__only_on_a__" not in paths_b
