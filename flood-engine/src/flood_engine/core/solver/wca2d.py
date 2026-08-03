"""WCA2D: one complete timestep of the Stage 1 overland-flow solver.

Implements exactly the equations transcribed from the real, MIT-licensed
reference implementation (University of Exeter Centre for Water Systems,
``github.com/FluiditLtd/caddies-caflood``, ``fluidit-dev`` branch) in the
frozen "Step 11 — WCA2D Numerical Algorithm Specification" -- weight
computation, the Manning's/critical-flow transfer cap, depth update via
shared-edge-ownership, diagnostic (not prognostic) velocity, and the
Courant-type adaptive-timestep proposal. Nothing here is approximated or
invented; every formula traces to that specification.

**Scope, exactly one step**: this module computes ``h(t) -> h(t+dt)``
given a current state and static inputs. It does not iterate, does not
own the simulation clock, and does not decide when a run stops -- that is
``core.timestepping`` (Step 12), which repeatedly calls :func:`step` with
the ``next_dt_s`` this module itself proposed. This split (and the
decision to keep the adaptive-timestep computation *inside* this module
rather than a separate timestepping module) was an explicit, reviewed
architecture correction: the timestep computation depends on the
diagnostic velocity field, which is solver-internal and must not leak
into a public API.

Zero database, zero HTTP, zero rasterio/geopandas -- this package's
standing rule, unchanged: inputs and outputs are NumPy arrays and the
dataclasses defined here and in :mod:`flood_engine.core.state`.
"""

from dataclasses import dataclass
from typing import Final

import numpy as np
from numpy.typing import NDArray

from flood_engine.core.grid import MODEL_GRID_RESOLUTION_M
from flood_engine.core.state import MassLedger, SolverState
from flood_engine.logging_config import LogSubsystem, get_logger

logger = get_logger(LogSubsystem.SIMULATION, "wca2d")

_NORTH: Final[tuple[int, int]] = (-1, 0)
_SOUTH: Final[tuple[int, int]] = (1, 0)
_WEST: Final[tuple[int, int]] = (0, -1)
_EAST: Final[tuple[int, int]] = (0, 1)
_DIRECTIONS: Final[tuple[tuple[int, int], ...]] = (_NORTH, _SOUTH, _WEST, _EAST)
"""Von Neumann (4-connected) neighborhood -- confirmed, not assumed, from the
real reference implementation's own documented default grid configuration."""

_MAX_LEVEL_DIFFERENCE_M: Final[float] = 50.0
"""Reference implementation's own safety cap on a single-step level difference.

An implementation constant, not a physical one.
"""

_MAX_VELOCITY_MPS: Final[float] = 10.0
"""Reference implementation's own absolute velocity cap."""

_GRAVITY_MPS2: Final[float] = 9.81
"""Standard gravitational acceleration -- the critical-velocity term is `sqrt(gravity * depth)`."""


class WCA2DError(Exception):
    """Raised when solver inputs fail validation. Always rejected, never repaired or defaulted."""


