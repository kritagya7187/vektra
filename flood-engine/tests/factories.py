"""Shared synthetic-scenario builders for Step 18's validation/regression/benchmark suites.

Deliberately new, not a refactor of any frozen Steps 1-17 test file's own
private per-module helpers (``tests/unit/core/test_wca2d.py``'s ``_domain``,
``tests/unit/core/test_timestepping.py``'s ``_flat_domain``, etc.) -- those
stay exactly as they are; this module exists because Step 18's own tests
(end-to-end integration, scientific validation, numerical regression,
performance benchmark, determinism, error recovery) all need the same
small set of parametrized synthetic scenarios (flat terrain, a single
hill, a single depression, a building barrier) at varying grid sizes,
which no shared module provided before this step.

Every builder here is a plain function, not a pytest fixture -- shape and
other parameters vary per test/benchmark call (e.g. Part E's 100x100
through 1000x1000 grid sizes), which a fixture's fixed-signature
injection model does not fit naturally.

All rasters are constructed **already in the model CRS** (UTM 43N,
``core.grid.MODEL_GRID_EPSG_CODE``), at exactly ``core.grid.MODEL_GRID_RESOLUTION_M``
resolution, with no nodata cells -- this deliberately takes the
"already-conformant, no-op" path through
``preprocessing.dem_preprocessing.preprocess_dem``/
``preprocessing.landcover_preprocessing.preprocess_landcover`` (see their
own tests: reprojecting a WGS84-sourced DEM always introduces some
nodata edge cells via ``calculate_default_transform``'s axis-aligned
bounding box, which ``pipeline.build_simulation_inputs`` deliberately
refuses to pass into the solver). Using synthetic data already in the
model CRS is what makes a genuinely complete, nodata-free domain
possible for these tests -- it does not test reprojection itself
(Steps 7/8's own integration tests already do that).
"""

from datetime import UTC, datetime, timedelta

import geopandas as gpd
import numpy as np
from numpy.typing import NDArray
from rasterio.crs import CRS
from rasterio.transform import Affine
from shapely.geometry import box

from flood_engine.core.grid import MODEL_GRID_EPSG_CODE, MODEL_GRID_RESOLUTION_M
from flood_engine.core.solver.roughness import BARE_SPARSE_VEGETATION
from flood_engine.inputs.rainfall import RainfallForcing, load_rainfall_forcing
from flood_engine.io.raster_loader import RasterDataset

MODEL_CRS: CRS = CRS.from_epsg(MODEL_GRID_EPSG_CODE)

# An arbitrary, fixed top-left origin -- no significance beyond being a
# real, plausible UTM 43N coordinate (matches the existing building-
# rasterization integration test's own origin convention).
ORIGIN_X = 268_000.0
ORIGIN_Y = 2_102_000.0


def model_transform(*, resolution_m: float = MODEL_GRID_RESOLUTION_M) -> Affine:
    """The affine transform every builder in this module shares (only resolution varies)."""
    return Affine(resolution_m, 0.0, ORIGIN_X, 0.0, -resolution_m, ORIGIN_Y)


def flat_dem(shape: tuple[int, int], *, elevation_m: float = 10.0) -> RasterDataset:
    """A uniform-elevation DEM, already on the model grid, no nodata cells."""
    data = np.full(shape, elevation_m, dtype=np.float32)
    return RasterDataset(data=data, crs=MODEL_CRS, transform=model_transform(), nodata=-9999.0)


def hill_dem(
    shape: tuple[int, int], *, base_elevation_m: float = 10.0, peak_height_m: float = 20.0
) -> RasterDataset:
    """A single radially-symmetric hill (Gaussian bump) centered on the grid.

    Water placed anywhere on this domain must flow outward/downhill from
    the center toward the edges -- used by Part C's symmetry-preservation
    and Part D's "single hill" regression case.
    """
    height, width = shape
    rows, cols = np.meshgrid(np.arange(height), np.arange(width), indexing="ij")
    center_row, center_col = (height - 1) / 2.0, (width - 1) / 2.0
    # Standard deviation scaled to the grid so the bump is a real, visible
    # feature at any tested size, not vanishingly narrow on a large grid.
    sigma = max(height, width) / 6.0
    squared_distance = (rows - center_row) ** 2 + (cols - center_col) ** 2
    bump = peak_height_m * np.exp(-squared_distance / (2.0 * sigma**2))
    data = (base_elevation_m + bump).astype(np.float32)
    return RasterDataset(data=data, crs=MODEL_CRS, transform=model_transform(), nodata=-9999.0)


def depression_dem(
    shape: tuple[int, int], *, base_elevation_m: float = 10.0, depth_m: float = 5.0
) -> RasterDataset:
    """A single radially-symmetric bowl (inverted Gaussian) centered on the grid.

    Water placed anywhere on this domain must flow inward/downhill toward
    the center and pool there (a closed depression has no outlet) -- used
    by Part D's "single depression" regression case.
    """
    height, width = shape
    rows, cols = np.meshgrid(np.arange(height), np.arange(width), indexing="ij")
    center_row, center_col = (height - 1) / 2.0, (width - 1) / 2.0
    sigma = max(height, width) / 6.0
    squared_distance = (rows - center_row) ** 2 + (cols - center_col) ** 2
    dip = depth_m * np.exp(-squared_distance / (2.0 * sigma**2))
    data = (base_elevation_m - dip).astype(np.float32)
    return RasterDataset(data=data, crs=MODEL_CRS, transform=model_transform(), nodata=-9999.0)


