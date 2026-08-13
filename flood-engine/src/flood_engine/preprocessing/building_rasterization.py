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
from shapely import box

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

    Only cells within a building's padded bounding box can possibly have
    nonzero covered area (a real, provable geometric fact, not an
    approximation) -- restricting cell-polygon construction and the
    overlay to that candidate set, found necessary after this function's
    original whole-grid implementation took over an hour and never
    completed against the real, full-extent Mumbai grid (~1.09M cells).

    Overlaid against the individual building polygons, not their
    ``union_all()`` -- found necessary because ``geopandas.overlay``
    tests every candidate cell against a *single* complex multi-part
    geometry when given a unioned right-hand side, defeating its own
    two-sided spatial index; overlaying against ~97.5K individual
    buildings directly (real Mumbai scale) let that index prune
    candidate pairs on both sides and was measured, in isolation against
    the real data, to be the dominant remaining cost of this function.
    Real building footprints do not overlap each other, but
    ``dissolve(by="cell_id")`` before computing area guards against
    double-counting even if two footprints in the same cell did overlap
    -- exactly reproducing the union-based approach's result, not an
    approximation of it. City-scale, per the NMS's own frozen >=50%
    coverage-fraction threshold, unchanged.

    Args:
        buildings: Already-validated, non-empty, CRS-matching, all-valid
            building geometries.
        model_grid: The already-established target grid to align onto.

    Returns:
        A new, validated :class:`RasterDataset`.
    """
    candidate_cell_ids = _candidate_cell_ids(buildings, model_grid)
    mask_flat: NDArray[np.uint8] = np.zeros(model_grid.height * model_grid.width, dtype=np.uint8)

    if len(candidate_cell_ids) > 0:
        cell_grid = _build_cell_grid(model_grid, candidate_cell_ids)

        # keep_geom_type=False: a cell/building pair that only shares an
        # edge or a point (e.g. a building whose boundary exactly
        # coincides with a cell boundary) produces a degenerate
        # LineString/Point intersection with area 0.0 -- geopandas'
        # default (True) silently drops these with a warning since their
        # geometry type doesn't match the cell layer's Polygon type.
        # Explicit here rather than relying on that default: verified the
        # dropped rows always have area == 0.0 (a zero-area geometry
        # cannot contribute to the coverage-fraction sum either way), so
        # this changes no result, only makes the intent explicit and
        # removes the warning.
        overlay = gpd.overlay(
            cell_grid, buildings[["geometry"]], how="intersection", keep_geom_type=False
        )

        coverage = cell_grid.set_index("cell_id")[["cell_area"]]
        if len(overlay) > 0:
            dissolved = overlay.dissolve(by="cell_id")
            coverage["covered_area"] = dissolved.geometry.area
        else:
            coverage["covered_area"] = 0.0
        coverage["covered_area"] = coverage["covered_area"].fillna(0.0)
        coverage["fraction"] = coverage["covered_area"] / coverage["cell_area"]

        covered_ids = coverage.index[coverage["fraction"] >= BUILDING_COVERAGE_THRESHOLD]
        mask_flat[covered_ids.to_numpy()] = 1

    mask_data = mask_flat.reshape(model_grid.height, model_grid.width)

    return RasterDataset(
        data=mask_data,
        crs=model_grid.crs,
        transform=model_grid.transform,
        nodata=None,
    )


def _candidate_cell_ids(buildings: gpd.GeoDataFrame, model_grid: RasterDataset) -> NDArray[np.intp]:
    """Return every cell id whose padded bounding box could intersect a building.

    Any cell outside every building's own (1-cell-padded) bounding box
    provably has zero covered area -- padding absorbs the case where a
    building's true footprint extends slightly beyond its own bounding
    box relative to the grid's alignment. Restricting the expensive
    polygon-overlay step to this candidate set is what makes city-scale
    rasterization tractable; it changes no output, only which
    provably-zero cells are skipped.

    Args:
        buildings: Already-validated building geometries.
        model_grid: Supplies the transform/shape to convert building
            bounds into cell row/col ranges.

    Returns:
        Sorted, deduplicated row-major cell ids (``row * width + col``).
    """
    inv = ~model_grid.transform
    bounds = buildings.geometry.bounds.to_numpy()
    minx, miny, maxx, maxy = bounds[:, 0], bounds[:, 1], bounds[:, 2], bounds[:, 3]

    col_a, row_a = inv * (minx, miny)
    col_b, row_b = inv * (maxx, maxy)
    col0 = np.floor(np.minimum(col_a, col_b)).astype(np.intp) - 1
    col1 = np.ceil(np.maximum(col_a, col_b)).astype(np.intp) + 1
    row0 = np.floor(np.minimum(row_a, row_b)).astype(np.intp) - 1
    row1 = np.ceil(np.maximum(row_a, row_b)).astype(np.intp) + 1

    col0 = np.clip(col0, 0, model_grid.width - 1)
    col1 = np.clip(col1, 0, model_grid.width - 1)
    row0 = np.clip(row0, 0, model_grid.height - 1)
    row1 = np.clip(row1, 0, model_grid.height - 1)

    candidate_mask = np.zeros((model_grid.height, model_grid.width), dtype=np.bool_)
    for r0, r1, c0, c1 in zip(row0, row1, col0, col1, strict=True):
        candidate_mask[r0 : r1 + 1, c0 : c1 + 1] = True

    return np.flatnonzero(candidate_mask.ravel())


def _build_cell_grid(model_grid: RasterDataset, cell_ids: NDArray[np.intp]) -> gpd.GeoDataFrame:
    """Build one box polygon per given model-grid cell id.

    Vectorized via NumPy/shapely's array-input ``box()`` rather than a
    Python-level loop -- with a full-city cell count (~1M for Mumbai)
    a per-cell Python loop measurably dominated runtime even before
    :func:`_candidate_cell_ids` existed to shrink the candidate set.

    Args:
        model_grid: Supplies the transform used to convert cell ids to
            coordinates.
        cell_ids: Row-major cell ids (``row * width + col``) to build
            polygons for -- typically :func:`_candidate_cell_ids`'s
            output, not necessarily the whole grid.

    Returns:
        A GeoDataFrame with columns ``cell_id``, ``cell_area``, and a box
        geometry per requested cell.
    """
    rows_flat = cell_ids // model_grid.width
    cols_flat = cell_ids % model_grid.width

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

    boxes = box(np.minimum(x0, x1), np.minimum(y0, y1), np.maximum(x0, x1), np.maximum(y0, y1))

    cell_grid = gpd.GeoDataFrame({"cell_id": cell_ids}, geometry=boxes, crs=model_grid.crs)
    cell_grid["cell_area"] = cell_grid.geometry.area
    return cell_grid
