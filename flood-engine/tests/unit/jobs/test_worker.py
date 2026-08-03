"""Unit tests for flood_engine.jobs.worker.

Pure NumPy, no I/O, no PostgreSQL -- every test uses an in-memory
``_FakeJobRepository`` satisfying the ``JobRepository`` Protocol
structurally, per this step's own explicit instruction ("Use mocks/fakes
where persistence is required. Do not depend on PostgreSQL."). The fake
enforces the same legal-transition invariants a real Step 17
implementation must (via ``assert``, deliberately raising if the worker
ever attempts an illegal transition), so these tests exercise the
worker's actual contract with its persistence dependency, not a hollow
stub.

Logging assertions use plain ``caplog``: unlike ``flood_engine.api.app``'s
``create_app()`` (see that module's docstring for the bug this avoided),
nothing here calls ``configure_logging()`` except ``main()``, which is
tested separately with the same defensive fixture ``test_app.py``
established for exactly this reason.
"""

import signal
import threading
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from numpy.typing import NDArray
from pydantic import SecretStr

from flood_engine.config import DatabaseConfig, SimulationExecutionConfig
from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.jobs.models import ClaimedJob, JobStatus, RunId
from flood_engine.jobs.worker import (
    _build_conninfo,
    _install_shutdown_handler,
    cancel_pending_job,
    execute_job,
    run_worker,
    sweep_stuck_jobs,
)
from flood_engine.output.generator import FloodOutputSummary


class _FakeJobRepository:
    """An in-memory JobRepository fake -- not a Step 17 implementation.

    Enforces legal-transition preconditions via ``assert`` so a worker
    bug that attempts an illegal transition fails loudly in tests, the
    same way a real DB update-guard trigger (matching the Node backend's
    own `simulation_run` precedent) would reject it.
    """

    def __init__(self, *, stop_when_idle: threading.Event | None = None) -> None:
        self._status: dict[RunId, JobStatus] = {}
        self._started_at: dict[RunId, datetime] = {}
        self._claimed_job_data: dict[RunId, ClaimedJob] = {}
        self.summaries: dict[RunId, FloodOutputSummary] = {}
        self.error_messages: dict[RunId, str] = {}
        self.claim_calls = 0
        self._stop_when_idle = stop_when_idle
        self.fail_mark_completed = False

    def seed_pending(self, job: ClaimedJob) -> None:
        self._status[job.run_id] = JobStatus.PENDING
        self._claimed_job_data[job.run_id] = job

    def seed_running(self, job: ClaimedJob, *, started_at: datetime) -> None:
        self._status[job.run_id] = JobStatus.RUNNING
        self._claimed_job_data[job.run_id] = job
        self._started_at[job.run_id] = started_at

    def status_of(self, run_id: RunId) -> JobStatus:
        return self._status[run_id]

    def claim_next_pending(self, *, max_concurrent_runs: int) -> ClaimedJob | None:
        # Signals "idle" (via stop_when_idle) whenever nothing was
        # claimed, whether that's because no pending job exists OR
        # because capacity is full -- both are "nothing more to do right
        # now" from this fake's perspective. An earlier version of this
        # fake only signalled idle in the no-pending-job case, which hung
        # test_respects_max_concurrent_runs forever (capacity stayed full,
        # stop_when_idle never fired, the worker loop polled endlessly).
        self.claim_calls += 1
        running_count = sum(1 for status in self._status.values() if status is JobStatus.RUNNING)
        if running_count < max_concurrent_runs:
            for run_id, status in self._status.items():
                if status is JobStatus.PENDING:
                    self._status[run_id] = JobStatus.RUNNING
                    self._started_at[run_id] = datetime.now(UTC)
                    return self._claimed_job_data[run_id]
        if self._stop_when_idle is not None:
            self._stop_when_idle.set()
        return None

    def mark_completed(self, run_id: RunId, summary: FloodOutputSummary) -> None:
        if self.fail_mark_completed:
            raise RuntimeError("simulated persistence failure")
        assert self._status[run_id] is JobStatus.RUNNING, "illegal transition: not running"
        self._status[run_id] = JobStatus.COMPLETED
        self.summaries[run_id] = summary

    def mark_failed(self, run_id: RunId, *, error_message: str) -> None:
        assert self._status[run_id] is JobStatus.RUNNING, "illegal transition: not running"
        self._status[run_id] = JobStatus.FAILED
        self.error_messages[run_id] = error_message

    def mark_cancelled(self, run_id: RunId) -> None:
        assert self._status[run_id] is JobStatus.PENDING, "illegal transition: not pending"
        self._status[run_id] = JobStatus.CANCELLED

    def find_stuck_running(self, *, older_than: timedelta) -> list[RunId]:
        now = datetime.now(UTC)
        return [
            run_id
            for run_id, status in self._status.items()
            if status is JobStatus.RUNNING and now - self._started_at[run_id] > older_than
        ]


