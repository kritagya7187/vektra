"""simulation.controller: the Step 13 simulation controller (orchestration only).

Per the README's own layout description -- "``simulation/`` controller:
drives core over real inputs, produces NMS summary outputs" -- this module
does exactly one thing: wire already-prepared inputs into
:func:`~flood_engine.core.timestepping.run_simulation`, then aggregate its
per-step output into one immutable :class:`SimulationResult`. It performs
no physics, no numerical computation, no raster I/O, and no persistence --
every one of those already exists in a frozen layer this module calls into
and never reimplements.

**Why every input here is a raw NDArray, not a**
:class:`~flood_engine.io.raster_loader.RasterDataset` **or a**
:class:`~flood_engine.inputs.rainfall.RainfallForcing`: this module lives in
``simulation``, which the project's frozen dependency direction (see the
repository README) allows to depend on ``core`` only -- as a peer of
``inputs``, not a superset of it. (An earlier note in
``core/timestepping.py`` claimed the controller "sits above both `core` and
`inputs` and may depend on both" -- that was wrong, corrected here, not a
behavior change.) Both ``RasterDataset`` and ``RainfallForcing`` carry
rasterio/datetime-typed fields from layers this module cannot import
without inverting that direction. Unwrapping them into the raw arrays this
module actually needs is the job of whatever not-yet-built layer sits above
``simulation`` (a future API/job layer) -- exactly the same resolution
Step 12 already applied to ``RainfallForcing``.

**Why almost no new validation code appears here**: every shape/positivity
invariant a controller might plausibly check is already enforced by the
frozen layers this module calls into --
:class:`~flood_engine.core.solver.wca2d.DomainInputs` validates
``building_mask``/``manning_n`` shape and positivity;
:func:`~flood_engine.core.solver.wca2d.step` validates
``infiltration_loss_mm_per_hr``'s shape;
:func:`~flood_engine.core.timestepping.run_simulation` validates the
rainfall array is non-empty. Re-implementing any of these here would be
duplicated validation logic, not additional safety. CRS/affine-transform
equality is not checked at all -- unreachable without importing rasterio
types this layer is not allowed to hold, and already guaranteed upstream
(Steps 7-9 align every static layer to the single frozen model grid,
:data:`~flood_engine.core.grid.MODEL_GRID_EPSG_CODE`/
:data:`~flood_engine.core.grid.MODEL_GRID_RESOLUTION_M`, before arrays ever
reach this module).
"""

from dataclasses import dataclass
from typing import Final

import numpy as np
from numpy.typing import NDArray

from flood_engine.core.grid import MODEL_GRID_RESOLUTION_M
from flood_engine.core.solver.wca2d import DomainInputs, SolverParameters
from flood_engine.core.state import MassLedger, SolverState
from flood_engine.core.timestepping import (
    TimesteppingParameters,
    TimestepRecord,
    run_simulation,
)
from flood_engine.logging_config import LogSubsystem, get_logger

logger = get_logger(LogSubsystem.SIMULATION, "controller")

MASS_CONSERVATION_RTOL: Final[float] = 1e-9
"""Relative-error tolerance for the full-run mass-conservation identity.

Looser than the 1e-12 bound ``test_wca2d.py`` established for a *single*
solver step, to honestly account for floating-point accumulation across
the many steps a full run comprises -- not assumed to carry over unchanged,
measured empirically for a representative long run in
``test_controller.py``, matching the same empirical discipline used to set
the original 1e-12 bound.
"""


class SimulationControllerError(Exception):
    """Raised when the controller's own contract is violated.

    Distinct from :class:`~flood_engine.core.solver.wca2d.WCA2DError` and
    :class:`~flood_engine.core.timestepping.TimesteppingError`, which
    already cover invalid inputs to the layers this module calls into and
    are left to propagate unwrapped -- this exception exists only for
    conditions specific to this module's own aggregation, currently just
    the run-level mass-conservation check.
    """


@dataclass(frozen=True, slots=True)
class SimulationResult:
    """Everything one full simulation run produces, aggregated, never recomputed.

    Attributes:
        final_state: The :class:`~flood_engine.core.state.SolverState`
            after the last completed step.
        timestep_records: Every :class:`~flood_engine.core.timestepping.TimestepRecord`
            :func:`~flood_engine.core.timestepping.run_simulation` produced,
            unmodified and in chronological order.
        mass_ledger: The three :class:`~flood_engine.core.state.MassLedger`
            fields, each summed across every step -- a run-level total, not
            a new physical quantity.
        step_count: ``len(timestep_records)``.
        simulated_duration_s: The final record's ``elapsed_s`` -- the
            simulated (not wall-clock) time the run covered.
    """

    final_state: SolverState
    timestep_records: tuple[TimestepRecord, ...]
    mass_ledger: MassLedger
    step_count: int
    simulated_duration_s: float


def _storage_m3(state: SolverState) -> float:
    """Total water volume held in ``state``, in cubic meters.

    Aggregation only -- ``depth * cell_area``, summed -- the exact
    computation ``test_wca2d.py``/``test_timestepping.py`` already use to
    verify per-step conservation, reused here at run scope.
    """
    cell_area_m2 = MODEL_GRID_RESOLUTION_M * MODEL_GRID_RESOLUTION_M
    return float((state.water_depth_m * cell_area_m2).sum())


