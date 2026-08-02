"""Building rasterization: converts building footprint polygons to a model-grid-aligned mask.

Implements exactly the NMS's frozen "Static inputs" sentence: "Buildings:
OSM footprints rasterized to a binary obstruction mask -- a cell is
flagged 'building' if >=50% of its area is covered by footprint (frozen
rasterization threshold, not left ambiguous)."

**This module produces only a presence mask -- it does not interpret it.**
The NMS's separate "Building obstruction" section ("Full impermeable
blockage... excluded from the flow domain entirely") describes how the
*solver* (``core.solver``, Step 11) will use this mask; that interpretation
is not implemented here. Similarly, SDS Section 6's "Buildings affected"
exposure analysis is a distinct, later pipeline stage that spatial-joins
the *original vector polygons* (not this raster) against post-simulation
summary rasters -- this module's output is not an input to that analysis
at all. Confirmed against the frozen NMS/SDS text before implementation,
not assumed: these are two separate, already-resolved roles for building
footprints in this pipeline, and this module serves only the first.

**Threshold, not point-sampling.** ``rasterio.features.rasterize()`` was
considered and rejected: it only supports center-point or "all-touched"
tests, neither of which expresses the NMS's frozen fractional-area
threshold. Instead, cell polygons are built directly from
``model_grid``'s own transform/shape and overlaid (spatially indexed,
via ``geopandas.overlay``) against the union of building geometries to
compute an exact covered-area fraction per cell -- no dependency beyond
what is already declared (geopandas/shapely), and no approximation
parameter (e.g. a supersampling factor) that would itself need separate
justification.

Zero flood physics. Zero solver logic. Zero exposure/damage/vulnerability
analysis. Zero building attributes beyond footprint geometry.
"""

from typing import Final

import geopandas as gpd
import numpy as np
from numpy.typing import NDArray
from shapely.geometry import box

from flood_engine.io.raster_loader import RasterDataset, RasterValidationError
from flood_engine.logging_config import LogSubsystem, get_logger, log_duration

logger = get_logger(LogSubsystem.RASTER_IO, "building_rasterization")

BUILDING_COVERAGE_THRESHOLD: Final[float] = 0.5
"""The NMS's frozen rasterization threshold.

A cell is "building" if >=50% of its area is covered by footprint.
"""


def rasterize_buildings(buildings: gpd.GeoDataFrame, model_grid: RasterDataset) -> RasterDataset:
    """Rasterize building footprints into a 0/1 presence mask aligned to the model grid.

    Args:
        buildings: Building footprint polygons. Must be non-empty, in the
            same CRS as ``model_grid``, with only valid, non-null
            geometries.
        model_grid: The reference grid to align onto -- in this pipeline,
            the Step 7/8 preprocessing output. Only its ``crs``,
            ``transform``, and shape are used; its own pixel values are
            not read.

    Returns:
        A :class:`RasterDataset` sharing ``model_grid``'s exact CRS,
        transform, and dimensions. Cell values are ``uint8``: ``1`` where
        covered building-footprint area is >= :data:`BUILDING_COVERAGE_THRESHOLD`
        of the cell's area, ``0`` otherwise. No third category, no encoded
        height/type/attributes. ``nodata`` is ``None`` -- every cell in
        this computed mask has a definite 0-or-1 answer; there is no
        "missing data" concept for a derived product like this, unlike
        the source rasters in Steps 7/8.

    Raises:
        RasterValidationError: if ``buildings`` is empty, has a CRS that
            does not match ``model_grid.crs`` (never silently
            reprojected), or contains any null or invalid geometry
            (never silently repaired or skipped).
    """
    if len(buildings) == 0:
        raise RasterValidationError(
            "Cannot rasterize an empty building GeoDataFrame -- refusing to "
            "silently produce an all-zero mask, which could mask a real data "
            "problem (e.g. an ingestion failure or wrong AOI) rather than a "
            "genuine zero-building area."
        )

    if buildings.crs != model_grid.crs:
        raise RasterValidationError(
            f"Building CRS {buildings.crs} does not match model grid CRS "
            f"{model_grid.crs.to_string()!r}. rasterize_buildings() never "
            "reprojects -- reproject explicitly before calling this function."
        )

    if buildings.geometry.isna().any():
        raise RasterValidationError(
            "Building GeoDataFrame contains null geometries -- refusing to "
            "silently skip them."
        )

    if not buildings.geometry.is_valid.all():
        invalid_count = int((~buildings.geometry.is_valid).sum())
        raise RasterValidationError(
            f"Building GeoDataFrame contains {invalid_count} invalid "
            "geometries (e.g. self-intersecting polygons) -- refusing to "
            "silently repair them."
        )

    with log_duration(
        logger,
        "Buildings rasterized to model grid",
        building_count=len(buildings),
    ):
        mask = _rasterize_to_model_grid(buildings, model_grid)

    logger.info(
        "Building rasterization complete",
        extra={
            "width": mask.width,
            "height": mask.height,
            "building_cell_count": int(np.count_nonzero(mask.data)),
        },
    )
    return mask


