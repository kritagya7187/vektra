"""DEM preprocessing: prepares the Copernicus GLO-30 DEM for the model grid.

Implements exactly the NMS's frozen "Grid" section requirement to
reproject the DEM to UTM Zone 43N (``flood_engine.core.grid.MODEL_GRID_EPSG_CODE``)
-- and nothing else.

**AOI clipping is deliberately not implemented here.** The NMS's own Grid
section treats AOI determination as an unresolved task item ("must be
checked against DEM-derived flow direction... not assumed solved by
reusing the old box"), and no AOI geometry exists anywhere in this project
yet. Clipping to a fabricated or provisional boundary would bake in
exactly the risk the NMS warns against. Confirmed with the project owner
before implementation (Step 7 pre-implementation verification) rather than
decided unilaterally.

**Resampling is bilinear**, confirmed with the project owner rather than
assumed: the NMS requires reprojection but does not name an interpolation
kernel, and this is the same class of decision (Manning's n table,
infiltration method) the NMS was otherwise careful to state and justify
explicitly. Bilinear is the standard choice for continuous data like
elevation -- nearest-neighbor would introduce blocky discontinuities
inappropriate for a solver that computes elevation *differences* between
neighboring cells; cubic risks overshoot/undershoot near sharp breaks
(e.g. the coastline).

Zero flood physics. Zero solver logic. This module prepares geometry; the
solver (Step 11) is the first place water movement exists anywhere in
this codebase.
"""

import numpy as np
from numpy.typing import NDArray
from rasterio.crs import CRS
from rasterio.warp import Resampling, calculate_default_transform, reproject

from flood_engine.core.grid import MODEL_GRID_EPSG_CODE
from flood_engine.io.raster_loader import RasterDataset, RasterValidationError
from flood_engine.logging_config import LogSubsystem, get_logger, log_duration

logger = get_logger(LogSubsystem.RASTER_IO, "dem_preprocessing")


def preprocess_dem(dem: RasterDataset) -> RasterDataset:
    """Reproject a loaded DEM to the model grid's CRS (UTM Zone 43N).

    Consumes only an already-validated :class:`RasterDataset` produced by
    :func:`flood_engine.io.raster_loader.load_raster` -- this function
    never opens a file itself.

    If ``dem`` is already in the model CRS, this is a no-op: the *same*
    object is returned unchanged, introducing no resampling at all. This
    is not merely an optimization -- the NMS's Grid section requires "no
    resampling-induced smoothing beyond what reprojection requires",
    which means reprojecting an already-conformant raster would itself be
    a violation, not just wasted work.

    Args:
        dem: A validated DEM raster, in any CRS, as produced by
            ``load_raster()``.

    Returns:
        A :class:`RasterDataset` in the model CRS (EPSG:``MODEL_GRID_EPSG_CODE``).
        Nodata cells introduced at the destination grid's edges (where the
        reprojected source footprint does not fully cover the destination
        extent) are set to the source raster's own nodata value -- never
        a synthesized default.

    Raises:
        RasterValidationError: if ``dem.nodata`` is ``None``. Reprojection
            requires a nodata sentinel to mark destination cells outside
            the source footprint; inventing one that was not present in
            the source file would be exactly the kind of fabrication this
            codebase's raster-handling discipline forbids (see
            :mod:`flood_engine.io.raster_loader`'s module docstring,
            principle 1). A DEM with no defined nodata cannot be
            reprojected by this function as written.
    """
    model_crs = CRS.from_epsg(MODEL_GRID_EPSG_CODE)

    if dem.crs == model_crs:
        logger.info(
            "DEM already in model CRS, skipping reprojection",
            extra={"crs": dem.crs.to_string()},
        )
        return dem

    if dem.nodata is None:
        raise RasterValidationError(
            "Cannot reproject a DEM with no defined nodata value -- reprojection "
            "requires a sentinel to mark destination cells outside the source "
            "raster's footprint, and none is present in this raster. Inventing "
            "one would be fabricating data the source file does not provide."
        )

    with log_duration(
        logger,
        "DEM reprojected to model CRS",
        source_crs=dem.crs.to_string(),
        target_crs=model_crs.to_string(),
    ):
        reprojected = _reproject_to_model_grid(dem, model_crs)

    logger.info(
        "DEM preprocessing complete",
        extra={
            "crs": reprojected.crs.to_string(),
            "width": reprojected.width,
            "height": reprojected.height,
            "resolution": reprojected.resolution,
        },
    )
    return reprojected


def _reproject_to_model_grid(dem: RasterDataset, model_crs: CRS) -> RasterDataset:
    """Perform the actual rasterio warp reprojection.

    Isolated from :func:`preprocess_dem` purely so the guard clauses
    (already-conformant CRS, missing nodata) stay free of the warp
    machinery's local variables -- no behavioral difference from inlining
    this.

    Args:
        dem: The source raster, guaranteed by the caller to need
            reprojection and to have a defined nodata value.
        model_crs: The target CRS (always ``MODEL_GRID_EPSG_CODE``, passed
            in rather than re-resolved so it is computed exactly once per
            :func:`preprocess_dem` call).

    Returns:
        A new, validated :class:`RasterDataset` in ``model_crs``.
    """
    dst_transform, dst_width, dst_height = calculate_default_transform(
        dem.crs,
        model_crs,
        dem.width,
        dem.height,
        dem.bounds.left,
        dem.bounds.bottom,
        dem.bounds.right,
        dem.bounds.top,
    )

    destination: NDArray[np.floating] = np.empty((dst_height, dst_width), dtype=dem.data.dtype)
    reproject(
        source=dem.data,
        destination=destination,
        src_transform=dem.transform,
        src_crs=dem.crs,
        dst_transform=dst_transform,
        dst_crs=model_crs,
        src_nodata=dem.nodata,
        dst_nodata=dem.nodata,
        resampling=Resampling.bilinear,
    )

    return RasterDataset(
        data=destination,
        crs=model_crs,
        transform=dst_transform,
        nodata=dem.nodata,
    )
