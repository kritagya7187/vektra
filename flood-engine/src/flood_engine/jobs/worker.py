"""jobs.worker: the Step 16 poll-claim-execute loop and its standalone entrypoint.

Run as a separate OS process, independent of the FastAPI service (frozen
architecture Decision 2): ``python -m flood_engine.jobs.worker``. FastAPI
never executes a simulation itself (Step 15 registers no routes at all
yet, and never will call the controller from within a request handler);
this module is the only place :func:`~flood_engine.simulation.controller.run`
is invoked as part of a queued job.

Sequential by design, matching the frozen architecture exactly ("no
multiprocessing... no distributed coordination beyond the frozen
database-claim model"): one worker instance claims and executes exactly
one job at a time. Concurrency (``max_concurrent_runs``) is enforced by
:meth:`~flood_engine.jobs.repository.JobRepository.claim_next_pending`'s
own atomicity, not by anything in this module -- total throughput scales
by running multiple worker instances against the same repository, each
independently bounded by the same check.
"""

import signal
import threading
from datetime import timedelta
from types import FrameType

from flood_engine.config import LoggingConfig, SimulationExecutionConfig
from flood_engine.core.solver.wca2d import WCA2DError
from flood_engine.core.timestepping import TimesteppingError
from flood_engine.jobs.models import ClaimedJob, RunId
from flood_engine.jobs.repository import JobRepository
from flood_engine.logging_config import (
    LogSubsystem,
    SimulationLifecycleEvent,
    configure_logging,
    get_logger,
    log_duration,
    run_context,
)
from flood_engine.output.generator import generate_summary
from flood_engine.simulation.controller import SimulationControllerError
from flood_engine.simulation.controller import run as run_simulation_controller

logger = get_logger(LogSubsystem.SIMULATION, "worker")
performance_logger = get_logger(LogSubsystem.PERFORMANCE, "worker")


def execute_job(job: ClaimedJob, repository: JobRepository) -> None:
    """Execute exactly one claimed job through the frozen Simulation Controller.

    Calls :func:`~flood_engine.simulation.controller.run` exactly once --
    never the solver (`core.solver.wca2d`) or the timestepping engine
    (`core.timestepping`) directly, matching the frozen architecture's
    "must never call the solver directly" rule. `generate_summary` is
    called exactly once on success, matching Step 15's own "never rerun
    output generation twice" discipline extended here.

    Known failures (`WCA2DError`/`TimesteppingError`/
    `SimulationControllerError` -- exactly the set
    `simulation.controller.run`'s own docstring documents) and any other
    unexpected exception both result in the job being marked `failed`;
    the worker itself never crashes because one job's execution raised --
    it must remain able to poll for and execute the next job.

    Args:
        job: The claimed job to execute.
        repository: Where to record the outcome.
    """
    with run_context(job.run_id):
        logger.info(SimulationLifecycleEvent.STARTED.value, extra={"run_id": job.run_id})
        try:
            with log_duration(performance_logger, "flood simulation run", run_id=job.run_id):
                result = run_simulation_controller(
                    elevation_m=job.elevation_m,
                    building_mask=job.building_mask,
                    manning_n=job.manning_n,
                    infiltration_loss_mm_per_hr=job.infiltration_loss_mm_per_hr,
                    rainfall_rates_mm_per_hr=job.rainfall_rates_mm_per_hr,
                    solver_parameters=job.solver_parameters,
                    timestepping_parameters=job.timestepping_parameters,
                )
                summary = generate_summary(result)
        except (WCA2DError, TimesteppingError, SimulationControllerError) as exc:
            logger.error(
                SimulationLifecycleEvent.FAILED.value,
                extra={"run_id": job.run_id, "error": str(exc)},
            )
            repository.mark_failed(job.run_id, error_message=str(exc))
            return
        except Exception as exc:
            logger.exception(SimulationLifecycleEvent.FAILED.value, extra={"run_id": job.run_id})
            repository.mark_failed(job.run_id, error_message=str(exc))
            return

        repository.mark_completed(job.run_id, summary)
        logger.info(SimulationLifecycleEvent.COMPLETED.value, extra={"run_id": job.run_id})


def sweep_stuck_jobs(repository: JobRepository, *, run_timeout: timedelta) -> None:
    """Detect abandoned ``running`` jobs and transition them to ``failed`` (crash recovery).

    Directly implements what ``SimulationExecutionConfig.run_timeout_seconds``'s
    own frozen docstring describes: "how long a run is allowed to take
    before it is considered stuck." Run once per poll cycle -- no
    separate sweep cadence is evidenced anywhere in the frozen
    architecture, so none is invented here.

    Args:
        repository: Where to find and update stuck jobs.
        run_timeout: The configured stuck-job threshold.
    """
    for run_id in repository.find_stuck_running(older_than=run_timeout):
        logger.error(
            SimulationLifecycleEvent.FAILED.value,
            extra={"run_id": run_id, "reason": "timeout"},
        )
        repository.mark_failed(
            run_id,
            error_message=(
                f"Run exceeded the {run_timeout.total_seconds():.0f}s timeout "
                "and was abandoned."
            ),
        )


