"""core.timestepping: the outer simulation loop (Step 12).

Owns exactly what the NMS "Module ownership" section assigns to this
module and nothing else: the simulation clock and stopping criteria (event
duration + recession tail), plus the two scheduling decisions
`core.solver.wca2d.step` deliberately does not make for itself --
infiltration cadence, and how a coarse hourly rainfall series maps onto
the solver's own much finer adaptive substeps. It repeatedly calls
:func:`~flood_engine.core.solver.wca2d.step` with the `next_dt_proposed_s`
that call itself returned; it never recomputes solver-internal timestep
stability logic.

**Why this module takes a raw rate array, not a**
:class:`~flood_engine.inputs.rainfall.RainfallForcing`: the project's own
frozen dependency direction (see the repository README) is one-way --
`core` depends on nothing else in this package, while `inputs` depends on
`core`, never the reverse. Importing `RainfallForcing` here would invert
that. It also turns out not to lose anything: this module only ever needs
"an hourly sequence of scalar rates, with the first bucket starting at
simulation t=0" -- a representation both of SDS Section 5's forcing modes
(`historical_replay` and `synthetic_design_storm`) already reduce to,
regardless of which one produced it. Translating a `RainfallForcing` into
this shape is a not-yet-built, higher layer's job, above both `core` and
`inputs` -- **not** `simulation` (Step 13), corrected here: the frozen
dependency direction has `simulation` depending only on `core`, as a peer
of `inputs`, not a superset able to import it. (An earlier version of this
paragraph claimed otherwise; that was wrong, caught while scoping Step 13,
and is corrected here as a documentation fix, not a behavior change.) For
`historical_replay` specifically, that translation is the identity
function on `RainfallForcing.rainfall_mm_per_hr` regardless of which layer
ends up performing it -- nothing to build, just somewhere for a call site
to live.
"""

from dataclasses import dataclass
from typing import Final

import numpy as np
from numpy.typing import NDArray

from flood_engine.core.solver.wca2d import DomainInputs, SolverParameters, StepResult, step
from flood_engine.core.state import SolverState
from flood_engine.logging_config import LogSubsystem, get_logger

logger = get_logger(LogSubsystem.SIMULATION, "timestepping")

RECESSION_TAIL_S: Final[float] = 4.0 * 3600.0
"""NMS "Dynamic inputs": a fixed 4-hour recession tail after rainfall ends.

Frozen default -- overridable per run via :func:`run_simulation`'s
``total_duration_s``, matching SDS Section 5's
``flood_scenario.simulation_duration_min`` override capability.
"""


class TimesteppingError(Exception):
    """Raised when timestepping inputs fail validation. Always rejected, never repaired."""


@dataclass(frozen=True, slots=True)
class TimesteppingParameters:
    """The one numerical parameter frozen by the Step 12 pre-implementation resolution.

    Deliberately not part of :class:`~flood_engine.core.solver.wca2d.SolverParameters`
    -- this is a scheduling constant the *controller* owns per the NMS's own
    module-ownership split, not a solver-internal one.

    Attributes:
        infiltration_interval_s: Real-world seconds between infiltration
            applications. Sourced, not invented: the real reference
            implementation's own infiltration period equals its
            `time_updatedt`, itself constrained by
            `time_maxdt <= time_updatedt <= 60s`. VEKTRA already froze
            `SolverParameters.time_maxdt_s = 60.0` (Step 10.5/11A) from
            that same evidenced ceiling, which forces this value to
            exactly 60.0 too -- not an independent judgment call. See the
            plan record's "Step 12 -- Pre-Implementation Numerical
            Parameter Resolution."
    """

    infiltration_interval_s: float = 60.0

    def __post_init__(self) -> None:
        """Validate the parameter is strictly positive.

        Raises:
            TimesteppingError: if ``infiltration_interval_s`` is not
                strictly positive.
        """
        if self.infiltration_interval_s <= 0:
            raise TimesteppingError(
                "infiltration_interval_s must be strictly positive, got "
                f"{self.infiltration_interval_s!r}."
            )


