"""Integration tests for PostgresJobRepository against a real PostgreSQL instance.

Matches this project's existing ``tests/integration/`` convention (already
used for rasterio-dependent tests) for exactly this class of "needs real
I/O" verification -- mocking psycopg's context-manager-heavy transaction
API convincingly would be more complex and less trustworthy than
exercising the real thing.

**Requires a reachable test database.** Configurable via
``FLOOD_ENGINE_TEST_DB_{HOST,PORT,NAME,USER,PASSWORD}`` environment
variables; defaults match a disposable, isolated container started with:

    docker run -d --name flood-engine-test-db -p 55432:5432 \\
        -e POSTGRES_PASSWORD=test_password -e POSTGRES_DB=flood_engine_test \\
        postgis/postgis:16-3.4

This is a throwaway test database, never the project's shared ``db``
service (whose port is not published to the host at all -- see the Step
17 freeze audit). If unreachable, every test in this module is skipped
with a clear reason rather than failing or fabricating success.
"""

import os
import threading
import time
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import numpy as np
import psycopg
import pytest
from psycopg_pool import ConnectionPool
from pydantic import SecretStr

from flood_engine.config import DatabaseConfig, SimulationExecutionConfig, StorageConfig
from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.core.state import MassLedger
from flood_engine.jobs.worker import run_worker
from flood_engine.output.generator import FloodOutputSummary
from flood_engine.persistence.repository import (
    IllegalTransitionError,
    PersistenceError,
    PostgresJobRepository,
    read_completed_output,
)
from flood_engine.persistence.schema import ensure_schema

TEST_DB_HOST = os.environ.get("FLOOD_ENGINE_TEST_DB_HOST", "localhost")
TEST_DB_PORT = int(os.environ.get("FLOOD_ENGINE_TEST_DB_PORT", "55432"))
TEST_DB_NAME = os.environ.get("FLOOD_ENGINE_TEST_DB_NAME", "flood_engine_test")
TEST_DB_USER = os.environ.get("FLOOD_ENGINE_TEST_DB_USER", "postgres")
TEST_DB_PASSWORD = os.environ.get("FLOOD_ENGINE_TEST_DB_PASSWORD", "test_password")


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
        "No reachable test PostgreSQL instance -- see this module's own "
        "docstring for how to start one."
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


def _stage_scenario_arrays(
    tmp_path: Path, name: str, *, shape: tuple[int, int] = (2, 2)
) -> dict[str, str]:
    """Write .npy files matching ClaimedJob's array fields, return their paths.

    Simulates what a not-yet-built upstream layer would have already
    written before a run row is enqueued (see the plan record's Step 17
    resolution).
    """
    base = tmp_path / "inputs" / name
    base.mkdir(parents=True, exist_ok=True)
    arrays: dict[str, np.ndarray] = {
        "elevation": np.full(shape, 5.0),
        "building_mask": np.zeros(shape, dtype=bool),
        "manning_n": np.full(shape, 0.03),
        "infiltration_loss": np.zeros(shape),
        "rainfall_rates": np.array([0.0]),
    }
    paths: dict[str, str] = {}
    for key, array in arrays.items():
        path = base / f"{key}.npy"
        np.save(path, array)
        paths[key] = str(path)
    return paths