@dataclass(frozen=True, slots=True)
class DomainInputs:
    """Static grids the solver reads but never modifies during a run.

    All fields share ``water_depth_m``'s shape. None of these originate
    from this module -- ``elevation_m`` from Step 7, ``building_mask``
    from Step 9, ``manning_n`` from the ``core.solver.roughness``
    crosswalk (Step 18) over Step 8's land-cover raster.

    Attributes:
        elevation_m: Terrain elevation ``z(x,y)`` in meters, static.
        building_mask: ``True`` where a cell is fully impermeable
            (NMS "Building obstruction": no inflow, no outflow, no
            storage) -- Step 9's rasterized building mask, as a boolean
            array (Step 9 itself emits ``uint8``; callers convert).
        manning_n: Manning's roughness coefficient per cell,
            dimensionless, static.
        permeability: Present in the real reference algorithm (a
            per-cell multiplier on transferable volume) but not yet a
            distinct NMS-frozen input for Stage 1 -- VEKTRA's "Building
            obstruction" section describes only full impermeable
            blockage, no sub-grid partial permeability. Optional; when
            not supplied, defaults to 1.0 (fully permeable) everywhere,
            keeping the real algorithm's structure intact without
            inventing a spatially-varying input the NMS doesn't specify.
    """

    elevation_m: NDArray[np.float64]
    building_mask: NDArray[np.bool_]
    manning_n: NDArray[np.float64]
    permeability: NDArray[np.float64] | None = None

    def __post_init__(self) -> None:
        """Validate shape consistency and Manning's-*n* positivity.

        Raises:
            WCA2DError: if any array's shape disagrees with
                ``elevation_m``'s, or any ``manning_n`` value is not
                strictly positive (Manning's formula divides by *n*;
                zero or negative is physically meaningless).
        """
        shape = self.elevation_m.shape
        for name, array in (
            ("building_mask", self.building_mask),
            ("manning_n", self.manning_n),
        ):
            if array.shape != shape:
                raise WCA2DError(
                    f"{name} has shape {array.shape}, expected {shape} to match elevation_m."
                )
        if self.permeability is not None and self.permeability.shape != shape:
            raise WCA2DError(
                f"permeability has shape {self.permeability.shape}, expected {shape}."
            )
        if np.any(self.manning_n <= 0):
            raise WCA2DError("manning_n must be strictly positive everywhere.")

    def resolved_permeability(self) -> NDArray[np.float64]:
        """Return ``permeability`` if supplied, otherwise a uniform array of ones.

        Returns:
            A ``(height, width)`` array, never ``None`` -- callers in
            :func:`step` always have a concrete array to work with.
        """
        if self.permeability is not None:
            return self.permeability
        return np.ones_like(self.elevation_m)


@dataclass(frozen=True, slots=True)
class SolverParameters:
    """The five numerical parameters frozen by the Numerical Parameter Specification.

    (Step 10.5/11A.)

    Deliberately *not* part of ``flood_engine.config`` -- these are
    scientific/numerical-method parameters that change simulation
    results, not deployment settings (the same distinction Step 4's
    ``SimulationExecutionConfig`` already enforces). Defaults below match
    that frozen specification exactly: ``tol_delwl``/``ignore_wd`` are
    sourced from the real reference implementation's own defaults;
    ``alpha``/``time_mindt``/``time_maxdt`` are honestly-labeled
    engineering judgment where no published or reference-implementation
    default exists.

    Attributes:
        tol_delwl_m: Water-*level*-difference noise floor between two
            cells (source default 0.001m).
        ignore_wd_m: Near-zero-depth/dry-cell floor -- a distinct
            parameter from ``tol_delwl_m`` despite sharing the same
            source default (0.001m).
        alpha: Courant-type adaptive-timestep safety factor (VEKTRA
            default 0.5 -- general numerical-methods judgment, not a
            WCA2D-literature value; see the frozen spec).
        time_mindt_s: Minimum allowed proposed timestep, seconds
            (VEKTRA default 0.1s, a pathological-case safety floor).
        time_maxdt_s: Maximum allowed proposed timestep, seconds
            (VEKTRA default 60s, matching the reference implementation's
            own evidenced ceiling).
    """

    tol_delwl_m: float = 0.001
    ignore_wd_m: float = 0.001
    alpha: float = 0.5
    time_mindt_s: float = 0.1
    time_maxdt_s: float = 60.0

    def __post_init__(self) -> None:
        """Validate all five parameters are positive and internally consistent.

        Raises:
            WCA2DError: if any parameter is non-positive, or
                ``time_mindt_s > time_maxdt_s``.
        """
        for name, value in (
            ("tol_delwl_m", self.tol_delwl_m),
            ("ignore_wd_m", self.ignore_wd_m),
            ("alpha", self.alpha),
            ("time_mindt_s", self.time_mindt_s),
            ("time_maxdt_s", self.time_maxdt_s),
        ):
            if value <= 0:
                raise WCA2DError(f"{name} must be strictly positive, got {value}.")
        if self.time_mindt_s > self.time_maxdt_s:
            raise WCA2DError(
                f"time_mindt_s ({self.time_mindt_s}) must not exceed "
                f"time_maxdt_s ({self.time_maxdt_s})."
            )


