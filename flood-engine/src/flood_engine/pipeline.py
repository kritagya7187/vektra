"""pipeline: wires the static-input preprocessing chain into simulation.controller.run()'s inputs.

``simulation.controller``'s own module docstring names exactly this gap:
*"Unwrapping [RasterDataset/RainfallForcing] into the raw arrays this
module actually needs is the job of whatever not-yet-built layer sits
above `simulation` (a future API/job layer)."* This module is that layer
-- built for the Step 18 end-to-end integration requirement ("construct
the first complete simulation using every frozen module... no shortcut
implementations"), not a redesign of anything it calls.

Sits **above** ``simulation`` in the frozen dependency direction (see the
package docstring's own diagram: ``core <- simulation, inputs <- api, io,
preprocessing, jobs, persistence``) -- it is the first module allowed to
import both ``preprocessing``/``io``/``inputs`` (the "already-prepared
inputs" side) and ``simulation`` (the "drives core over real inputs"
side) in the same place. Nothing in ``core``, ``simulation``, ``inputs``,
``io``, or ``preprocessing`` imports this module -- it only imports them,
preserving the one-directional rule those layers were built under.

Performs orchestration only: calls each frozen preprocessing/crosswalk
function exactly once, in the NMS's own documented order, and passes
their output on unmodified. No physics, no numerical computation, no new
scientific logic -- every number placed in the output arrays was already
computed by a frozen Steps 1-17 module or a Step 18 crosswalk
(``core.solver.roughness``/``core.solver.infiltration``) built to close
a real, disclosed architecture-verification gap.
"""

from dataclasses import dataclass

import geopandas as gpd
import numpy as np
from numpy.typing import NDArray

from flood_engine.core.solver.infiltration import infiltration_grid
from flood_engine.core.solver.roughness import roughness_grid
from flood_engine.inputs.rainfall import RainfallForcing
from flood_engine.io.raster_loader import RasterDataset
from flood_engine.logging_config import LogSubsystem, get_logger
from flood_engine.preprocessing.building_rasterization import rasterize_buildings
from flood_engine.preprocessing.dem_preprocessing import preprocess_dem
from flood_engine.preprocessing.landcover_preprocessing import preprocess_landcover

logger = get_logger(LogSubsystem.SIMULATION, "pipeline")


class PipelineError(Exception):
    """Raised when the static-input pipeline cannot produce a complete, solver-ready grid.

    Distinct from every frozen layer's own exceptions (``RasterValidationError``,
    ``RoughnessError``, ``InfiltrationError``, ...), which are left to
    propagate unwrapped -- this exists only for conditions specific to
    this module's own orchestration, currently just incomplete DEM
    coverage after alignment.
    """


@dataclass(frozen=True, slots=True)
class SimulationInputs:
    """The exact keyword-argument set :func:`~flood_engine.simulation.controller.run` requires.

    A plain data-holder, not a new abstraction over the frozen
    ``simulation.controller.run`` signature -- field names and types match
    it exactly so a caller can pass this straight through
    (``controller.run(**dataclasses.asdict(inputs))`` or by field access),
    with no re-interpretation at the call site.
    """

    elevation_m: NDArray[np.float64]
    building_mask: NDArray[np.bool_]
    manning_n: NDArray[np.float64]
    infiltration_loss_mm_per_hr: NDArray[np.float64]
    rainfall_rates_mm_per_hr: NDArray[np.float64]