def _claimed_job(
    run_id: str = "run-1", *, rainfall: NDArray[np.float64] | None = None
) -> ClaimedJob:
    shape = (2, 2)
    return ClaimedJob(
        run_id=run_id,
        elevation_m=np.full(shape, 5.0),
        building_mask=np.zeros(shape, dtype=bool),
        manning_n=np.full(shape, 0.03),
        infiltration_loss_mm_per_hr=np.zeros(shape),
        rainfall_rates_mm_per_hr=rainfall if rainfall is not None else np.array([0.0]),
        solver_parameters=SolverParameters(time_maxdt_s=3600.0),
    )


class TestExecuteJob:
    def test_marks_completed_on_success(self) -> None:
        repository = _FakeJobRepository()
        job = _claimed_job()
        repository.seed_running(job, started_at=datetime.now(UTC))

        execute_job(job, repository)

        assert repository.status_of(job.run_id) is JobStatus.COMPLETED
        assert job.run_id in repository.summaries

    def test_marks_failed_on_wca2d_error(self) -> None:
        repository = _FakeJobRepository()
        job = _claimed_job()
        # A shape mismatch (WCA2DError, via DomainInputs' own validation)
        # is a realistic Step-17-repository-data-quality failure, not an
        # artificial trigger.
        bad_job = ClaimedJob(
            run_id=job.run_id,
            elevation_m=job.elevation_m,
            building_mask=np.zeros((3, 3), dtype=bool),
            manning_n=job.manning_n,
            infiltration_loss_mm_per_hr=job.infiltration_loss_mm_per_hr,
            rainfall_rates_mm_per_hr=job.rainfall_rates_mm_per_hr,
        )
        repository.seed_running(bad_job, started_at=datetime.now(UTC))

        execute_job(bad_job, repository)

        assert repository.status_of(job.run_id) is JobStatus.FAILED
        assert "building_mask" in repository.error_messages[job.run_id]

    def test_marks_failed_on_timestepping_error(self) -> None:
        repository = _FakeJobRepository()
        job = _claimed_job(rainfall=np.array([]))
        repository.seed_running(job, started_at=datetime.now(UTC))

        execute_job(job, repository)

        assert repository.status_of(job.run_id) is JobStatus.FAILED
        assert "rainfall_rates_mm_per_hr" in repository.error_messages[job.run_id]

    def test_marks_failed_on_unexpected_exception(self) -> None:
        # elevation_m=None is a realistic malformed-data scenario (e.g. a
        # Step 17 repository bug), triggering a plain AttributeError
        # rather than one of the three known domain exceptions -- this is
        # exactly the "worker must survive an unexpected exception" path.
        repository = _FakeJobRepository()
        job = _claimed_job()
        broken_job = ClaimedJob(
            run_id=job.run_id,
            elevation_m=None,  # type: ignore[arg-type]
            building_mask=job.building_mask,
            manning_n=job.manning_n,
            infiltration_loss_mm_per_hr=job.infiltration_loss_mm_per_hr,
            rainfall_rates_mm_per_hr=job.rainfall_rates_mm_per_hr,
        )
        repository.seed_running(broken_job, started_at=datetime.now(UTC))

        execute_job(broken_job, repository)

        assert repository.status_of(job.run_id) is JobStatus.FAILED

    def test_logs_started_and_completed(self, caplog: pytest.LogCaptureFixture) -> None:
        repository = _FakeJobRepository()
        job = _claimed_job()
        repository.seed_running(job, started_at=datetime.now(UTC))

        with caplog.at_level("INFO", logger="flood_engine.simulation.worker"):
            execute_job(job, repository)

        messages = [record.message for record in caplog.records]
        assert "simulation.started" in messages
        assert "simulation.completed" in messages


