"""Step 18, Part B: the first complete end-to-end execution of the flood engine.

DEM -> land cover -> building raster -> roughness grid -> infiltration
grid -> rainfall forcing -> simulation controller -> output generation ->
persistence, using every frozen Steps 1-17 module plus the Step 18
additions (``core.solver.roughness``/``infiltration``, ``pipeline``) that
close the architecture-verification gap those steps left open. No
shortcut implementations, no mocked scientific calculations anywhere in
this file -- every array is produced by a real preprocessing/crosswalk
call, every simulated timestep is a real ``core.solver.wca2d.step()``
call. Persistence runs against a real, disposable PostgreSQL instance
(same convention as ``test_postgres_job_repository.py``), never mocked --
Part B's own instruction ("only persistence may be mocked where database
behavior itself is not under test") does not apply here: database
behavior (enqueue -> claim -> execute -> mark_completed -> read back) is
exactly what an end-to-end test must exercise for real.

**Requires a reachable test database** -- see
``test_postgres_job_repository.py``'s own module docstring for how to
start one. Skipped entirely, not failed, if unreachable.
"""

import os
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import psycopg
import pytest
from psycopg_pool import ConnectionPool

import flood_engine.jobs.worker as worker_module
from flood_engine.config import SimulationExecutionConfig
from flood_engine.core.solver.roughness import BARE_SPARSE_VEGETATION
from flood_engine.jobs.models import JobStatus
from flood_engine.jobs.worker import _build_repository, execute_job, main, run_worker
from flood_engine.output.generator import FloodOutputSummary, generate_summary
from flood_engine.persistence.repository import PostgresJobRepository, read_completed_output
from flood_engine.persistence.schema import ensure_schema
from flood_engine.persistence.serialization import write_array
from flood_engine.pipeline import build_simulation_inputs
from flood_engine.simulation.controller import run as run_simulation_controller
from tests.factories import (
    buildings_geodataframe,
    constant_rainfall,
    depression_dem,
    uniform_landcover,
)

TEST_DB_HOST = os.environ.get("FLOOD_ENGINE_TEST_DB_HOST", "localhost")
TEST_DB_PORT = int(os.environ.get("FLOOD_ENGINE_TEST_DB_PORT", "55432"))
TEST_DB_NAME = os.environ.get("FLOOD_ENGINE_TEST_DB_NAME", "flood_engine_test")
TEST_DB_USER = os.environ.get("FLOOD_ENGINE_TEST_DB_USER", "postgres")
TEST_DB_PASSWORD = os.environ.get("FLOOD_ENGINE_TEST_DB_PASSWORD", "test_password")

SHAPE = (12, 12)


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


