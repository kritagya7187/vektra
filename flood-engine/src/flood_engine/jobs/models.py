"""jobs.models: the Step 16 job state machine's data types.

Pure data only -- no persistence, no execution logic, no I/O. See the
project plan record's frozen "Step 16 -- Job Queue" architecture section
for the state machine and the evidence behind every decision recorded
here; nothing in this module makes a new decision.
"""

from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from numpy.typing import NDArray

from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.core.timestepping import TimesteppingParameters

type RunId = str
"""Opaque identifier for a ``flood_simulation_run`` row.

Whatever concrete type Step 17's persistence layer actually uses (e.g. a
UUID), this layer only ever sees it as an opaque string -- it never
parses, validates, or assumes anything about its structure.
"""


class JobStatus(StrEnum):
    """The five frozen job-lifecycle states.

    Four states (``PENDING``/``RUNNING``/``COMPLETED``/``FAILED``) mirror
    the existing Node-backend ``simulation_run`` precedent exactly (same
    names, same DB-enforced set, per the frozen architecture's own
    evidence review). ``CANCELLED`` is a fifth state that precedent does
    not have, included per explicit project-owner decision because
    flood-engine's own already-frozen Step 5 ``SimulationLifecycleEvent``
    enum already anticipates it -- reachable only through an internal
    mechanism this package owns (see ``worker.cancel_pending_job``),
    never through an HTTP action, since no such endpoint exists anywhere
    in the frozen SDS.

    Legal transitions (enforced by Step 17's concrete persistence layer,
    not by this type itself, matching the Node precedent's own
    update-guard-trigger discipline):
    ``pending -> running -> {completed, failed}``,
    ``pending -> cancelled``. Both ``completed`` and ``failed`` are
    terminal; so is ``cancelled``. There is no ``running -> cancelled``
    transition -- seeing why is ``cancel_pending_job``'s own docstring.
    """

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class ClaimedJob:
    """Everything the worker needs to execute one simulation, once claimed.

    Deliberately carries nothing beyond
    :func:`~flood_engine.simulation.controller.run`'s own existing,
    frozen argument list -- this type is a claim receipt, not a new
    domain model. Translating a persisted ``flood_scenario`` row into
    these arrays is Step 17's responsibility; this type is the boundary
    Step 17's repository implementation must produce and Step 16 must
    consume, nothing more.

    Attributes:
        run_id: The claimed run's identifier.
        elevation_m, building_mask, manning_n, infiltration_loss_mm_per_hr,
            rainfall_rates_mm_per_hr: exactly
            :func:`~flood_engine.simulation.controller.run`'s required
            arguments.
        solver_parameters: Optional override, same meaning as in
            :func:`~flood_engine.simulation.controller.run`.
        timestepping_parameters: Optional override, same meaning as in
            :func:`~flood_engine.simulation.controller.run`.
    """

    run_id: RunId
    elevation_m: NDArray[np.float64]
    building_mask: NDArray[np.bool_]
    manning_n: NDArray[np.float64]
    infiltration_loss_mm_per_hr: NDArray[np.float64]
    rainfall_rates_mm_per_hr: NDArray[np.float64]
    solver_parameters: SolverParameters | None = None
    timestepping_parameters: TimesteppingParameters | None = None


__all__ = ["ClaimedJob", "JobStatus", "RunId"]
