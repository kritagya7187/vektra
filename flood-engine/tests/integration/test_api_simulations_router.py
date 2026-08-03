"""Integration tests for flood_engine.api.routers.simulations, against a real database.

Placed under tests/integration/ per this project's own established
preference for real verification over elaborate mocking wherever
feasible (see e.g. tests/unit/persistence/test_repository.py's own
docstring) -- exercises every route through FastAPI's real TestClient
against a real, disposable PostgreSQL instance, the same convention
``test_postgres_job_repository.py``/``test_end_to_end.py`` already use.
``get_repository`` is overridden via FastAPI's own ``dependency_overrides``
mechanism to point at that disposable database, rather than requiring
real ``POSTGRES_*`` environment variables to be set for every test run.

**Requires a reachable test database.** Skipped entirely, not failed, if
unreachable -- same convention as every other real-database test file.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg_pool import ConnectionPool

from flood_engine.api.app import create_app
from flood_engine.api.dependencies import get_repository
from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.core.state import MassLedger
from flood_engine.output.generator import FloodOutputSummary
from flood_engine.persistence.repository import PostgresJobRepository
from flood_engine.persistence.schema import ensure_schema
from flood_engine.persistence.serialization import write_array

TEST_DB_HOST = os.environ.get("FLOOD_ENGINE_TEST_DB_HOST", "localhost")
TEST_DB_PORT = int(os.environ.get("FLOOD_ENGINE_TEST_DB_PORT", "55432"))
TEST_DB_NAME = os.environ.get("FLOOD_ENGINE_TEST_DB_NAME", "flood_engine_test")
TEST_DB_USER = os.environ.get("FLOOD_ENGINE_TEST_DB_USER", "postgres")
TEST_DB_PASSWORD = os.environ.get("FLOOD_ENGINE_TEST_DB_PASSWORD", "test_password")

SHAPE = (2, 2)


def _test_db_reachable() -> bool:
    try:
        conn = psycopg.connect(
            host=TEST_DB_HOST,
            port=TEST_DB_PORT,
            dbname=TEST_DB_NAME,
            user=TEST_DB_USER,
            password=TEST_DB_PASSWORD,
            connect_timeout=2,
        )
        conn.close()
    except psycopg.OperationalError:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _test_db_reachable(),
    reason=(
        "No reachable test PostgreSQL instance -- see test_postgres_job_repository.py's "
        "own docstring for how to start one."
    ),
)


@pytest.fixture
def pool() -> Iterator[ConnectionPool]:
    conninfo = (
        f"host={TEST_DB_HOST} port={TEST_DB_PORT} dbname={TEST_DB_NAME} "
        f"user={TEST_DB_USER} password={TEST_DB_PASSWORD}"
    )
    connection_pool = ConnectionPool(conninfo=conninfo, min_size=1, max_size=5, open=True)
    with connection_pool.connection() as conn:
        ensure_schema(conn)
        conn.execute("TRUNCATE flood_simulation_output, flood_simulation_run")
        conn.commit()
    yield connection_pool
    connection_pool.close()


@pytest.fixture
def repository(pool: ConnectionPool, tmp_path: Path) -> PostgresJobRepository:
    return PostgresJobRepository(pool, output_storage_dir=tmp_path / "output")


@pytest.fixture
def client(repository: PostgresJobRepository) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_repository] = lambda: repository
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _stage_arrays(tmp_path: Path, name: str) -> dict[str, str]:
    array_dir = tmp_path / name
    array_dir.mkdir(exist_ok=True)
    paths = {
        "elevation_path": array_dir / "elevation.npy",
        "building_mask_path": array_dir / "building_mask.npy",
        "manning_n_path": array_dir / "manning_n.npy",
        "infiltration_loss_path": array_dir / "infiltration.npy",
        "rainfall_rates_path": array_dir / "rainfall.npy",
    }
    write_array(np.full(SHAPE, 10.0), paths["elevation_path"])
    write_array(np.zeros(SHAPE), paths["building_mask_path"])
    write_array(np.full(SHAPE, 0.03), paths["manning_n_path"])
    write_array(np.zeros(SHAPE), paths["infiltration_loss_path"])
    write_array(np.array([5.0]), paths["rainfall_rates_path"])
    return {key: str(value) for key, value in paths.items()}


class TestSubmitSimulation:
    def test_submits_and_returns_pending(self, client: TestClient, tmp_path: Path) -> None:
        paths = _stage_arrays(tmp_path, "submit")

        response = client.post(
            "/api/v1/simulations", json={"scenario_id": "scenario-1", **paths}
        )

        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "pending"
        assert body["run_id"]

    def test_missing_required_field_returns_422(self, client: TestClient) -> None:
        response = client.post("/api/v1/simulations", json={"scenario_id": "scenario-1"})

        assert response.status_code == 422

    def test_solver_parameter_override_is_accepted_and_stored(
        self, client: TestClient, tmp_path: Path, repository: PostgresJobRepository
    ) -> None:
        paths = _stage_arrays(tmp_path, "override")

        response = client.post(
            "/api/v1/simulations",
            json={
                "scenario_id": "scenario-1",
                **paths,
                "solver_parameters": {"alpha": 0.7},
            },
        )

        assert response.status_code == 202
        run_id = response.json()["run_id"]
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None
        assert job.run_id == run_id
        assert job.solver_parameters == SolverParameters(alpha=0.7)


class TestGetSimulationStatus:
    def test_returns_404_for_unknown_run(self, client: TestClient) -> None:
        response = client.get("/api/v1/simulations/00000000-0000-0000-0000-000000000000")

        assert response.status_code == 404

    def test_returns_pending_status_after_submission(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        paths = _stage_arrays(tmp_path, "status")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]

        response = client.get(f"/api/v1/simulations/{run_id}")

        assert response.status_code == 200
        body = response.json()
        assert body["run_id"] == run_id
        assert body["status"] == "pending"
        assert body["started_at"] is None

    def test_reflects_running_status_after_claim(
        self, client: TestClient, tmp_path: Path, repository: PostgresJobRepository
    ) -> None:
        paths = _stage_arrays(tmp_path, "running")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None

        response = client.get(f"/api/v1/simulations/{run_id}")

        assert response.status_code == 200
        assert response.json()["status"] == "running"


def _submit_and_complete(
    client: TestClient, repository: PostgresJobRepository, tmp_path: Path, name: str
) -> str:
    paths = _stage_arrays(tmp_path, name)
    submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
    run_id: str = submit.json()["run_id"]
    job = repository.claim_next_pending(max_concurrent_runs=1)
    assert job is not None
    summary = FloodOutputSummary(
        max_depth_m=np.array([[0.1, 0.2], [0.3, 0.4]]),
        arrival_time_min=np.full(SHAPE, np.nan),
        duration_above_threshold_min=np.zeros(SHAPE),
        mass_ledger=MassLedger(
            rainfall_input_m3=10.0, infiltration_loss_m3=2.0, boundary_outflow_m3=1.0
        ),
        step_count=5,
        simulated_duration_s=300.0,
    )
    repository.mark_completed(run_id, summary)
    return run_id


class TestGetSimulationSummary:
    def test_returns_404_for_unknown_run(self, client: TestClient) -> None:
        response = client.get(
            "/api/v1/simulations/00000000-0000-0000-0000-000000000000/summary"
        )

        assert response.status_code == 404

    def test_returns_409_when_still_pending(self, client: TestClient, tmp_path: Path) -> None:
        paths = _stage_arrays(tmp_path, "summary-pending")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]

        response = client.get(f"/api/v1/simulations/{run_id}/summary")

        assert response.status_code == 409

    def test_returns_the_real_summary_when_completed_with_no_recomputation(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id = _submit_and_complete(client, repository, tmp_path, "summary-completed")

        response = client.get(f"/api/v1/simulations/{run_id}/summary")

        assert response.status_code == 200
        body = response.json()
        assert body["max_depth_m"] == [[0.1, 0.2], [0.3, 0.4]]
        assert body["mass_ledger"]["rainfall_input_m3"] == 10.0
        assert body["mass_ledger"]["infiltration_loss_m3"] == 2.0
        assert body["mass_ledger"]["boundary_outflow_m3"] == 1.0
        assert body["step_count"] == 5
        assert body["simulated_duration_s"] == 300.0
        # arrival_time_min is all-NaN in the fixture -- JSON has no NaN,
        # must round-trip as null, never a fabricated number.
        assert body["arrival_time_min"] == [[None, None], [None, None]]


class TestDownloadSimulationArtifact:
    def test_returns_404_for_unknown_run(self, client: TestClient) -> None:
        response = client.get(
            "/api/v1/simulations/00000000-0000-0000-0000-000000000000/download/max-depth"
        )

        assert response.status_code == 404

    def test_returns_409_when_not_completed(self, client: TestClient, tmp_path: Path) -> None:
        paths = _stage_arrays(tmp_path, "download-pending")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]

        response = client.get(f"/api/v1/simulations/{run_id}/download/max-depth")

        assert response.status_code == 409

    def test_streams_the_real_npy_file(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id = _submit_and_complete(client, repository, tmp_path, "download-completed")

        response = client.get(f"/api/v1/simulations/{run_id}/download/max-depth")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/octet-stream"
        # A real .npy file: starts with the numpy magic string.
        assert response.content.startswith(b"\x93NUMPY")

    def test_invalid_artifact_name_returns_422(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id = _submit_and_complete(client, repository, tmp_path, "download-invalid")

        response = client.get(f"/api/v1/simulations/{run_id}/download/not-a-real-artifact")

        assert response.status_code == 422


class TestCancelSimulation:
    def test_returns_404_for_unknown_run(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/simulations/00000000-0000-0000-0000-000000000000/cancel"
        )

        assert response.status_code == 404

    def test_cancels_a_pending_run(self, client: TestClient, tmp_path: Path) -> None:
        paths = _stage_arrays(tmp_path, "cancel-pending")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]

        response = client.post(f"/api/v1/simulations/{run_id}/cancel")

        assert response.status_code == 200
        assert response.json()["status"] == "cancelled"

    def test_returns_409_when_already_running(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_arrays(tmp_path, "cancel-running")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None

        response = client.post(f"/api/v1/simulations/{run_id}/cancel")

        assert response.status_code == 409

    def test_cancelled_run_is_never_claimed(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_arrays(tmp_path, "cancel-then-claim")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]
        client.post(f"/api/v1/simulations/{run_id}/cancel")

        job = repository.claim_next_pending(max_concurrent_runs=1)

        assert job is None


class TestTimesteppingParameterOverride:
    def test_timestepping_parameter_override_is_accepted_and_stored(
        self, client: TestClient, tmp_path: Path, repository: PostgresJobRepository
    ) -> None:
        from flood_engine.core.timestepping import TimesteppingParameters

        paths = _stage_arrays(tmp_path, "timestepping-override")

        response = client.post(
            "/api/v1/simulations",
            json={
                "scenario_id": "scenario-1",
                **paths,
                "timestepping_parameters": {"infiltration_interval_s": 120.0},
            },
        )

        assert response.status_code == 202
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None
        assert job.timestepping_parameters == TimesteppingParameters(infiltration_interval_s=120.0)


class TestPersistenceErrorHandling:
    """A closed connection pool simulates a real database-unavailable condition mid-request."""

    def test_submit_returns_500_when_the_database_is_unavailable(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_arrays(tmp_path, "db-down-submit")
        repository._pool.close()

        response = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})

        assert response.status_code == 500

    def test_get_status_returns_500_when_the_database_is_unavailable(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_arrays(tmp_path, "db-down-status")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]
        repository._pool.close()

        response = client.get(f"/api/v1/simulations/{run_id}")

        assert response.status_code == 500

    def test_get_summary_returns_500_when_the_database_is_unavailable(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_arrays(tmp_path, "db-down-summary")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]
        repository._pool.close()

        response = client.get(f"/api/v1/simulations/{run_id}/summary")

        assert response.status_code == 500

    def test_download_returns_500_when_the_database_is_unavailable(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_arrays(tmp_path, "db-down-download")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]
        repository._pool.close()

        response = client.get(f"/api/v1/simulations/{run_id}/download/max-depth")

        assert response.status_code == 500

    def test_cancel_returns_500_when_the_database_is_unavailable(
        self, client: TestClient, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_arrays(tmp_path, "db-down-cancel")
        submit = client.post("/api/v1/simulations", json={"scenario_id": "s1", **paths})
        run_id = submit.json()["run_id"]
        repository._pool.close()

        response = client.post(f"/api/v1/simulations/{run_id}/cancel")

        assert response.status_code == 500


class TestInternalConsistencyDefensiveBranches:
    """Manufactured inconsistencies a correct system never produces on its own.

    Verifies the router fails loudly (500), never silently, if the
    database is ever found in one of these states -- reachable only by
    directly tampering with persisted state after the fact, exactly as
    each test below does.
    """

    def test_summary_returns_500_if_the_output_row_is_missing_despite_completed_status(
        self,
        client: TestClient,
        repository: PostgresJobRepository,
        pool: ConnectionPool,
        tmp_path: Path,
    ) -> None:
        run_id = _submit_and_complete(client, repository, tmp_path, "missing-output-row")
        with pool.connection() as conn:
            conn.execute("DELETE FROM flood_simulation_output WHERE run_id = %s", (run_id,))
            conn.commit()

        response = client.get(f"/api/v1/simulations/{run_id}/summary")

        assert response.status_code == 500

    def test_download_returns_500_if_the_output_row_is_missing_despite_completed_status(
        self,
        client: TestClient,
        repository: PostgresJobRepository,
        pool: ConnectionPool,
        tmp_path: Path,
    ) -> None:
        run_id = _submit_and_complete(client, repository, tmp_path, "missing-output-row-dl")
        with pool.connection() as conn:
            conn.execute("DELETE FROM flood_simulation_output WHERE run_id = %s", (run_id,))
            conn.commit()

        response = client.get(f"/api/v1/simulations/{run_id}/download/max-depth")

        assert response.status_code == 500

    def test_download_returns_500_if_the_npy_file_is_missing_from_disk(
        self,
        client: TestClient,
        repository: PostgresJobRepository,
        pool: ConnectionPool,
        tmp_path: Path,
    ) -> None:
        run_id = _submit_and_complete(client, repository, tmp_path, "missing-npy-file")
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT max_depth_location FROM flood_simulation_output WHERE run_id = %s",
                (run_id,),
            ).fetchone()
        assert row is not None
        Path(row[0]).unlink()

        response = client.get(f"/api/v1/simulations/{run_id}/download/max-depth")

        assert response.status_code == 500


class TestGetRepositoryDependency:
    """The real, un-overridden get_repository() -- config -> pool -> ensure_schema -> repository."""

    def test_builds_a_real_working_repository_against_the_real_database(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        from flood_engine.api.dependencies import get_repository

        monkeypatch.setenv("POSTGRES_HOST", TEST_DB_HOST)
        monkeypatch.setenv("POSTGRES_PORT", str(TEST_DB_PORT))
        monkeypatch.setenv("POSTGRES_DB", TEST_DB_NAME)
        monkeypatch.setenv("POSTGRES_USER", TEST_DB_USER)
        monkeypatch.setenv("POSTGRES_PASSWORD", TEST_DB_PASSWORD)
        monkeypatch.setenv("FLOOD_OUTPUT_STORAGE_DIR", str(tmp_path / "output"))
        monkeypatch.setenv("RASTER_STORAGE_DIR", str(tmp_path))
        get_repository.cache_clear()

        try:
            repository = get_repository()
            try:
                paths = _stage_arrays(tmp_path, "real-dependency")
                run_id = repository.enqueue(
                    scenario_id="s1",
                    elevation_path=paths["elevation_path"],
                    building_mask_path=paths["building_mask_path"],
                    manning_n_path=paths["manning_n_path"],
                    infiltration_loss_path=paths["infiltration_loss_path"],
                    rainfall_rates_path=paths["rainfall_rates_path"],
                )
                job = repository.claim_next_pending(max_concurrent_runs=1)
                assert job is not None
                assert job.run_id == run_id
            finally:
                repository.close()
        finally:
            get_repository.cache_clear()