def sloped_dem(
    shape: tuple[int, int], *, high_elevation_m: float = 20.0, low_elevation_m: float = 0.0
) -> RasterDataset:
    """A uniform slope, high on row 0 to low on the last row.

    A single, unambiguous downhill direction. Used where a test needs a
    domain with exactly one flow direction
    (e.g. edge-discharge / boundary-outflow accounting), rather than the
    radially-symmetric hill/depression shapes' multi-directional flow.
    """
    height, _width = shape
    row_elevations = np.linspace(high_elevation_m, low_elevation_m, height, dtype=np.float32)
    data = np.repeat(row_elevations[:, np.newaxis], shape[1], axis=1)
    return RasterDataset(data=data, crs=MODEL_CRS, transform=model_transform(), nodata=-9999.0)


def uniform_landcover(
    shape: tuple[int, int], *, class_code: int = BARE_SPARSE_VEGETATION
) -> RasterDataset:
    """A single ESA WorldCover class code across the whole grid."""
    data = np.full(shape, class_code, dtype=np.uint8)
    return RasterDataset(data=data, crs=MODEL_CRS, transform=model_transform(), nodata=255)


def no_buildings(shape: tuple[int, int]) -> NDArray[np.bool_]:
    """A building mask with no obstructions anywhere."""
    return np.zeros(shape, dtype=np.bool_)


def building_barrier_mask(
    shape: tuple[int, int], *, column: int | None = None
) -> NDArray[np.bool_]:
    """A single full-height column of building cells, splitting the domain in two.

    Used by Part C's "building obstruction" validation: water on one side
    of the barrier must never cross to the other side within the run.

    Args:
        shape: The grid shape.
        column: Which column is the barrier. Defaults to the middle
            column (rounded down), so the domain is split as evenly as
            the grid width allows.
    """
    height, width = shape
    mask = np.zeros(shape, dtype=np.bool_)
    barrier_column = width // 2 if column is None else column
    mask[:, barrier_column] = True
    return mask


def buildings_geodataframe(
    cells: list[tuple[int, int]], *, shape: tuple[int, int]
) -> gpd.GeoDataFrame:
    """Real building polygons that fully cover the given (row, col) cells, in the model CRS.

    Each polygon exactly tiles one model-grid cell (100% coverage, well
    above ``building_rasterization.BUILDING_COVERAGE_THRESHOLD``), so
    :func:`~flood_engine.preprocessing.building_rasterization.rasterize_buildings`
    deterministically marks exactly these cells as buildings -- used
    wherever a test needs to go through the real rasterization path
    (Part B's end-to-end integration) rather than constructing a
    boolean mask directly (:func:`building_barrier_mask`, for tests that
    talk to ``core.solver`` directly and never touch ``preprocessing``).

    Args:
        cells: ``(row, col)`` pairs to cover with a building polygon.
        shape: The grid shape ``cells`` are indices into (bounds-checked
            only implicitly, by the resulting geometry landing outside
            the model grid's own extent if a caller passes an
            out-of-range index).
    """
    transform = model_transform()
    del shape  # only used for docstring clarity / future bounds-checking hook
    polygons = []
    for row, col in cells:
        x0 = transform.c + transform.a * col
        y0 = transform.f + transform.e * row
        x1 = transform.c + transform.a * (col + 1)
        y1 = transform.f + transform.e * (row + 1)
        polygons.append(box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)))
    return gpd.GeoDataFrame({"id": range(len(polygons))}, geometry=polygons, crs=MODEL_CRS)


def constant_rainfall(
    *, rate_mm_per_hr: float, hours: int, start: datetime | None = None
) -> RainfallForcing:
    """A rainfall forcing series with the same rate at every hourly anchor."""
    origin = start if start is not None else datetime(2026, 6, 1, tzinfo=UTC)
    records = [(origin + timedelta(hours=i), rate_mm_per_hr) for i in range(hours)]
    return load_rainfall_forcing(records, unit="mm/hr")


def zero_rainfall(*, hours: int, start: datetime | None = None) -> RainfallForcing:
    """A rainfall forcing series that never rains -- the dry-domain-behavior baseline."""
    return constant_rainfall(rate_mm_per_hr=0.0, hours=hours, start=start)


def varying_rainfall(
    rates_mm_per_hr: list[float], *, start: datetime | None = None
) -> RainfallForcing:
    """A rainfall forcing series with an explicit, caller-chosen rate per hourly anchor."""
    origin = start if start is not None else datetime(2026, 6, 1, tzinfo=UTC)
    records = [(origin + timedelta(hours=i), rate) for i, rate in enumerate(rates_mm_per_hr)]
    return load_rainfall_forcing(records, unit="mm/hr")