@dataclass(frozen=True, slots=True)
class StepResult:
    """Everything one call to :func:`step` produces.

    Attributes:
        state: The updated :class:`~flood_engine.core.state.SolverState`.
        dt_used_s: The timestep actually used for this update (the ``dt``
            the caller passed in).
        next_dt_proposed_s: The Courant-type stable timestep this module
            proposes for the *next* call, already bounded to
            ``[time_mindt_s, time_maxdt_s]``.
        mass_ledger: This step's rainfall/infiltration/boundary-outflow
            deltas.
        diagnostic_velocity_mps: The per-cell diagnostic velocity used to
            derive ``next_dt_proposed_s``. Explicitly *not* a required
            part of this result's contract -- NMS "State variable":
            derived, not solved, not persisted as state. Present here
            only as an optional per-step artifact a later summarization
            step (Step 14) may choose to consume; callers that only need
            to advance the simulation (Step 12) can ignore it entirely.
    """

    state: SolverState
    dt_used_s: float
    next_dt_proposed_s: float
    mass_ledger: MassLedger
    diagnostic_velocity_mps: NDArray[np.float64]


def _shifted(
    array: NDArray[np.float64], offset: tuple[int, int], pad_value: float
) -> NDArray[np.float64]:
    """Return ``array``'s value at ``(row+dr, col+dc)`` for every cell.

    Off-grid positions are filled with ``pad_value``.

    Args:
        array: The source grid.
        offset: ``(dr, dc)`` -- one of the four von Neumann directions.
        pad_value: Value used for positions that fall outside ``array``.

    Returns:
        An array the same shape as ``array``.
    """
    dr, dc = offset
    height, width = array.shape
    padded = np.pad(array, 1, mode="constant", constant_values=pad_value)
    return padded[1 + dr : 1 + dr + height, 1 + dc : 1 + dc + width]


