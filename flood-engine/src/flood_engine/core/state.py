"""Core cross-layer data types: the Digital-Twin state and mass-conservation bookkeeping.

``h(x,y,t)``, water depth, is the sole prognostic state variable the WCA2D
solver advances (NMS "State variable", SDS Section 3). Everything else the
solver touches (elevation, building mask, Manning's *n*) is a static domain
input, not evolving state -- see :mod:`flood_engine.core.solver.wca2d`'s
own ``DomainInputs``.

**Why** :class:`MassLedger` **lives here, not in** ``core.solver.wca2d``:
originally defined alongside :class:`~flood_engine.core.solver.wca2d.StepResult`,
a Step 14 freeze review found every downstream layer that needs it
(``simulation.controller``, ``output.generator``, and future
persistence/API/validation/visualization layers) was acquiring an
unnecessary dependency on the solver module just for this one data type --
none of them need any actual solver logic. Moved here as a neutral,
solver-independent home: ``core.solver.wca2d`` still defines and populates
it (importing it from here, the same relationship every other consumer
now has), but no longer *owns* it. This is a pure relocation -- the type's
fields, semantics, and every value ever placed in one are unchanged.

Follows the exact immutability discipline already established by
:class:`~flood_engine.io.raster_loader.RasterDataset` (Step 6): frozen
dataclasses, backing arrays marked read-only in ``__post_init__``. This
module has no rasterio/geopandas/database dependency -- pure NumPy and
dataclasses, per ``core/``'s own architecture rule.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray


class SolverStateError(Exception):
    """Raised when a :class:`SolverState` fails validation. Always rejected, never repaired."""


@dataclass(frozen=True, slots=True)
class SolverState:
    """The evolving Digital-Twin state at one point in simulated time.

    Attributes:
        water_depth_m: The sole prognostic variable, ``h(x,y,t)`` in
            meters, shape ``(height, width)``. Non-negative everywhere.
    """

    water_depth_m: NDArray[np.float64]

    def __post_init__(self) -> None:
        """Validate shape/finiteness/non-negativity and freeze the backing array.

        Raises:
            SolverStateError: if the array is not 2D, contains non-finite
                values (NaN/inf), or contains any negative depth --
                negative depth is physically impossible and must never be
                silently clipped or repaired here (NMS "State variable":
                depth is non-negative by definition, not by correction).
        """
        if self.water_depth_m.ndim != 2:
            raise SolverStateError(
                f"water_depth_m must be 2D (height, width), got shape {self.water_depth_m.shape}."
            )
        if not np.all(np.isfinite(self.water_depth_m)):
            raise SolverStateError("water_depth_m contains non-finite values (NaN or inf).")
        if np.any(self.water_depth_m < 0):
            negative_count = int(np.sum(self.water_depth_m < 0))
            raise SolverStateError(
                f"{negative_count} cell(s) have negative water depth -- physically impossible."
            )

        self.water_depth_m.flags.writeable = False

    @property
    def height(self) -> int:
        """Row count, from the array's own shape."""
        return int(self.water_depth_m.shape[0])

    @property
    def width(self) -> int:
        """Column count, from the array's own shape."""
        return int(self.water_depth_m.shape[1])


@dataclass(frozen=True, slots=True)
class MassLedger:
    """One step's mass-conservation bookkeeping (NMS "Mass conservation").

    Every quantity in cubic meters, summed over the whole grid for this
    step only -- not a running total (the caller, eventually
    ``core.timestepping``, accumulates these across a run for the NMS's
    frozen post-run check: ``rainfall_input == final_storage +
    boundary_outflow + infiltration_loss``, within floating-point
    tolerance).
    """

    rainfall_input_m3: float
    infiltration_loss_m3: float
    boundary_outflow_m3: float