class TestSweepStuckJobs:
    def test_marks_stuck_running_jobs_as_failed(self) -> None:
        repository = _FakeJobRepository()
        job = _claimed_job()
        repository.seed_running(job, started_at=datetime.now(UTC) - timedelta(hours=2))

        sweep_stuck_jobs(repository, run_timeout=timedelta(hours=1))

        assert repository.status_of(job.run_id) is JobStatus.FAILED
        assert "timeout" in repository.error_messages[job.run_id].lower()

    def test_does_not_touch_running_jobs_within_timeout(self) -> None:
        repository = _FakeJobRepository()
        job = _claimed_job()
        repository.seed_running(job, started_at=datetime.now(UTC) - timedelta(seconds=10))

        sweep_stuck_jobs(repository, run_timeout=timedelta(hours=1))

        assert repository.status_of(job.run_id) is JobStatus.RUNNING

    def test_does_nothing_when_no_jobs_exist(self) -> None:
        repository = _FakeJobRepository()

        sweep_stuck_jobs(repository, run_timeout=timedelta(hours=1))  # must not raise


class TestCancelPendingJob:
    def test_cancels_a_pending_job(self) -> None:
        repository = _FakeJobRepository()
        job = _claimed_job()
        repository.seed_pending(job)

        cancel_pending_job(repository, job.run_id)

        assert repository.status_of(job.run_id) is JobStatus.CANCELLED

    def test_illegal_transition_from_running_is_rejected(self) -> None:
        # Only a pending job can be cancelled this way (see
        # cancel_pending_job's own docstring for why) -- the fake's guard
        # models exactly what a real Step 17 implementation must enforce.
        repository = _FakeJobRepository()
        job = _claimed_job()
        repository.seed_running(job, started_at=datetime.now(UTC))

        with pytest.raises(AssertionError, match="not pending"):
            cancel_pending_job(repository, job.run_id)