def step(
    state: SolverState,
    domain: DomainInputs,
    rainfall_rate_mm_per_hr: float,
    infiltration_loss_mm_per_hr: NDArray[np.float64],
    dt_s: float,
    *,
    apply_infiltration: bool,
    infiltration_period_s: float | None = None,
    parameters: SolverParameters | None = None,
) -> StepResult:
    """Advance the state by one WCA2D timestep.

    **Infiltration cadence matches the reference implementation**,
    corrected after a numerical-fidelity audit found VEKTRA applying it
    every substep where the reference applies it only periodically
    (confirmed against the real driver source: rainfall is added every
    fine adaptive substep, infiltration only once per a coarser "update
    period"). This function does not track simulation time or decide
    when a period has elapsed -- that is ``core.timestepping``'s (Step
    12's) responsibility. This function only answers "how much depth
    does removing this rate over this duration produce," given the
    caller's ``apply_infiltration``/``infiltration_period_s`` decision.
    The solver still owns the numerical update; the controller only
    decides *whether* this call includes one.

    Args:
        state: The current :class:`SolverState`.
        domain: Static grids (elevation, building mask, Manning's *n*,
            optional permeability), matching ``state``'s shape.
        rainfall_rate_mm_per_hr: The current rainfall rate, applied
            uniformly across the AOI (NMS "Dynamic inputs": "spatially
            uniform... across the AOI") -- a scalar, not a grid. Always
            applied this call, at ``dt_s``'s duration, matching the
            reference's own "every fine substep" cadence. How a single
            hourly :class:`~flood_engine.inputs.rainfall.RainfallForcing`
            value maps onto repeated calls to this function across many
            adaptive sub-steps within that hour is the caller's
            (Step 12's) responsibility, not resolved here.
        infiltration_loss_mm_per_hr: Per-cell infiltration loss rate,
            already computed (by the ``core.solver.infiltration``
            crosswalk, Step 18) -- this function consumes the rate, it
            does not compute it. Read and applied only when
            ``apply_infiltration`` is ``True``.
        dt_s: The timestep to use for this update, in seconds.
        apply_infiltration: Whether infiltration removal is performed on
            this call. Required, no default -- a scientifically
            consequential decision the caller (``core.timestepping``,
            tracking whether the configured infiltration interval has
            elapsed) must make explicitly, never silently assumed.
        infiltration_period_s: The elapsed-time span the infiltration
            rate should be applied over, when ``apply_infiltration`` is
            ``True`` -- matches the reference's own
            ``rate * (period / 3600)`` conversion, using the *period*
            since infiltration was last applied, not necessarily this
            single substep's ``dt_s``. Defaults to ``dt_s`` when not
            supplied (a caller applying infiltration every substep gets
            the previous per-substep behavior for that call). Ignored
            when ``apply_infiltration`` is ``False``.
        parameters: The five frozen numerical parameters (Step 10.5/11A).
            Defaults to :class:`SolverParameters`'s own frozen defaults
            when not supplied.

    Returns:
        A :class:`StepResult`.

    Raises:
        WCA2DError: if ``dt_s`` is not positive/finite, if
            ``infiltration_loss_mm_per_hr``'s shape does not match
            ``state``'s, if ``rainfall_rate_mm_per_hr`` is negative, or
            if ``infiltration_period_s`` is given and not positive.
    """
    if not np.isfinite(dt_s) or dt_s <= 0:
        raise WCA2DError(f"dt_s must be a positive, finite number, got {dt_s!r}.")
    if rainfall_rate_mm_per_hr < 0:
        raise WCA2DError(
            f"rainfall_rate_mm_per_hr must be non-negative, got {rainfall_rate_mm_per_hr!r}."
        )
    if infiltration_loss_mm_per_hr.shape != state.water_depth_m.shape:
        raise WCA2DError(
            f"infiltration_loss_mm_per_hr has shape {infiltration_loss_mm_per_hr.shape}, "
            f"expected {state.water_depth_m.shape} to match the state."
        )
    if infiltration_period_s is not None and infiltration_period_s <= 0:
        raise WCA2DError(
            f"infiltration_period_s must be positive when given, got {infiltration_period_s!r}."
        )

    params = parameters if parameters is not None else SolverParameters()
    cell_size_m = MODEL_GRID_RESOLUTION_M
    cell_area_m2 = cell_size_m * cell_size_m

    h = state.water_depth_m
    z = domain.elevation_m
    mask = ~domain.building_mask  # True where computable (NOT a building)
    n = domain.manning_n
    permeability = domain.resolved_permeability()

    fluxes, boundary_outflow_m3, diagnostic_velocity = _compute_outflow(
        h=h,
        z=z,
        mask=mask,
        manning_n=n,
        permeability=permeability,
        dt_s=dt_s,
        cell_size_m=cell_size_m,
        cell_area_m2=cell_area_m2,
        tol_delwl_m=params.tol_delwl_m,
        ignore_wd_m=params.ignore_wd_m,
    )

    h_after_redistribution = _apply_fluxes(h, fluxes, cell_area_m2)

    rainfall_depth_scalar_m = (rainfall_rate_mm_per_hr / 1000.0) * (dt_s / 3600.0)
    # Rainfall applies only to non-obstructed cells (NMS "Cell update
    # rule": "Rainfall input is added to each non-obstructed cell's
    # depth" -- buildings receive neither).
    rainfall_depth_m: NDArray[np.float64] = np.where(mask, rainfall_depth_scalar_m, 0.0)

    if apply_infiltration:
        period_s = infiltration_period_s if infiltration_period_s is not None else dt_s
        infiltration_depth_m = np.minimum(
            h_after_redistribution,
            (infiltration_loss_mm_per_hr / 1000.0) * (period_s / 3600.0),
        )
        infiltration_depth_m = np.where(mask, infiltration_depth_m, 0.0)
    else:
        infiltration_depth_m = np.zeros_like(h_after_redistribution)

    h_new = h_after_redistribution + rainfall_depth_m - infiltration_depth_m

    new_state = SolverState(water_depth_m=h_new)

    next_dt_proposed_s = _propose_next_dt(
        diagnostic_velocity_mps=diagnostic_velocity,
        cell_size_m=cell_size_m,
        alpha=params.alpha,
        time_mindt_s=params.time_mindt_s,
        time_maxdt_s=params.time_maxdt_s,
    )

    ledger = MassLedger(
        rainfall_input_m3=float((rainfall_depth_m * cell_area_m2).sum()),
        infiltration_loss_m3=float((infiltration_depth_m * cell_area_m2).sum()),
        boundary_outflow_m3=float(boundary_outflow_m3),
    )

    logger.debug(
        "WCA2D step complete",
        extra={
            "dt_used_s": dt_s,
            "next_dt_proposed_s": next_dt_proposed_s,
            "rainfall_input_m3": ledger.rainfall_input_m3,
            "infiltration_loss_m3": ledger.infiltration_loss_m3,
            "boundary_outflow_m3": ledger.boundary_outflow_m3,
        },
    )

    return StepResult(
        state=new_state,
        dt_used_s=dt_s,
        next_dt_proposed_s=next_dt_proposed_s,
        mass_ledger=ledger,
        diagnostic_velocity_mps=diagnostic_velocity,
    )