def build_simulation_inputs(
    *,
    dem: RasterDataset,
    landcover: RasterDataset,
    buildings: gpd.GeoDataFrame,
    rainfall: RainfallForcing,
) -> SimulationInputs:
    """Run the full static-input preprocessing chain and produce solver-ready raw arrays.

    Execution order, matching the NMS's own frozen "Static inputs" list
    and Step 18's required execution chain exactly: DEM reprojection
    defines the model grid; land cover and buildings are each aligned
    onto *that* grid (not independently computed ones); roughness and
    infiltration are derived from the aligned land cover (and the
    building mask, for the inert-placeholder/impervious override both
    crosswalks apply under a building); rainfall passes through
    unmodified (already the exact array shape ``simulation.controller.run``
    needs, per Step 12's own resolution of this same unwrapping problem
    for rainfall specifically).

    Args:
        dem: A loaded, validated DEM raster (any CRS, as produced by
            :func:`~flood_engine.io.raster_loader.load_raster`).
        landcover: A loaded, validated ESA WorldCover raster (any CRS).
        buildings: Building footprint polygons, in the *same CRS the DEM
            will be reprojected to* (``core.grid.MODEL_GRID_EPSG_CODE``) --
            :func:`~flood_engine.preprocessing.building_rasterization.rasterize_buildings`
            never reprojects, so the caller must reproject building
            geometries before calling this function if they are not
            already in that CRS.
        rainfall: A validated rainfall forcing time series.

    Returns:
        A :class:`SimulationInputs` ready to pass to
        :func:`~flood_engine.simulation.controller.run`.

    Raises:
        RasterValidationError: propagated unwrapped from DEM/land-cover
            preprocessing (e.g. missing nodata sentinel).
        PipelineError: if the reprojected DEM contains nodata cells --
            the destination model grid is not fully covered by the source
            DEM's footprint, which every downstream array assumes never
            happens (the solver has no nodata concept at all; feeding it
            a sentinel elevation value would silently corrupt the
            physics, not fail loudly). AOI/DEM-coverage resolution is
            explicitly unresolved in the frozen NMS ("Grid" section) --
            this is a real, disclosed limitation, not a defect being
            silently worked around here.
        RoughnessError: propagated unwrapped if the aligned land-cover
            grid contains a class code (including a land-cover nodata
            sentinel) absent from the frozen roughness table.
        InfiltrationError: propagated unwrapped, same condition as above,
            for the infiltration table.
    """
    logger.debug("Pipeline: preprocessing DEM")
    dem_on_model_grid = preprocess_dem(dem)

    if dem_on_model_grid.nodata is not None and np.any(
        dem_on_model_grid.data == dem_on_model_grid.nodata
    ):
        nodata_count = int(np.sum(dem_on_model_grid.data == dem_on_model_grid.nodata))
        raise PipelineError(
            f"Reprojected DEM has {nodata_count} nodata cell(s) -- the source DEM's "
            "footprint does not fully cover the destination model grid. AOI/DEM "
            "coverage is an explicitly unresolved item in the frozen Numerical Model "
            "Specification's 'Grid' section; this pipeline refuses to feed a nodata "
            "sentinel into the solver as if it were a real elevation value."
        )

    logger.debug("Pipeline: preprocessing land cover")
    landcover_on_model_grid = preprocess_landcover(landcover, dem_on_model_grid)

    logger.debug("Pipeline: rasterizing buildings")
    building_mask_raster = rasterize_buildings(buildings, dem_on_model_grid)
    building_mask = building_mask_raster.data.astype(np.bool_)

    logger.debug("Pipeline: deriving roughness grid")
    manning_n = roughness_grid(landcover_on_model_grid.data, building_mask=building_mask)

    logger.debug("Pipeline: deriving infiltration grid")
    infiltration = infiltration_grid(landcover_on_model_grid.data, building_mask=building_mask)

    logger.info(
        "Pipeline: static inputs ready",
        extra={
            "height": dem_on_model_grid.height,
            "width": dem_on_model_grid.width,
            "building_cell_count": int(np.count_nonzero(building_mask)),
        },
    )

    return SimulationInputs(
        elevation_m=dem_on_model_grid.data.astype(np.float64),
        building_mask=building_mask,
        manning_n=manning_n,
        infiltration_loss_mm_per_hr=infiltration,
        rainfall_rates_mm_per_hr=rainfall.rainfall_mm_per_hr,
    )


__all__ = ["PipelineError", "SimulationInputs", "build_simulation_inputs"]
