"""Land-cover preprocessing: aligns ESA WorldCover to the model grid.

Implements exactly the NMS's frozen "Static inputs" sentence: "Land cover:
ESA WorldCover (10m native, majority-resampled to the 30m model grid)."
Majority (mode) resampling is not a choice made here -- it is the NMS's
own explicit wording, the correct standard technique for downsampling
categorical/classified data (unlike DEM elevation, land-cover pixel values
are discrete class codes; bilinear/cubic interpolation would average them
into meaningless fractional values).

**This module does not interpret land-cover values at all.** It does not
know or care what class code 10 or 50 means, does not assign Manning's
roughness, does not assign infiltration/Curve Number values. The NMS's own
sentence continues "-> mapped to a roughness class (table below)" --
that crosswalk belongs to ``core.solver.roughness`` (Step 1's own module
assignment), built in Step 11+, not here. Step 8 produces a correctly
aligned raster of untouched source class codes; later stages give it
scientific meaning.

**Aligns to an explicit, already-established target grid, not a freshly
computed one.** Unlike DEM preprocessing (Step 7), which had nothing else
to align to and had to compute a destination grid via
``calculate_default_transform``, this module receives the Step 7 DEM
output's own transform/shape as ``model_grid`` and reprojects directly
onto it -- this is what makes "Grid alignment must match the DEM exactly"
true by construction rather than by coincidence of two independently
auto-computed grids happening to agree.

Zero flood physics. Zero solver logic. Zero scientific interpretation of
land-cover values.
"""

import numpy as np
from numpy.typing import NDArray
from rasterio.warp import Resampling, reproject

from flood_engine.io.raster_loader import RasterDataset, RasterValidationError
from flood_engine.logging_config import LogSubsystem, get_logger, log_duration

logger = get_logger(LogSubsystem.RASTER_IO, "landcover_preprocessing")


def preprocess_landcover(landcover: RasterDataset, model_grid: RasterDataset) -> RasterDataset:
    """Reproject and majority-resample a loaded WorldCover raster onto the model grid.

    Consumes only already-validated :class:`RasterDataset` objects -- this
    function never opens a file itself.

    Args:
        landcover: The loaded ESA WorldCover raster (10m native, any CRS),
            as produced by ``load_raster()``.
        model_grid: The reference grid to align onto -- in this pipeline,
            the Step 7 :func:`flood_engine.preprocessing.dem_preprocessing.preprocess_dem`
            output. Only its ``crs``, ``transform``, and shape are used;
            its own pixel values are not read.

    Returns:
        A :class:`RasterDataset` sharing ``model_grid``'s exact CRS,
        transform, and dimensions, with resampled land-cover class codes
        as pixel values. If ``landcover`` is already pixel-for-pixel
        identical to ``model_grid``'s grid, the *same* input object is
        returned unchanged, introducing no resampling at all -- same
        no-op discipline as DEM preprocessing's "no resampling beyond
        what alignment requires."

    Raises:
        RasterValidationError: if ``landcover.nodata`` is ``None``.
            Reprojection requires a nodata sentinel to mark destination
            cells outside the source footprint; inventing one not present
            in the source file would be fabricating data (same principle
            as DEM preprocessing's identical guard -- reapplied here
            freshly, not shared code, so Step 7's frozen file is untouched).
    """
    if (
        landcover.crs == model_grid.crs
        and landcover.transform == model_grid.transform
        and landcover.data.shape == model_grid.data.shape
    ):
        logger.info(
            "Land cover already aligned to model grid, skipping resampling",
            extra={"crs": landcover.crs.to_string()},
        )
        return landcover

    if landcover.nodata is None:
        raise RasterValidationError(
            "Cannot align a land-cover raster with no defined nodata value -- "
            "resampling requires a sentinel to mark destination cells outside "
            "the source raster's footprint, and none is present in this raster. "
            "Inventing one would be fabricating data the source file does not provide."
        )

    with log_duration(
        logger,
        "Land cover resampled to model grid",
        source_crs=landcover.crs.to_string(),
        target_crs=model_grid.crs.to_string(),
    ):
        aligned = _resample_to_model_grid(landcover, model_grid)

    logger.info(
        "Land cover preprocessing complete",
        extra={
            "crs": aligned.crs.to_string(),
            "width": aligned.width,
            "height": aligned.height,
        },
    )
    return aligned


def _resample_to_model_grid(landcover: RasterDataset, model_grid: RasterDataset) -> RasterDataset:
    """Perform the actual rasterio majority-resampling warp.

    Isolated from :func:`preprocess_landcover` for the same reason as DEM
    preprocessing's equivalent split: keeps the guard clauses free of the
    warp machinery's local variables, no behavioral difference from
    inlining this.

    Args:
        landcover: The source raster, guaranteed by the caller to need
            resampling and to have a defined nodata value.
        model_grid: The already-established target grid to align onto.

    Returns:
        A new, validated :class:`RasterDataset` sharing ``model_grid``'s
        CRS, transform, and dimensions.
    """
    destination: NDArray[np.integer] = np.empty(
        (model_grid.height, model_grid.width), dtype=landcover.data.dtype
    )
    reproject(
        source=landcover.data,
        destination=destination,
        src_transform=landcover.transform,
        src_crs=landcover.crs,
        dst_transform=model_grid.transform,
        dst_crs=model_grid.crs,
        src_nodata=landcover.nodata,
        dst_nodata=landcover.nodata,
        resampling=Resampling.mode,
    )

    return RasterDataset(
        data=destination,
        crs=model_grid.crs,
        transform=model_grid.transform,
        nodata=landcover.nodata,
    )