class TestRunWorkerLoop:
    def test_processes_all_seeded_pending_jobs_then_stops(self) -> None:
        stop_signal = threading.Event()
        repository = _FakeJobRepository(stop_when_idle=stop_signal)
        jobs = [_claimed_job(f"run-{i}") for i in range(3)]
        for job in jobs:
            repository.seed_pending(job)
        config = SimulationExecutionConfig(
            max_concurrent_runs=2, run_timeout_seconds=3600, job_poll_interval_seconds=0.01
        )

        run_worker(repository, execution_config=config, shutdown=stop_signal)

        assert all(repository.status_of(job.run_id) is JobStatus.COMPLETED for job in jobs)

    def test_idle_polling_is_interruptible_and_returns_promptly(self) -> None:
        stop_signal = threading.Event()
        repository = _FakeJobRepository(stop_when_idle=stop_signal)
        # A deliberately long interval -- if the wait were not
        # interruptible, this test would hang for a long time instead of
        # returning as soon as claim_next_pending finds nothing and sets
        # stop_signal.
        config = SimulationExecutionConfig(job_poll_interval_seconds=30.0)

        run_worker(repository, execution_config=config, shutdown=stop_signal)

        assert repository.claim_calls == 1

    def test_respects_max_concurrent_runs(self) -> None:
        stop_signal = threading.Event()
        repository = _FakeJobRepository(stop_when_idle=stop_signal)
        already_running = [_claimed_job(f"running-{i}") for i in range(2)]
        for job in already_running:
            repository.seed_running(job, started_at=datetime.now(UTC))
        pending = _claimed_job("pending-1")
        repository.seed_pending(pending)
        config = SimulationExecutionConfig(max_concurrent_runs=2, job_poll_interval_seconds=0.01)

        run_worker(repository, execution_config=config, shutdown=stop_signal)

        # Capacity was already full -- the pending job must never be claimed.
        assert repository.status_of(pending.run_id) is JobStatus.PENDING

    def test_duplicate_claim_prevention(self) -> None:
        repository = _FakeJobRepository()
        job = _claimed_job()
        repository.seed_pending(job)

        first = repository.claim_next_pending(max_concurrent_runs=2)
        second = repository.claim_next_pending(max_concurrent_runs=2)

        assert first is not None
        assert first.run_id == job.run_id
        assert second is None

    def test_worker_survives_when_persistence_write_back_raises(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        stop_signal = threading.Event()
        repository = _FakeJobRepository(stop_when_idle=stop_signal)
        repository.fail_mark_completed = True
        job = _claimed_job()
        repository.seed_pending(job)
        config = SimulationExecutionConfig(job_poll_interval_seconds=0.01)

        with caplog.at_level("ERROR", logger="flood_engine.simulation.worker"):
            run_worker(repository, execution_config=config, shutdown=stop_signal)  # must not raise

        # The job never reached completed (the write-back failed), but
        # the worker loop itself did not crash -- it kept polling and
        # exited cleanly once idle.
        assert repository.status_of(job.run_id) is JobStatus.RUNNING
        assert any("Unexpected error" in record.message for record in caplog.records)


class TestWorkerStartupShutdown:
    def test_build_conninfo_includes_every_connection_field(self) -> None:
        # _build_repository() itself opens a real connection pool and
        # calls ensure_schema() against a real database -- covered for
        # real in tests/integration/test_worker_end_to_end.py, matching
        # this project's established preference (see
        # tests/unit/persistence/test_repository.py's own docstring) for
        # exercising real DB-backed behavior against a disposable test
        # database rather than elaborately mocking psycopg/psycopg_pool.
        # This unit test covers only the pure, DB-independent piece:
        # conninfo string construction, mirroring persistence.repository's
        # own _build_conninfo test exactly (worker.py deliberately does
        # not import that private helper -- see _build_conninfo's own
        # docstring).
        config = DatabaseConfig(
            postgres_host="dbhost",
            postgres_port=5433,
            postgres_db="flood_engine",
            postgres_user="flood_user",
            postgres_password=SecretStr("s3cret"),
        )

        conninfo = _build_conninfo(config)

        assert "host=dbhost" in conninfo
        assert "port=5433" in conninfo
        assert "dbname=flood_engine" in conninfo
        assert "user=flood_user" in conninfo
        assert "password=s3cret" in conninfo

    def test_install_shutdown_handler_sets_event_on_sigint(self) -> None:
        original_sigint = signal.getsignal(signal.SIGINT)
        original_sigterm = signal.getsignal(signal.SIGTERM)
        stop_signal = threading.Event()
        try:
            _install_shutdown_handler(stop_signal)
            signal.raise_signal(signal.SIGINT)
            assert stop_signal.is_set()
        finally:
            signal.signal(signal.SIGINT, original_sigint)
            signal.signal(signal.SIGTERM, original_sigterm)

    def test_install_shutdown_handler_sets_event_on_sigterm(self) -> None:
        original_sigint = signal.getsignal(signal.SIGINT)
        original_sigterm = signal.getsignal(signal.SIGTERM)
        stop_signal = threading.Event()
        try:
            _install_shutdown_handler(stop_signal)
            signal.raise_signal(signal.SIGTERM)
            assert stop_signal.is_set()
        finally:
            signal.signal(signal.SIGINT, original_sigint)
            signal.signal(signal.SIGTERM, original_sigterm)


class TestDeterminism:
    def test_execute_job_is_deterministic(self) -> None:
        job_a = _claimed_job("run-a")
        job_b = _claimed_job("run-b")
        repository = _FakeJobRepository()
        repository.seed_running(job_a, started_at=datetime.now(UTC))
        repository.seed_running(job_b, started_at=datetime.now(UTC))

        execute_job(job_a, repository)
        execute_job(job_b, repository)

        np.testing.assert_array_equal(
            repository.summaries[job_a.run_id].max_depth_m,
            repository.summaries[job_b.run_id].max_depth_m,
        )
        assert (
            repository.summaries[job_a.run_id].simulated_duration_s
            == repository.summaries[job_b.run_id].simulated_duration_s
        )