def cancel_pending_job(repository: JobRepository, run_id: RunId) -> None:
    """Cancel a job that has not yet been claimed. Internal use only.

    No HTTP path reaches this function anywhere in this codebase -- SDS
    Section 8 defines no cancel endpoint. Only a ``pending`` job can be
    safely cancelled this way: once a job is ``running``,
    :func:`~flood_engine.simulation.controller.run` is a single,
    synchronous, non-cooperative call with no cancellation checkpoint --
    interrupting it mid-execution is not something the frozen Step 13
    controller supports, and this layer must not invent one (that would
    be redesigning a frozen step). A ``running`` job that genuinely needs
    to stop can only be abandoned (its process terminated externally,
    e.g. by an orchestrator) and will later be reclaimed as ``failed`` by
    :func:`sweep_stuck_jobs` once it exceeds ``run_timeout_seconds`` -- it
    cannot be marked ``cancelled`` after the fact, since nothing recorded
    that the stoppage was intentional rather than a crash.

    Args:
        repository: Where to record the cancellation.
        run_id: The pending job to cancel.
    """
    logger.info(SimulationLifecycleEvent.CANCELLED.value, extra={"run_id": run_id})
    repository.mark_cancelled(run_id)


def run_worker(
    repository: JobRepository,
    *,
    execution_config: SimulationExecutionConfig | None = None,
    shutdown: threading.Event | None = None,
) -> None:
    """The poll-claim-execute loop. Runs until ``shutdown`` is set.

    Each iteration: sweep for abandoned jobs, attempt to claim one
    pending job, execute it if claimed, or wait ``job_poll_interval_seconds``
    (interruptibly -- ``shutdown`` being set during the wait ends it
    immediately, matching "idle polling" needing to be responsive to
    shutdown, not just busy-claiming).

    Args:
        repository: The persistence dependency (a real implementation
            from Step 17, or a fake in tests).
        execution_config: Concurrency/timeout/poll-interval settings.
            Defaults to :class:`~flood_engine.config.SimulationExecutionConfig`'s
            own defaults.
        shutdown: Signals the loop to stop before its next iteration.
            Defaults to a fresh, never-set :class:`threading.Event` (i.e.
            the loop runs forever unless the caller passes one it can
            set) -- callers needing a bounded test run should pass one
            pre-set after N iterations, or use a fake that sets it.
    """
    config = execution_config if execution_config is not None else SimulationExecutionConfig()
    stop_signal = shutdown if shutdown is not None else threading.Event()
    run_timeout = timedelta(seconds=config.run_timeout_seconds)

    logger.info(
        "Worker loop starting",
        extra={
            "max_concurrent_runs": config.max_concurrent_runs,
            "run_timeout_seconds": config.run_timeout_seconds,
            "job_poll_interval_seconds": config.job_poll_interval_seconds,
        },
    )

    while not stop_signal.is_set():
        sweep_stuck_jobs(repository, run_timeout=run_timeout)

        job = repository.claim_next_pending(max_concurrent_runs=config.max_concurrent_runs)
        if job is None:
            stop_signal.wait(config.job_poll_interval_seconds)
            continue

        try:
            execute_job(job, repository)
        except Exception:
            # execute_job's own try/except covers the simulation itself;
            # this is a second, outer layer of defense against anything
            # else going wrong (most plausibly the repository's own
            # write-back calls raising -- a real infrastructure failure,
            # not a simulation one). The worker process is a long-running
            # daemon; it must survive one bad interaction and keep
            # polling for the next job rather than dying and claiming
            # nothing further until manually restarted. The job itself is
            # left exactly as it was (most likely still `running`) --
            # sweep_stuck_jobs will eventually reclaim it as `failed` via
            # the timeout path if nothing else resolves it.
            logger.exception("Unexpected error executing job", extra={"run_id": job.run_id})

    logger.info("Worker loop stopped")


def _install_shutdown_handler(stop_signal: threading.Event) -> None:
    """Register SIGTERM/SIGINT handlers that set ``stop_signal`` for graceful shutdown.

    Graceful means: stop claiming new jobs once the current iteration
    finishes; a job already claimed and executing is allowed to run to
    completion -- see :func:`cancel_pending_job`'s docstring for why an
    in-flight run cannot be safely interrupted instead.

    Args:
        stop_signal: The event :func:`run_worker` watches.
    """

    def _handle(signum: int, frame: FrameType | None) -> None:
        del frame
        logger.info("Shutdown signal received", extra={"signal": signum})
        stop_signal.set()

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)


def _build_repository() -> JobRepository:
    """Construct the concrete persistence implementation for standalone execution.

    Not available until Step 17 exists. Deliberately does not guess at
    Step 17's eventual module layout or class name -- that is Step 17's
    own design decision, not this step's to invent (per the frozen
    architecture: "do not anticipate Step 17"). Raises clearly instead of
    silently failing or fabricating a fake implementation for real use.

    Raises:
        NotImplementedError: always, until Step 17 provides a concrete
            :class:`~flood_engine.jobs.repository.JobRepository`.
    """
    raise NotImplementedError(
        "flood_engine.jobs.worker has no concrete JobRepository to run against yet -- "
        "Step 17 (PostgreSQL/PostGIS persistence) must be implemented first. See "
        "flood_engine.jobs.repository.JobRepository for the interface it must satisfy."
    )


def main() -> None:
    """Standalone worker process entrypoint: ``python -m flood_engine.jobs.worker``."""
    configure_logging(LoggingConfig())
    stop_signal = threading.Event()
    _install_shutdown_handler(stop_signal)
    repository = _build_repository()
    # Structurally unreachable in tests until Step 17 exists:
    # _build_repository() unconditionally raises above, by design (see
    # its own docstring) -- this line cannot execute until a real
    # JobRepository is available to pass in.
    run_worker(repository, shutdown=stop_signal)  # pragma: no cover


if __name__ == "__main__":  # pragma: no cover -- standard entrypoint guard, never hit on import
    main()


__all__ = [
    "cancel_pending_job",
    "execute_job",
    "main",
    "run_worker",
    "sweep_stuck_jobs",
]