def _enqueue_synthetic_run(
    repository: PostgresJobRepository, *, tmp_path: Path, scenario_id: str
) -> tuple[str, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Runs the real DEM->...->rainfall pipeline and enqueues it as a pending run.

    Returns the run id plus every input array, so callers can assert the
    persisted/executed result actually derived from these specific,
    known values.
    """
    # A closed depression (no outlet), heavy rainfall well in excess of
    # infiltration capacity: guarantees real pooling that crosses
    # ARRIVAL_THRESHOLD_M (5cm) at the low point, not just a nonzero but
    # sub-threshold depth -- exercises arrival_time_min/
    # duration_above_threshold_min for real, not just max_depth_m.
    dem = depression_dem(SHAPE, base_elevation_m=10.0, depth_m=4.0)
    landcover = uniform_landcover(SHAPE, class_code=BARE_SPARSE_VEGETATION)
    buildings = buildings_geodataframe([(0, 0)], shape=SHAPE)
    rainfall = constant_rainfall(rate_mm_per_hr=50.0, hours=4)

    inputs = build_simulation_inputs(
        dem=dem, landcover=landcover, buildings=buildings, rainfall=rainfall
    )

    array_dir = tmp_path / "arrays"
    array_dir.mkdir(exist_ok=True)
    elevation_path = array_dir / "elevation.npy"
    building_mask_path = array_dir / "building_mask.npy"
    manning_n_path = array_dir / "manning_n.npy"
    infiltration_path = array_dir / "infiltration.npy"
    rainfall_path = array_dir / "rainfall.npy"
    write_array(inputs.elevation_m, elevation_path)
    write_array(inputs.building_mask.astype(np.float64), building_mask_path)
    write_array(inputs.manning_n, manning_n_path)
    write_array(inputs.infiltration_loss_mm_per_hr, infiltration_path)
    write_array(inputs.rainfall_rates_mm_per_hr, rainfall_path)

    run_id = repository.enqueue(
        scenario_id=scenario_id,
        elevation_path=str(elevation_path),
        building_mask_path=str(building_mask_path),
        manning_n_path=str(manning_n_path),
        infiltration_loss_path=str(infiltration_path),
        rainfall_rates_path=str(rainfall_path),
    )
    return (
        run_id,
        inputs.elevation_m,
        inputs.building_mask,
        inputs.manning_n,
        inputs.infiltration_loss_mm_per_hr,
        inputs.rainfall_rates_mm_per_hr,
    )


class TestFullPipelineDemToPersistence:
    """DEM -> ... -> simulation.controller.run() -> output.generator -> real persistence."""

    def test_real_arrays_flow_through_every_frozen_module_unmocked(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id, elevation_m, building_mask, manning_n, infiltration, rainfall_rates = (
            _enqueue_synthetic_run(repository, tmp_path=tmp_path, scenario_id="e2e-full-chain")
        )

        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None
        assert job.run_id == run_id
        # Confirms the persistence layer's own claim path round-trips the
        # exact arrays this test enqueued, byte for byte, before the
        # simulation controller ever sees them.
        np.testing.assert_array_equal(job.elevation_m, elevation_m)
        np.testing.assert_array_equal(job.building_mask, building_mask)
        np.testing.assert_array_equal(job.manning_n, manning_n)
        np.testing.assert_array_equal(job.infiltration_loss_mm_per_hr, infiltration)
        np.testing.assert_array_equal(job.rainfall_rates_mm_per_hr, rainfall_rates)

        execute_job(job, repository)

        with repository._pool.connection() as conn:
            summary = read_completed_output(conn, run_id)
        assert summary is not None

    def test_execute_job_persists_a_real_completed_summary(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id, *_ = _enqueue_synthetic_run(
            repository, tmp_path=tmp_path, scenario_id="e2e-persisted-summary"
        )
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None

        execute_job(job, repository)

        with repository._pool.connection() as conn:
            summary = read_completed_output(conn, run_id)
        assert summary is not None
        assert isinstance(summary, FloodOutputSummary)
        assert summary.max_depth_m.shape == SHAPE
        assert summary.arrival_time_min.shape == SHAPE
        assert summary.duration_above_threshold_min.shape == SHAPE
        # A hill with real rainfall must produce some non-zero, non-NaN
        # depth/arrival somewhere -- a real physical result, not an
        # all-zero placeholder that would just as easily indicate a
        # silently broken pipeline.
        assert np.any(summary.max_depth_m > 0.0)
        assert np.any(~np.isnan(summary.arrival_time_min))
        assert summary.step_count > 0
        assert summary.simulated_duration_s > 0.0

    def test_status_transitions_from_pending_to_completed(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id, *_ = _enqueue_synthetic_run(
            repository, tmp_path=tmp_path, scenario_id="e2e-status"
        )
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None

        with repository._pool.connection() as conn:
            status_before = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()
        assert status_before is not None
        assert status_before[0] == JobStatus.RUNNING.value

        execute_job(job, repository)

        with repository._pool.connection() as conn:
            status_after = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()
        assert status_after is not None
        assert status_after[0] == JobStatus.COMPLETED.value

    def test_end_to_end_result_matches_calling_the_controller_directly(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        """The worker/persistence path must not alter what the controller itself computes.

        Runs the identical inputs through simulation.controller.run()
        directly (no job queue, no persistence) and compares against the
        same inputs run through the full enqueue/claim/execute_job/
        persist/read-back path -- the two must agree exactly, proving the
        .npy array round-trip and the worker's own orchestration
        introduce no discrepancy versus calling the frozen controller
        directly.
        """
        run_id, elevation_m, building_mask, manning_n, infiltration, rainfall_rates = (
            _enqueue_synthetic_run(repository, tmp_path=tmp_path, scenario_id="e2e-match-direct")
        )

        direct_result = run_simulation_controller(
            elevation_m=elevation_m,
            building_mask=building_mask,
            manning_n=manning_n,
            infiltration_loss_mm_per_hr=infiltration,
            rainfall_rates_mm_per_hr=rainfall_rates,
        )
        direct_summary = generate_summary(direct_result)

        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None
        execute_job(job, repository)
        with repository._pool.connection() as conn:
            queued_summary = read_completed_output(conn, run_id)
        assert queued_summary is not None

        np.testing.assert_array_equal(queued_summary.max_depth_m, direct_summary.max_depth_m)
        np.testing.assert_array_equal(
            queued_summary.arrival_time_min, direct_summary.arrival_time_min
        )
        np.testing.assert_array_equal(
            queued_summary.duration_above_threshold_min,
            direct_summary.duration_above_threshold_min,
        )
        assert queued_summary.step_count == direct_summary.step_count
        assert queued_summary.simulated_duration_s == direct_summary.simulated_duration_s


class TestRunWorkerRealLoop:
    """A real run_worker() loop iteration against the real repository.

    Not execute_job() called directly -- exercises the poll/claim/sweep
    loop itself.
    """

    def test_worker_loop_claims_and_completes_a_real_pending_run(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id, *_ = _enqueue_synthetic_run(
            repository, tmp_path=tmp_path, scenario_id="e2e-worker-loop"
        )
        config = SimulationExecutionConfig(job_poll_interval_seconds=0.05)
        stop_signal = threading.Event()

        def _stop_after_completion() -> None:
            # Poll the real DB for completion rather than sleeping a fixed
            # guess -- deterministic regardless of machine speed.
            deadline = time.monotonic() + 30.0
            while time.monotonic() < deadline:
                with repository._pool.connection() as conn:
                    row = conn.execute(
                        "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
                    ).fetchone()
                terminal_statuses = (JobStatus.COMPLETED.value, JobStatus.FAILED.value)
                if row is not None and row[0] in terminal_statuses:
                    break
                time.sleep(0.05)
            stop_signal.set()

        watcher = threading.Thread(target=_stop_after_completion, daemon=True)
        watcher.start()
        run_worker(repository, execution_config=config, shutdown=stop_signal)
        watcher.join(timeout=5.0)

        with repository._pool.connection() as conn:
            row = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()
        assert row is not None
        assert row[0] == JobStatus.COMPLETED.value


class TestStandaloneEntrypoint:
    """The real ``python -m flood_engine.jobs.worker`` entrypoint pieces, ``main()`` builds.

    Full ``main()`` itself (including its real SIGINT/SIGTERM handler
    install) is deliberately NOT run inside this test process: on
    Windows, ``signal.signal()`` may only be called from the interpreter's
    real main thread, and this test suite's own main thread is pytest's
    -- running ``main()`` on a background thread would make its internal
    ``_install_shutdown_handler`` call fail, and running it un-threaded
    would block this test forever (``run_worker`` loops until signaled).
    ``TestRunWorkerRealLoop`` above already exercises the real
    poll/claim/execute/shutdown loop end-to-end against the real
    database; this class covers the two pieces specific to ``main()``
    that loop does not: building a real repository via deployment
    config (``_build_repository()``), and ``main()``'s own
    build-run-close orchestration (verified via a monkeypatched
    ``run_worker`` so no real infinite loop or signal handling is
    involved).
    """

    def test_build_repository_produces_a_working_schema_ready_repository(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # _build_repository() calls load_config(), which reads these
        # exact env var names (DatabaseConfig/StorageConfig's own
        # BaseSettings field mapping) -- pointed at the same disposable
        # test database every other test in this file uses.
        monkeypatch.setenv("POSTGRES_HOST", TEST_DB_HOST)
        monkeypatch.setenv("POSTGRES_PORT", str(TEST_DB_PORT))
        monkeypatch.setenv("POSTGRES_DB", TEST_DB_NAME)
        monkeypatch.setenv("POSTGRES_USER", TEST_DB_USER)
        monkeypatch.setenv("POSTGRES_PASSWORD", TEST_DB_PASSWORD)
        monkeypatch.setenv("FLOOD_OUTPUT_STORAGE_DIR", str(tmp_path / "main-output"))
        monkeypatch.setenv("RASTER_STORAGE_DIR", str(tmp_path))

        repository = _build_repository()
        try:
            run_id, *_ = _enqueue_synthetic_run(
                repository, tmp_path=tmp_path, scenario_id="e2e-build-repository"
            )
            job = repository.claim_next_pending(max_concurrent_runs=1)
            assert job is not None
            assert job.run_id == run_id
            execute_job(job, repository)
            with repository._pool.connection() as conn:
                summary = read_completed_output(conn, run_id)
            assert summary is not None
        finally:
            repository.close()

    def test_main_calls_build_repository_then_run_worker_then_closes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list[str] = []

        class _FakeRepository:
            def close(self) -> None:
                calls.append("close")

        fake_repository = _FakeRepository()

        def _fake_build_repository() -> _FakeRepository:
            calls.append("build_repository")
            return fake_repository

        def _fake_run_worker(repository: object, *, shutdown: threading.Event) -> None:
            assert repository is fake_repository
            calls.append("run_worker")

        def _fake_configure_logging(config: object) -> None:
            calls.append("configure_logging")

        def _fake_install_shutdown_handler(stop_signal: threading.Event) -> None:
            calls.append("install_shutdown_handler")

        monkeypatch.setattr(worker_module, "_build_repository", _fake_build_repository)
        monkeypatch.setattr(worker_module, "run_worker", _fake_run_worker)
        monkeypatch.setattr(worker_module, "configure_logging", _fake_configure_logging)
        monkeypatch.setattr(
            worker_module, "_install_shutdown_handler", _fake_install_shutdown_handler
        )

        main()

        assert calls == [
            "configure_logging",
            "install_shutdown_handler",
            "build_repository",
            "run_worker",
            "close",
        ]

    def test_main_closes_the_repository_even_if_run_worker_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list[str] = []

        class _FakeRepository:
            def close(self) -> None:
                calls.append("close")

        def _fake_run_worker(repository: object, *, shutdown: threading.Event) -> None:
            raise RuntimeError("simulated worker-loop crash")

        monkeypatch.setattr(worker_module, "_build_repository", lambda: _FakeRepository())
        monkeypatch.setattr(worker_module, "run_worker", _fake_run_worker)
        monkeypatch.setattr(worker_module, "configure_logging", lambda config: None)
        monkeypatch.setattr(worker_module, "_install_shutdown_handler", lambda stop_signal: None)

        with pytest.raises(RuntimeError, match="simulated worker-loop crash"):
            main()

        assert calls == ["close"]