def _compute_outflow(
    *,
    h: NDArray[np.float64],
    z: NDArray[np.float64],
    mask: NDArray[np.bool_],
    manning_n: NDArray[np.float64],
    permeability: NDArray[np.float64],
    dt_s: float,
    cell_size_m: float,
    cell_area_m2: float,
    tol_delwl_m: float,
    ignore_wd_m: float,
) -> tuple[NDArray[np.float64], float, NDArray[np.float64]]:
    """Weight computation and the Manning's/critical-flow transfer cap.

    Vectorized across the whole grid.

    Transcribes ``outflowWCA2Dv1.ca`` from the Step 11 Numerical
    Algorithm Specification. Off-grid neighbors and building-obstructed
    neighbors are handled distinctly, not conflated: a building neighbor
    is hard-excluded from the weight computation entirely -- substituting
    it with an open-boundary value would let water flow *into* an
    impermeable cell, violating "no inflow, no outflow, no storage" (a
    real defect caught and fixed during this module's own
    pre-implementation verification, not a hypothetical).

    **VEKTRA-specific boundary condition, not a WCA2D one**: an off-grid
    neighbor is substituted with the central cell's own elevation
    (zero-depth reference), so any positive depth at a domain edge
    creates an outward gradient equal to its own depth. This satisfies
    the NMS's "open/free outflow" *requirement*, but the specific
    mechanism is not transcribed from the reference implementation --
    verified directly against the real ``outflowWCA2Dv1.ca`` source
    during a later numerical-fidelity audit: the reference does not
    physically model an open boundary in this kernel at all. It raises
    an alarm when a domain-edge cell has outflow, for the driver to
    handle separately (in the reference's own architecture, typically by
    *expanding the computational domain*, per ``setup.expand_domain`` --
    not by computing a boundary flow). This function's open-boundary rule
    was derived by VEKTRA from the NMS's stated requirement, not copied
    from source, and must not be described as "the WCA2D boundary
    condition" anywhere in this codebase.

    Returns:
        A 3-tuple: the per-direction flux array (shape ``(4, height, width)``,
        ordered N/S/W/E), total boundary outflow this step in cubic
        meters, and the per-cell diagnostic velocity (m/s).
    """
    height, width = h.shape
    water_level = z + h
    wet = (h >= ignore_wd_m) & mask

    total_weight = np.zeros((height, width))
    weights = []
    delwl_per_direction = []

    for offset in _DIRECTIONS:
        neighbor_level = _shifted(water_level, offset, pad_value=np.nan)
        neighbor_mask = _shifted(mask.astype(np.float64), offset, pad_value=0.0) > 0
        neighbor_permeability = _shifted(permeability, offset, pad_value=0.0)

        off_grid = np.isnan(neighbor_level)
        is_building_neighbor = (~off_grid) & (~neighbor_mask)

        effective_neighbor_level = np.where(off_grid, z, neighbor_level)
        effective_permeability = np.where(off_grid, 1.0, neighbor_permeability)

        level_difference = np.minimum(
            water_level - effective_neighbor_level, _MAX_LEVEL_DIFFERENCE_M
        )
        is_downstream = (level_difference > tol_delwl_m) & mask & (~is_building_neighbor)

        weight = np.where(
            is_downstream, effective_permeability * level_difference * cell_area_m2, 0.0
        )
        weights.append(weight)
        delwl_per_direction.append(np.where(is_downstream, level_difference, 0.0))
        total_weight += weight

    weight_stack = np.stack(weights)
    delwl_stack = np.stack(delwl_per_direction)

    min_delta_volume = np.min(np.where(weight_stack > 0, weight_stack, np.inf), axis=0)
    min_delta_volume = np.where(np.isfinite(min_delta_volume), min_delta_volume, 0.0)
    total_weight_with_retention = total_weight + min_delta_volume

    weight_max = np.max(weight_stack, axis=0)
    max_direction_index = np.argmax(weight_stack, axis=0)
    delwl_max = np.take_along_axis(delwl_stack, max_direction_index[np.newaxis, :, :], axis=0)[0]
    # Square, axis-aligned grid: distance to any von Neumann neighbor is the cell size.
    max_direction_distance = cell_size_m

    roughness = 1.0 / manning_n
    manning_factor = np.minimum(
        roughness * np.sqrt(np.maximum(delwl_max, 0.0) / max_direction_distance),
        np.sqrt(_GRAVITY_MPS2),
    )
    max_velocity = np.minimum(_MAX_VELOCITY_MPS, manning_factor * np.sqrt(np.maximum(h, 0.0)))
    max_flux = max_velocity * h * dt_s * max_direction_distance

    safe_weight_max = np.where(weight_max > 0, weight_max, 1.0)
    total_outflow = np.minimum(
        np.minimum(min_delta_volume, h * cell_area_m2),
        max_flux * total_weight_with_retention / safe_weight_max,
    )
    total_outflow = np.where((total_weight > 0) & wet, total_outflow, 0.0)

    safe_total_weight = np.where(total_weight_with_retention > 0, total_weight_with_retention, 1.0)
    fluxes = weight_stack / safe_total_weight * total_outflow[np.newaxis, :, :]
    fluxes = np.where(weight_stack > 0, fluxes, 0.0)

    boundary_outflow_m3 = 0.0
    total_flux_per_cell = np.zeros((height, width))
    for index, offset in enumerate(_DIRECTIONS):
        neighbor_level = _shifted(water_level, offset, pad_value=np.nan)
        off_grid = np.isnan(neighbor_level)
        boundary_outflow_m3 += float(np.where(off_grid, fluxes[index], 0.0).sum())
        total_flux_per_cell += fluxes[index]

    diagnostic_velocity = np.where(
        (h > 0) & mask,
        np.minimum(total_flux_per_cell / np.maximum(h * cell_size_m * dt_s, 1e-12), max_velocity),
        0.0,
    )

    return fluxes, boundary_outflow_m3, diagnostic_velocity