def run(
    *,
    elevation_m: NDArray[np.float64],
    building_mask: NDArray[np.bool_],
    manning_n: NDArray[np.float64],
    infiltration_loss_mm_per_hr: NDArray[np.float64],
    rainfall_rates_mm_per_hr: NDArray[np.float64],
    solver_parameters: SolverParameters | None = None,
    timestepping_parameters: TimesteppingParameters | None = None,
    total_duration_s: float | None = None,
) -> SimulationResult:
    """Run one full Stage 1 flood simulation and aggregate its output.

    Constructs the dry (``t=0``, zero-depth everywhere) initial
    :class:`~flood_engine.core.state.SolverState` -- the NMS's own
    mass-conservation identity has no ``initial_storage`` term, which is
    only dimensionally correct if initial storage is zero, and SDS
    Section 5's ``flood_scenario`` schema has no initial-state field
    either; both independently imply a dry start, not an invented one.

    Args:
        elevation_m: Terrain elevation ``z(x,y)``, meters. Defines the
            model grid's shape -- every other array must match it.
        building_mask: ``True`` where a cell is fully impermeable.
        manning_n: Manning's roughness coefficient per cell.
        infiltration_loss_mm_per_hr: Per-cell infiltration rate.
        rainfall_rates_mm_per_hr: Hourly rainfall rate anchors starting at
            simulated ``t=0``.
        solver_parameters: The five frozen WCA2D numerical parameters.
            Defaults to :class:`~flood_engine.core.solver.wca2d.SolverParameters`'s
            own defaults.
        timestepping_parameters: The infiltration-cadence parameter.
            Defaults to :class:`~flood_engine.core.timestepping.TimesteppingParameters`'s
            own default.
        total_duration_s: Overrides the default stopping time (event
            duration + recession tail). See
            :func:`~flood_engine.core.timestepping.run_simulation`.

    Returns:
        A :class:`SimulationResult`.

    Raises:
        WCA2DError: if ``building_mask``/``manning_n`` do not match
            ``elevation_m``'s shape, or ``manning_n`` is not strictly
            positive (raised by
            :class:`~flood_engine.core.solver.wca2d.DomainInputs`,
            propagated unwrapped).
        TimesteppingError: if ``rainfall_rates_mm_per_hr`` is empty
            (raised by
            :func:`~flood_engine.core.timestepping.run_simulation`,
            propagated unwrapped).
        SimulationControllerError: if the full-run mass-conservation
            identity does not hold within :data:`MASS_CONSERVATION_RTOL`.
    """
    domain = DomainInputs(
        elevation_m=elevation_m,
        building_mask=building_mask,
        manning_n=manning_n,
    )
    initial_state = SolverState(water_depth_m=np.zeros_like(elevation_m))

    records = run_simulation(
        initial_state=initial_state,
        domain=domain,
        rainfall_rates_mm_per_hr=rainfall_rates_mm_per_hr,
        infiltration_loss_mm_per_hr=infiltration_loss_mm_per_hr,
        solver_parameters=solver_parameters,
        timestepping_parameters=timestepping_parameters,
        total_duration_s=total_duration_s,
    )

    final_state = records[-1].result.state
    ledger = MassLedger(
        rainfall_input_m3=sum(r.result.mass_ledger.rainfall_input_m3 for r in records),
        infiltration_loss_m3=sum(r.result.mass_ledger.infiltration_loss_m3 for r in records),
        boundary_outflow_m3=sum(r.result.mass_ledger.boundary_outflow_m3 for r in records),
    )

    initial_storage_m3 = _storage_m3(initial_state)
    final_storage_m3 = _storage_m3(final_state)
    expected_final_storage_m3 = (
        initial_storage_m3
        + ledger.rainfall_input_m3
        - ledger.boundary_outflow_m3
        - ledger.infiltration_loss_m3
    )
    # Normalized by the mass budget's own scale (the largest term moved
    # during the run), not just final_storage_m3 -- a full run's final
    # storage legitimately approaches zero once the 4-hour recession tail
    # has drained most water out, and dividing by a near-zero final
    # storage would turn ordinary floating-point noise into an apparent
    # large relative error unrelated to any real conservation defect.
    scale_m3 = max(
        abs(initial_storage_m3),
        abs(final_storage_m3),
        abs(ledger.rainfall_input_m3),
        abs(ledger.boundary_outflow_m3),
        abs(ledger.infiltration_loss_m3),
        1e-12,
    )
    relative_error = abs(final_storage_m3 - expected_final_storage_m3) / scale_m3
    if relative_error > MASS_CONSERVATION_RTOL:
        raise SimulationControllerError(
            "Full-run mass conservation failed: final storage "
            f"{final_storage_m3:.6f} m3, expected {expected_final_storage_m3:.6f} m3 "
            f"(relative error {relative_error:.3e} exceeds {MASS_CONSERVATION_RTOL:.3e}). "
            f"initial_storage={initial_storage_m3:.6f}, rainfall={ledger.rainfall_input_m3:.6f}, "
            f"boundary_outflow={ledger.boundary_outflow_m3:.6f}, "
            f"infiltration={ledger.infiltration_loss_m3:.6f}."
        )

    logger.debug(
        "Simulation controller run complete",
        extra={
            "step_count": len(records),
            "simulated_duration_s": records[-1].elapsed_s,
            "rainfall_input_m3": ledger.rainfall_input_m3,
            "infiltration_loss_m3": ledger.infiltration_loss_m3,
            "boundary_outflow_m3": ledger.boundary_outflow_m3,
        },
    )

    return SimulationResult(
        final_state=final_state,
        timestep_records=records,
        mass_ledger=ledger,
        step_count=len(records),
        simulated_duration_s=records[-1].elapsed_s,
    )


__all__ = [
    "MASS_CONSERVATION_RTOL",
    "SimulationControllerError",
    "SimulationResult",
    "run",
]