def _rasterize_to_model_grid(
    buildings: gpd.GeoDataFrame, model_grid: RasterDataset
) -> RasterDataset:
    """Compute the per-cell covered-area fraction and threshold it into a 0/1 mask.

    Isolated from :func:`rasterize_buildings` for the same reason as the
    equivalent split in DEM/land-cover preprocessing: keeps the guard
    clauses free of this function's local variables.

    Args:
        buildings: Already-validated, non-empty, CRS-matching, all-valid
            building geometries.
        model_grid: The already-established target grid to align onto.

    Returns:
        A new, validated :class:`RasterDataset`.
    """
    cell_grid = _build_cell_grid(model_grid)

    buildings_union = gpd.GeoDataFrame(geometry=[buildings.union_all()], crs=buildings.crs)
    # keep_geom_type=False: a cell/building pair that only shares an edge
    # or a point (e.g. a building whose boundary exactly coincides with a
    # cell boundary) produces a degenerate LineString/Point intersection
    # with area 0.0 -- geopandas' default (True) silently drops these
    # with a warning since their geometry type doesn't match the cell
    # layer's Polygon type. Explicit here rather than relying on that
    # default: verified the dropped rows always have area == 0.0 (a
    # zero-area geometry cannot contribute to the coverage-fraction sum
    # either way), so this changes no result, only makes the intent
    # explicit and removes the warning.
    overlay = gpd.overlay(cell_grid, buildings_union, how="intersection", keep_geom_type=False)

    coverage = cell_grid.set_index("cell_id")[["cell_area"]]
    if len(overlay) > 0:
        overlay["covered_area"] = overlay.geometry.area
        per_cell_covered = overlay.groupby("cell_id")["covered_area"].sum()
        coverage["covered_area"] = per_cell_covered
    else:
        coverage["covered_area"] = 0.0
    coverage["covered_area"] = coverage["covered_area"].fillna(0.0)
    coverage["fraction"] = coverage["covered_area"] / coverage["cell_area"]
    coverage = coverage.sort_index()

    mask_flat: NDArray[np.uint8] = (
        coverage["fraction"] >= BUILDING_COVERAGE_THRESHOLD
    ).to_numpy().astype(np.uint8)
    mask_data = mask_flat.reshape(model_grid.height, model_grid.width)

    return RasterDataset(
        data=mask_data,
        crs=model_grid.crs,
        transform=model_grid.transform,
        nodata=None,
    )


def _build_cell_grid(model_grid: RasterDataset) -> gpd.GeoDataFrame:
    """Build one box polygon per model-grid cell, in row-major order matching array indexing.

    Vectorized via NumPy rather than a nested Python loop calling
    ``transform * (col, row)`` once per cell, so this stays reasonably
    fast even for a realistic grid size -- this is still a one-time setup
    operation, not per-timestep solver work, so it does not need to be
    as aggressively optimized as that would.

    Args:
        model_grid: Supplies the transform and shape every cell polygon
            is derived from.

    Returns:
        A GeoDataFrame with columns ``cell_id`` (``row * width + col``,
        the same row-major order ``numpy.reshape`` uses -- what makes
        reassembling the final mask array from this table correct),
        ``cell_area``, and a box geometry per cell.
    """
    rows, cols = np.meshgrid(
        np.arange(model_grid.height), np.arange(model_grid.width), indexing="ij"
    )
    rows_flat = rows.ravel()
    cols_flat = cols.ravel()

    a, b, c, d, e, f = (
        model_grid.transform.a,
        model_grid.transform.b,
        model_grid.transform.c,
        model_grid.transform.d,
        model_grid.transform.e,
        model_grid.transform.f,
    )
    x0 = a * cols_flat + b * rows_flat + c
    y0 = d * cols_flat + e * rows_flat + f
    x1 = a * (cols_flat + 1) + b * (rows_flat + 1) + c
    y1 = d * (cols_flat + 1) + e * (rows_flat + 1) + f

    cell_ids = rows_flat * model_grid.width + cols_flat
    boxes = [
        box(min(x0[i], x1[i]), min(y0[i], y1[i]), max(x0[i], x1[i]), max(y0[i], y1[i]))
        for i in range(len(cell_ids))
    ]

    cell_grid = gpd.GeoDataFrame({"cell_id": cell_ids}, geometry=boxes, crs=model_grid.crs)
    cell_grid["cell_area"] = cell_grid.geometry.area
    return cell_grid