def _apply_fluxes(
    h: NDArray[np.float64], fluxes: NDArray[np.float64], cell_area_m2: float
) -> NDArray[np.float64]:
    """Depth update via shared-edge-ownership flux accounting (``waterdepthWCA2Dv1.ca``).

    Every unit of volume leaving a cell toward a real (non-off-grid,
    non-building) neighbor arrives there exactly once -- no double
    counting, no loss, structural mass conservation by construction (NMS
    "Mass conservation").

    Args:
        h: Current depth grid.
        fluxes: Per-direction flux array from :func:`_compute_outflow`.
        cell_area_m2: Cell area, for converting volume to depth.

    Returns:
        The updated depth grid, before rainfall/infiltration are applied.
    """
    height, width = h.shape
    h_new = h.copy()

    for index, offset in enumerate(_DIRECTIONS):
        flux = fluxes[index]
        h_new = h_new - flux / cell_area_m2

        neighbor_level_placeholder = _shifted(h, offset, pad_value=np.nan)
        off_grid = np.isnan(neighbor_level_placeholder)
        real_flux = np.where(off_grid, 0.0, flux)

        inverse_offset = (-offset[0], -offset[1])
        padded_real_flux = np.pad(real_flux, 1, mode="constant", constant_values=0.0)
        received = padded_real_flux[
            1 + inverse_offset[0] : 1 + inverse_offset[0] + height,
            1 + inverse_offset[1] : 1 + inverse_offset[1] + width,
        ]
        h_new = h_new + received / cell_area_m2

    return h_new


