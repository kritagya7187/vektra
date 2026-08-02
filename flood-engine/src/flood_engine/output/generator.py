"""output.generator: turns a completed SimulationResult into summary products (Step 14).

Produces exactly the three per-cell summary rasters two independently
frozen documents agree on -- SDS Section 7's ``flood_summary_raster``
entity (``output type: max_depth / arrival_time / duration``) and the
Scientific Architecture diagram's own output box ("Per-cell summary
rasters (max depth, arrival time, duration above threshold)") -- plus the
already-computed run-level metadata :class:`~flood_engine.simulation.controller.SimulationResult`
already carries. A fourth candidate, ``max_velocity_mps``, appears only in
SDS Section 3's prose and not in either of those two frozen enumerations;
excluded here per explicit project-owner confirmation (see the Step 14
freeze audit) rather than resolved silently.

**Why no** :class:`~flood_engine.io.raster_loader.RasterDataset` **appears
here**: constructing one needs a real ``crs``/``transform``, and
:class:`~flood_engine.simulation.controller.SimulationResult` -- this
module's only permitted input -- carries neither (nor does anything else
in ``core``/``simulation``; ``core.grid`` freezes only the EPSG code and
resolution, explicitly not the AOI origin an ``Affine`` transform needs).
Pairing these output arrays with real georeferencing is a not-yet-built
higher layer's job, which still has access to the original DEM's
``RasterDataset`` -- the same resolution already applied to
``RainfallForcing`` in Step 12 and to ``RasterDataset`` itself in Step 13.

Pure aggregation over :attr:`~flood_engine.simulation.controller.SimulationResult.timestep_records`,
exactly matching SDS Section 3's own description of these quantities
("computed once from the full depth time series, not stored
per-timestep") -- no solver logic, no re-derived physics, nothing beyond
comparisons, elementwise max, and summation.
"""

from dataclasses import dataclass
from typing import Final

import numpy as np
from numpy.typing import NDArray

from flood_engine.core.state import MassLedger
from flood_engine.logging_config import LogSubsystem, get_logger
from flood_engine.simulation.controller import SimulationResult

logger = get_logger(LogSubsystem.SIMULATION, "output_generator")

ARRIVAL_THRESHOLD_M: Final[float] = 0.05
"""SDS Section 3's frozen "5cm nuisance threshold" -- sourced exactly, not chosen here.

Governs both ``arrival_time_min`` ("first timestep depth exceeds a 5cm
nuisance threshold") and ``duration_above_threshold_min`` -- SDS reuses
"the" threshold for both quantities rather than defining a second one, so
this module does too.
"""

_SECONDS_PER_MINUTE: Final[float] = 60.0


@dataclass(frozen=True, slots=True)
class FloodOutputSummary:
    """The Step 14 output product: three per-cell summary rasters plus run-level metadata.

    Attributes:
        max_depth_m: Per-cell maximum ``water_depth_m`` across every
            recorded step (and the dry initial state, though including it
            is a no-op -- depth is never negative).
        arrival_time_min: Per-cell simulated time, in minutes, of the
            first step whose depth exceeds :data:`ARRIVAL_THRESHOLD_M`.
            ``NaN`` where the cell never exceeded the threshold during the
            run -- a correct absence of value, not a gap to fill.
        duration_above_threshold_min: Per-cell total time, in minutes,
            summed over every step whose own ending depth exceeded
            :data:`ARRIVAL_THRESHOLD_M`. Zero where never exceeded.
        mass_ledger: :attr:`~flood_engine.simulation.controller.SimulationResult.mass_ledger`,
            unmodified -- the "conservation summary" product, not
            recomputed here.
        step_count: :attr:`~flood_engine.simulation.controller.SimulationResult.step_count`,
            unmodified.
        simulated_duration_s: :attr:`SimulationResult.simulated_duration_s
            <flood_engine.simulation.controller.SimulationResult.simulated_duration_s>`,
            unmodified.
    """

    max_depth_m: NDArray[np.float64]
    arrival_time_min: NDArray[np.float64]
    duration_above_threshold_min: NDArray[np.float64]
    mass_ledger: MassLedger
    step_count: int
    simulated_duration_s: float

    def __post_init__(self) -> None:
        """Freeze the three newly-created raster arrays' backing buffers.

        Matches the immutability discipline already established by
        :class:`~flood_engine.core.state.SolverState` and
        :class:`~flood_engine.io.raster_loader.RasterDataset`: a frozen
        dataclass alone does not stop in-place mutation of an array it
        holds, only reassigning the attribute.
        """
        self.max_depth_m.flags.writeable = False
        self.arrival_time_min.flags.writeable = False
        self.duration_above_threshold_min.flags.writeable = False


def generate_summary(result: SimulationResult) -> FloodOutputSummary:
    """Aggregate one completed run's full depth time series into summary rasters.

    Never reruns the solver, never recomputes the mass ledger, never
    touches ``result`` -- every array produced here is newly allocated;
    ``result.timestep_records`` is only read.

    Args:
        result: A completed :class:`~flood_engine.simulation.controller.SimulationResult`.
            Its ``timestep_records`` is guaranteed non-empty by
            construction (``run_simulation``'s own loop always executes
            at least once), so that case is not separately handled here.

    Returns:
        A :class:`FloodOutputSummary`.
    """
    shape = result.final_state.water_depth_m.shape
    max_depth_m = np.zeros(shape, dtype=np.float64)
    arrival_time_min = np.full(shape, np.nan, dtype=np.float64)
    duration_above_threshold_min = np.zeros(shape, dtype=np.float64)

    for record in result.timestep_records:
        depth = record.result.state.water_depth_m
        max_depth_m = np.maximum(max_depth_m, depth)

        above_threshold = depth > ARRIVAL_THRESHOLD_M

        newly_arrived = above_threshold & np.isnan(arrival_time_min)
        arrival_time_min = np.where(
            newly_arrived, record.elapsed_s / _SECONDS_PER_MINUTE, arrival_time_min
        )

        duration_above_threshold_min = duration_above_threshold_min + np.where(
            above_threshold, record.result.dt_used_s / _SECONDS_PER_MINUTE, 0.0
        )

    logger.debug(
        "Output summary generated",
        extra={
            "step_count": result.step_count,
            "simulated_duration_s": result.simulated_duration_s,
            "max_depth_m_overall": float(max_depth_m.max()) if max_depth_m.size > 0 else None,
        },
    )

    return FloodOutputSummary(
        max_depth_m=max_depth_m,
        arrival_time_min=arrival_time_min,
        duration_above_threshold_min=duration_above_threshold_min,
        mass_ledger=result.mass_ledger,
        step_count=result.step_count,
        simulated_duration_s=result.simulated_duration_s,
    )


__all__ = [
    "ARRIVAL_THRESHOLD_M",
    "FloodOutputSummary",
    "generate_summary",
]