@dataclass(frozen=True, slots=True)
class TimestepRecord:
    """One completed solver step, tagged with its position on the simulation clock.

    Attributes:
        elapsed_s: Simulation time at the END of this step, in seconds
            since the run started (``t=0``).
        result: The :class:`~flood_engine.core.solver.wca2d.StepResult`
            produced by that step.
    """

    elapsed_s: float
    result: StepResult


def _forcing_duration_s(rainfall_rates_mm_per_hr: NDArray[np.float64]) -> float:
    """The rainfall event's own covered duration, in seconds.

    Each array entry is one hourly bucket's rate, starting at ``t=0`` --
    the event covers ``len(rainfall_rates_mm_per_hr)`` whole hours.
    """
    return float(len(rainfall_rates_mm_per_hr)) * 3600.0


def _rainfall_rate_at(elapsed_s: float, rainfall_rates_mm_per_hr: NDArray[np.float64]) -> float:
    """Piecewise-constant rainfall lookup -- matches the reference exactly.

    An earlier version of this function used linear interpolation between
    hourly rates instead, a deliberate deviation from the reference. That
    was reverted after a numerical-fidelity review found it violates
    per-hour rainfall-volume conservation: interpolating between anchors
    ``R_k`` and ``R_{k+1}`` makes hour ``k``'s integral
    ``(R_k+R_{k+1})/2 * 3600``, not ``R_k * 3600`` -- an error proportional
    to how much intensity changes hour-to-hour (over 100% for a single
    interval in a realistic test series, confirmed numerically, not just
    algebraically). Holding the rate constant within each hour (matching
    the reference's own ``Rain.cpp``, confirmed via direct source
    inspection: rate held constant until the next time-series entry, then
    switches discontinuously) makes every hour's integral exactly
    ``R_k * 3600`` by construction -- nothing to prove, nothing to verify.
    See ``flood-engine/docs/NUMERICAL_DEVIATIONS.md``.

    Residual, much smaller discretization note, inherent to any adaptive
    substep under a coarser forcing series (present in the reference too,
    not introduced by this choice): a substep whose ``dt_s`` straddles an
    hour boundary uses the rate active at its *start* time for its whole
    duration, attributing a sliver of one hour's rainfall to the
    neighboring hour. Bounded by at most one substep's duration
    (``time_maxdt_s``, frozen at 60s by default) per boundary crossing --
    negligible next to the multi-hour events this model targets, and
    structurally the same kind of bounded truncation as the infiltration
    remainder documented on :func:`run_simulation`.

    Args:
        elapsed_s: Simulation time since the run started, in seconds.
            Precondition: non-negative -- guaranteed by this module's own
            :func:`run_simulation` loop (the only caller), not
            independently validated here (a private helper, not a system
            boundary).
        rainfall_rates_mm_per_hr: Hourly rates, first bucket at ``t=0``.

    Returns:
        The active rate (or zero, past the covered duration) in mm/hr.
    """
    bucket_count = len(rainfall_rates_mm_per_hr)
    covered_s = _forcing_duration_s(rainfall_rates_mm_per_hr)
    if elapsed_s >= covered_s:
        return 0.0

    bucket_index = min(int(elapsed_s // 3600.0), bucket_count - 1)
    return float(rainfall_rates_mm_per_hr[bucket_index])


def run_simulation(
    *,
    initial_state: SolverState,
    domain: DomainInputs,
    rainfall_rates_mm_per_hr: NDArray[np.float64],
    infiltration_loss_mm_per_hr: NDArray[np.float64],
    solver_parameters: SolverParameters | None = None,
    timestepping_parameters: TimesteppingParameters | None = None,
    initial_dt_s: float | None = None,
    total_duration_s: float | None = None,
) -> tuple[TimestepRecord, ...]:
    """Run the WCA2D solver from ``t=0`` until the stopping criterion is reached.

    Repeatedly calls :func:`~flood_engine.core.solver.wca2d.step`, always
    with the ``next_dt_proposed_s`` the previous call returned (never
    recomputed here), clamped only so the final step lands exactly on the
    stopping time rather than overshooting it -- not a re-derivation of
    stability logic.

    Infiltration is applied when the accumulated time since it was last
    applied reaches ``timestepping_parameters.infiltration_interval_s``,
    passing that accumulated span as ``infiltration_period_s`` so the
    solver's removal amount reflects the real elapsed period, not just the
    current substep's ``dt_s`` (matching the reference's own
    ``rate * (period / 3600)`` convention). Any partial accrual still
    outstanding when the run ends is not applied -- bounded, quantified:
    at most one ``infiltration_interval_s`` of infiltration is omitted
    (60s by default), a negligible fraction of any multi-hour storm event
    plus its 4-hour recession tail. Not a defect, and not worth delaying a
    freeze over.

    Args:
        initial_state: The state at ``t=0``.
        domain: Static grids, unchanged for the whole run.
        rainfall_rates_mm_per_hr: Hourly rate anchors starting at ``t=0``
            (see the module docstring for why this is a raw array, not a
            :class:`~flood_engine.inputs.rainfall.RainfallForcing`). Must
            have at least one entry.
        infiltration_loss_mm_per_hr: Per-cell infiltration rate, static
            for the whole run (already computed by the not-yet-built
            ``core.solver.infiltration`` SCS-CN crosswalk).
        solver_parameters: The five frozen WCA2D numerical parameters.
            Defaults to :class:`~flood_engine.core.solver.wca2d.SolverParameters`'s
            own defaults.
        timestepping_parameters: The infiltration-cadence parameter.
            Defaults to :class:`TimesteppingParameters`'s own default.
        initial_dt_s: The timestep for the very first call, before the
            solver has proposed one of its own. Defaults to
            ``solver_parameters.time_maxdt_s`` -- a reasonable bootstrap,
            not a sourced value: a cold-start state typically has zero or
            low velocity, for which the solver itself would propose the
            maximum timestep anyway.
        total_duration_s: Overrides the default stopping time (rainfall
            event duration + :data:`RECESSION_TAIL_S`), matching SDS
            Section 5's ``simulation_duration_min`` override. Must be
            strictly positive when given.

    Returns:
        A tuple of :class:`TimestepRecord`, one per completed step, in
        chronological order.

    Raises:
        TimesteppingError: if ``rainfall_rates_mm_per_hr`` is empty, or
            the resolved total duration is not strictly positive.
    """
    if len(rainfall_rates_mm_per_hr) == 0:
        raise TimesteppingError("rainfall_rates_mm_per_hr must have at least one entry.")

    solver_params = solver_parameters if solver_parameters is not None else SolverParameters()
    ts_params = (
        timestepping_parameters if timestepping_parameters is not None else TimesteppingParameters()
    )

    duration_s = (
        total_duration_s
        if total_duration_s is not None
        else _forcing_duration_s(rainfall_rates_mm_per_hr) + RECESSION_TAIL_S
    )
    if duration_s <= 0:
        raise TimesteppingError(f"total_duration_s must be strictly positive, got {duration_s!r}.")

    dt_s = initial_dt_s if initial_dt_s is not None else solver_params.time_maxdt_s

    records: list[TimestepRecord] = []
    state = initial_state
    elapsed_s = 0.0
    time_since_infiltration_s = 0.0

    while elapsed_s < duration_s:
        dt_s = min(dt_s, duration_s - elapsed_s)
        time_since_infiltration_s += dt_s

        apply_infiltration = time_since_infiltration_s >= ts_params.infiltration_interval_s
        infiltration_period_s = time_since_infiltration_s if apply_infiltration else None

        rainfall_rate = _rainfall_rate_at(elapsed_s, rainfall_rates_mm_per_hr)

        result = step(
            state,
            domain,
            rainfall_rate,
            infiltration_loss_mm_per_hr,
            dt_s=dt_s,
            apply_infiltration=apply_infiltration,
            infiltration_period_s=infiltration_period_s,
            parameters=solver_params,
        )

        elapsed_s += dt_s
        if apply_infiltration:
            time_since_infiltration_s = 0.0

        records.append(TimestepRecord(elapsed_s=elapsed_s, result=result))

        state = result.state
        dt_s = result.next_dt_proposed_s

    logger.debug(
        "Simulation run complete",
        extra={"step_count": len(records), "duration_s": duration_s},
    )

    return tuple(records)


__all__ = [
    "RECESSION_TAIL_S",
    "TimestepRecord",
    "TimesteppingError",
    "TimesteppingParameters",
    "run_simulation",
]