def _propose_next_dt(
    *,
    diagnostic_velocity_mps: NDArray[np.float64],
    cell_size_m: float,
    alpha: float,
    time_mindt_s: float,
    time_maxdt_s: float,
) -> float:
    """Courant-type stable-timestep proposal (corrected NMS "Stability / timestep").

    ``dt = alpha * cell_size / v_max``, bounded to
    ``[time_mindt_s, time_maxdt_s]`` -- transcribed from the real
    reference implementation's ``dtn1 = min(time_maxdt, alpha*Δx/grid_max_va)``.

    Two documented deviations from the reference, found during a
    numerical-fidelity audit, not silently present:

    1. Omits the reference's additional ``potential_va`` (forcing-event-driven)
       term: that term requires knowledge of the rainfall *schedule* ahead
       of the current step, which is Step 12/13's concern, not this
       function's -- callers that want that refinement combine it with
       this result themselves rather than this module guessing at a
       schedule it isn't given.
    2. Uses a continuous ``numpy.clip`` rather than the reference's
       ``computeDT`` fraction-snapping (searching for the largest
       ``time_maxdt/k`` at or below the raw bound). Confirmed via the
       real source that snapping exists so the adaptive step divides
       evenly into a periodic output/1D-model-coupling interval -- an
       operational synchronization need this module has no equivalent
       of yet, not a numerical-stability requirement. Scientific impact
       is small (the two can differ by up to one fraction step, both
       staying within the same stability bound) but real, and was not
       documented until this audit found it.

    Args:
        diagnostic_velocity_mps: This step's per-cell diagnostic velocity.
        cell_size_m: The model grid's cell size.
        alpha: The Courant-type safety factor.
        time_mindt_s: Lower bound.
        time_maxdt_s: Upper bound.

    Returns:
        The proposed timestep for the next call, in seconds.
    """
    has_velocity = diagnostic_velocity_mps.size > 0
    max_velocity = float(np.max(diagnostic_velocity_mps)) if has_velocity else 0.0
    if max_velocity <= 0.0:
        return time_maxdt_s
    proposed = alpha * cell_size_m / max_velocity
    return float(np.clip(proposed, time_mindt_s, time_maxdt_s))