class TestEnqueueAndClaim:
    def test_claims_a_pending_job_and_returns_correct_arrays(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        run_id = repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )

        job = repository.claim_next_pending(max_concurrent_runs=2)

        assert job is not None
        assert job.run_id == run_id
        np.testing.assert_array_equal(job.elevation_m, np.full((2, 2), 5.0))
        assert job.building_mask.dtype == np.bool_

    def test_returns_none_when_no_pending_jobs(
        self, repository: PostgresJobRepository
    ) -> None:
        assert repository.claim_next_pending(max_concurrent_runs=2) is None

    def test_duplicate_claim_prevention(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )

        first = repository.claim_next_pending(max_concurrent_runs=2)
        second = repository.claim_next_pending(max_concurrent_runs=2)

        assert first is not None
        assert second is None

    def test_respects_max_concurrent_runs(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        for i in range(2):
            paths = _stage_scenario_arrays(tmp_path, f"job{i}")
            repository.enqueue(
                scenario_id="scenario-1",
                elevation_path=paths["elevation"],
                building_mask_path=paths["building_mask"],
                manning_n_path=paths["manning_n"],
                infiltration_loss_path=paths["infiltration_loss"],
                rainfall_rates_path=paths["rainfall_rates"],
            )

        first = repository.claim_next_pending(max_concurrent_runs=1)
        second = repository.claim_next_pending(max_concurrent_runs=1)

        assert first is not None
        assert second is None  # capacity (1) already exhausted by the first claim

    def test_concurrent_claims_never_return_the_same_job(
        self, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        repositories = [
            PostgresJobRepository(pool, output_storage_dir=tmp_path / "output")
            for _ in range(5)
        ]
        for i in range(5):
            paths = _stage_scenario_arrays(tmp_path, f"job{i}")
            repositories[0].enqueue(
                scenario_id="scenario-1",
                elevation_path=paths["elevation"],
                building_mask_path=paths["building_mask"],
                manning_n_path=paths["manning_n"],
                infiltration_loss_path=paths["infiltration_loss"],
                rainfall_rates_path=paths["rainfall_rates"],
            )

        claimed_run_ids: list[str] = []
        lock = threading.Lock()

        def _claim(repo: PostgresJobRepository) -> None:
            job = repo.claim_next_pending(max_concurrent_runs=10)
            if job is not None:
                with lock:
                    claimed_run_ids.append(job.run_id)

        threads = [threading.Thread(target=_claim, args=(repo,)) for repo in repositories]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10.0)

        # 5 pending jobs, 5 concurrent claimers -- every claim must
        # succeed, and no two claimers may ever receive the same job.
        assert len(claimed_run_ids) == 5
        assert len(set(claimed_run_ids)) == 5


class TestMarkCompleted:
    def _claimed_run_id(self, repository: PostgresJobRepository, tmp_path: Path) -> str:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )
        job = repository.claim_next_pending(max_concurrent_runs=2)
        assert job is not None
        return job.run_id

    def _summary(self) -> FloodOutputSummary:
        return FloodOutputSummary(
            max_depth_m=np.array([[0.1, 0.2], [0.3, 0.4]]),
            arrival_time_min=np.array([[1.0, np.nan], [2.0, np.nan]]),
            duration_above_threshold_min=np.array([[5.0, 0.0], [10.0, 0.0]]),
            mass_ledger=MassLedger(
                rainfall_input_m3=1.0, infiltration_loss_m3=0.0, boundary_outflow_m3=0.0
            ),
            step_count=3,
            simulated_duration_s=180.0,
        )

    def test_persists_output_and_transitions_to_completed(
        self, repository: PostgresJobRepository, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        run_id = self._claimed_run_id(repository, tmp_path)
        summary = self._summary()

        repository.mark_completed(run_id, summary)

        with pool.connection() as conn:
            status = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()[0]
        assert status == "completed"

        with pool.connection() as conn:
            restored = read_completed_output(conn, run_id)
        assert restored is not None
        np.testing.assert_array_equal(restored.max_depth_m, summary.max_depth_m)
        assert restored.step_count == summary.step_count

    def test_raises_illegal_transition_when_not_running(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        run_id = repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )
        # Never claimed -- still `pending`, not `running`.

        with pytest.raises(IllegalTransitionError):
            repository.mark_completed(run_id, self._summary())

    def test_transactional_rollback_on_database_constraint_violation(
        self, repository: PostgresJobRepository, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        run_id = self._claimed_run_id(repository, tmp_path)
        summary = self._summary()
        repository.mark_completed(run_id, summary)  # first, real completion

        # Simulate a retry colliding with the already-persisted output --
        # a genuine DB constraint violation (duplicate primary key on
        # flood_simulation_output.run_id), not just an app-level
        # precondition check.
        with pool.connection() as conn:
            conn.execute(
                "UPDATE flood_simulation_run SET status = 'running' WHERE id = %s", (run_id,)
            )
            conn.commit()

        with pytest.raises(PersistenceError):
            repository.mark_completed(run_id, summary)

        # Both statements in the failed attempt's transaction (the status
        # UPDATE and the output INSERT) must have rolled back together --
        # exactly one output row, and status left as this test set it
        # (`running`), never `completed` from the failed second attempt.
        with pool.connection() as conn:
            output_count = conn.execute(
                "SELECT count(*) FROM flood_simulation_output WHERE run_id = %s", (run_id,)
            ).fetchone()[0]
            status = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()[0]
        assert output_count == 1
        assert status == "running"


class TestMarkFailed:
    def test_transitions_to_failed_with_error_message(
        self, repository: PostgresJobRepository, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )
        job = repository.claim_next_pending(max_concurrent_runs=2)
        assert job is not None

        repository.mark_failed(job.run_id, error_message="simulated failure")

        with pool.connection() as conn:
            row = conn.execute(
                "SELECT status, error_message FROM flood_simulation_run WHERE id = %s",
                (job.run_id,),
            ).fetchone()
        assert row == ("failed", "simulated failure")

    def test_raises_illegal_transition_when_not_running(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        run_id = repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )

        with pytest.raises(IllegalTransitionError):
            repository.mark_failed(run_id, error_message="should not apply")


class TestMarkCancelled:
    def test_cancels_a_pending_job(
        self, repository: PostgresJobRepository, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        run_id = repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )

        repository.mark_cancelled(run_id)

        with pool.connection() as conn:
            status = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()[0]
        assert status == "cancelled"

    def test_cancelled_jobs_are_never_claimed(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        run_id = repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )
        repository.mark_cancelled(run_id)

        job = repository.claim_next_pending(max_concurrent_runs=2)

        assert job is None

    def test_raises_illegal_transition_when_running(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )
        job = repository.claim_next_pending(max_concurrent_runs=2)
        assert job is not None

        with pytest.raises(IllegalTransitionError):
            repository.mark_cancelled(job.run_id)


class TestFindStuckRunning:
    def test_finds_jobs_older_than_threshold(
        self, repository: PostgresJobRepository, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        run_id = repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )
        job = repository.claim_next_pending(max_concurrent_runs=2)
        assert job is not None
        with pool.connection() as conn:
            conn.execute(
                "UPDATE flood_simulation_run SET started_at = now() - interval '2 hours' "
                "WHERE id = %s",
                (run_id,),
            )
            conn.commit()


        stuck = repository.find_stuck_running(older_than=timedelta(hours=1))

        assert run_id in stuck

    def test_does_not_find_recent_running_jobs(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:

        paths = _stage_scenario_arrays(tmp_path, "job1")
        repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )
        job = repository.claim_next_pending(max_concurrent_runs=2)
        assert job is not None

        stuck = repository.find_stuck_running(older_than=timedelta(hours=1))

        assert job.run_id not in stuck


class TestWorkerEndToEnd:
    def test_worker_operates_without_modification_against_postgres(
        self, repository: PostgresJobRepository, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        """The required "verify worker operates without modification" check.

        Runs the real, frozen ``run_worker`` (Step 16, unmodified) in a
        background thread against a real ``PostgresJobRepository``.
        """
        paths = _stage_scenario_arrays(tmp_path, "job1")
        run_id = repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
            solver_parameters=SolverParameters(time_maxdt_s=3600.0),
        )

        stop_signal = threading.Event()
        config = SimulationExecutionConfig(
            max_concurrent_runs=2, run_timeout_seconds=3600, job_poll_interval_seconds=0.05
        )
        worker_thread = threading.Thread(
            target=run_worker,
            args=(repository,),
            kwargs={"execution_config": config, "shutdown": stop_signal},
        )
        worker_thread.start()

        deadline = time.monotonic() + 10.0
        status = None
        while time.monotonic() < deadline:
            with pool.connection() as conn:
                row = conn.execute(
                    "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
                ).fetchone()
            status = row[0] if row else None
            if status in ("completed", "failed"):
                break
            time.sleep(0.05)

        stop_signal.set()
        worker_thread.join(timeout=5.0)

        assert status == "completed"
        with pool.connection() as conn:
            summary = read_completed_output(conn, run_id)
        assert summary is not None
        assert summary.step_count > 0


class TestFromConfigAndClose:
    def test_from_config_builds_a_working_repository(self, tmp_path: Path) -> None:
        database_config = DatabaseConfig(
            postgres_host=TEST_DB_HOST,
            postgres_port=TEST_DB_PORT,
            postgres_db=TEST_DB_NAME,
            postgres_user=TEST_DB_USER,
            postgres_password=SecretStr(TEST_DB_PASSWORD),
        )
        storage_config = StorageConfig(flood_output_storage_dir=tmp_path / "output")

        with ConnectionPool(
            conninfo=(
                f"host={TEST_DB_HOST} port={TEST_DB_PORT} dbname={TEST_DB_NAME} "
                f"user={TEST_DB_USER} password={TEST_DB_PASSWORD}"
            ),
            min_size=1,
            max_size=1,
            open=True,
        ) as setup_pool:
            with setup_pool.connection() as conn:
                ensure_schema(conn)

        repo = PostgresJobRepository.from_config(database_config, storage_config)
        try:
            # Exercises the pool from_config() built, through the
            # repository's own public API -- no private-attribute access.
            # Other tests' fixtures may leave rows in this shared
            # database, so only "does not raise" is asserted, not a
            # specific return value.
            repo.claim_next_pending(max_concurrent_runs=1_000_000)
        finally:
            repo.close()

    def test_close_closes_the_pool(self, pool: ConnectionPool, tmp_path: Path) -> None:
        repo = PostgresJobRepository(pool, output_storage_dir=tmp_path / "output")

        repo.close()

        with pytest.raises(psycopg.Error), pool.connection():
            pass


class TestErrorTranslation:
    """Every repository method that touches the database wraps a real

    connection failure as PersistenceError, per this step's own "do not
    swallow SQL errors" requirement. A closed pool is a reliable, real
    way to trigger this (confirmed: psycopg_pool.PoolClosed is itself a
    psycopg.Error subclass), without needing per-method contrived
    failures.
    """

    def _closed_repository(self, tmp_path: Path) -> PostgresJobRepository:
        conninfo = (
            f"host={TEST_DB_HOST} port={TEST_DB_PORT} dbname={TEST_DB_NAME} "
            f"user={TEST_DB_USER} password={TEST_DB_PASSWORD}"
        )
        closed_pool = ConnectionPool(conninfo=conninfo, min_size=1, max_size=1, open=True)
        closed_pool.close()
        return PostgresJobRepository(closed_pool, output_storage_dir=tmp_path / "output")

    def test_enqueue_wraps_connection_failure(self, tmp_path: Path) -> None:
        repo = self._closed_repository(tmp_path)

        with pytest.raises(PersistenceError):
            repo.enqueue(
                scenario_id="s",
                elevation_path="e",
                building_mask_path="b",
                manning_n_path="m",
                infiltration_loss_path="i",
                rainfall_rates_path="r",
            )

    def test_claim_next_pending_wraps_connection_failure(self, tmp_path: Path) -> None:
        repo = self._closed_repository(tmp_path)

        with pytest.raises(PersistenceError):
            repo.claim_next_pending(max_concurrent_runs=2)

    def test_mark_failed_wraps_connection_failure(self, tmp_path: Path) -> None:
        repo = self._closed_repository(tmp_path)

        with pytest.raises(PersistenceError):
            repo.mark_failed("00000000-0000-0000-0000-000000000000", error_message="x")

    def test_mark_cancelled_wraps_connection_failure(self, tmp_path: Path) -> None:
        repo = self._closed_repository(tmp_path)

        with pytest.raises(PersistenceError):
            repo.mark_cancelled("00000000-0000-0000-0000-000000000000")

    def test_find_stuck_running_wraps_connection_failure(self, tmp_path: Path) -> None:
        repo = self._closed_repository(tmp_path)

        with pytest.raises(PersistenceError):
            repo.find_stuck_running(older_than=timedelta(hours=1))


class TestReadCompletedOutput:
    def test_returns_none_when_no_output_row_exists(
        self, repository: PostgresJobRepository, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        paths = _stage_scenario_arrays(tmp_path, "job1")
        run_id = repository.enqueue(
            scenario_id="scenario-1",
            elevation_path=paths["elevation"],
            building_mask_path=paths["building_mask"],
            manning_n_path=paths["manning_n"],
            infiltration_loss_path=paths["infiltration_loss"],
            rainfall_rates_path=paths["rainfall_rates"],
        )
        # Never claimed/completed -- no output row exists for it.

        with pool.connection() as conn:
            result = read_completed_output(conn, run_id)

        assert result is None
