"""jobs.repository: the Step 16 -> Step 17 persistence interface.

A :class:`typing.Protocol` only -- no implementation, no SQL, no schema,
no PostgreSQL/psycopg import anywhere in this module or the rest of this
package. This is the dependency-inversion seam the frozen Step 16
architecture requires: Step 17 writes a concrete class satisfying this
shape; this package depends only on the shape, never on Step 17's module.

Structural typing (``Protocol``), not inheritance, is deliberate: Step
17's implementation does not need to import this module, or this
package, at all -- it only needs to have the right methods with the right
signatures. That is the actual mechanism "Step 17 can plug in concrete
implementations without modifying Step 16" refers to.

Every method below is a stub (``...``) -- there is no logic to test here,
only a contract. Concrete behaviour is exercised in this package's own
tests via an in-memory fake satisfying this same shape (see
``tests/unit/jobs/test_worker.py``), never against a real database.
"""

from datetime import timedelta
from typing import Protocol

from flood_engine.jobs.models import ClaimedJob, RunId
from flood_engine.output.generator import FloodOutputSummary


class JobRepository(Protocol):
    """The persistence operations the Step 16 worker depends on.

    Five operations, matching exactly the frozen architecture's database-
    entity review (plan record, "Step 16 -- Job Queue"): no more, no
    fewer. A concrete implementation is expected to enforce the job state
    machine's legal transitions itself (matching the Node backend's own
    ``simulation_run`` precedent, which does this via a DB update-guard
    trigger) -- this Protocol describes each method's precondition and
    effect, but Step 16 does not and cannot enforce them; that is
    persistence's job, not orchestration's.
    """

    def claim_next_pending(self, *, max_concurrent_runs: int) -> ClaimedJob | None:
        """Atomically claim one ``pending`` job, if capacity allows.

        Must, as a single atomic operation not observable as two steps by
        any concurrent caller: confirm fewer than ``max_concurrent_runs``
        jobs currently have status ``running``; if so, select one
        ``pending`` job, transition it to ``running`` (recording a start
        time), and return everything needed to execute it. Two concurrent
        callers must never be able to claim the same job -- this is the
        one correctness property the whole queue model depends on.

        Args:
            max_concurrent_runs: The caller's configured concurrency
                bound (``SimulationExecutionConfig.max_concurrent_runs``).

        Returns:
            The claimed job, or ``None`` if there is no pending job or no
            available capacity.
        """
        ...  # pragma: no cover

    def mark_completed(self, run_id: RunId, summary: FloodOutputSummary) -> None:
        """Transition a ``running`` job to ``completed``, recording its output summary.

        Precondition: ``run_id`` currently has status ``running``.
        """
        ...  # pragma: no cover

    def mark_failed(self, run_id: RunId, *, error_message: str) -> None:
        """Transition a ``running`` job to ``failed``, recording why.

        Precondition: ``run_id`` currently has status ``running``. Used
        for both execution exceptions and timeout-driven abandonment
        (:func:`~flood_engine.jobs.worker.sweep_stuck_jobs`) -- the two
        are distinguished by ``error_message``'s content, not by a
        separate status, matching the Node precedent's own single
        ``failed`` status with an ``error_message`` column.
        """
        ...  # pragma: no cover

    def mark_cancelled(self, run_id: RunId) -> None:
        """Transition a ``pending`` job to ``cancelled``. Internal use only.

        Precondition: ``run_id`` currently has status ``pending``. No
        HTTP path reaches this method anywhere in this codebase --
        see :func:`~flood_engine.jobs.worker.cancel_pending_job` for why
        a ``running`` job cannot be safely cancelled this way.
        """
        ...  # pragma: no cover

    def find_stuck_running(self, *, older_than: timedelta) -> list[RunId]:
        """Return every ``running`` job whose start time is older than ``older_than``.

        Feeds :func:`~flood_engine.jobs.worker.sweep_stuck_jobs`'s
        crash-recovery timeout detection.
        """
        ...  # pragma: no cover


__all__ = ["JobRepository"]
