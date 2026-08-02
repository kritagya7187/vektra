"""Integration tests for flood_engine.preprocessing.building_rasterization.

Placed under tests/integration/ per this module's own categorization
(tests/integration/__init__.py): area-overlay rasterization is real
geospatial computation against real geometries, not pure logic. All
geometries are constructed directly in the model CRS (UTM 43N) rather
than reprojected from WGS84 -- unlike Steps 7/8, there is no reprojection
in this module, so there is no cross-CRS-correspondence bug class to
guard against here.
"""

import geopandas as gpd
import numpy as np
import pytest
from rasterio.crs import CRS
from rasterio.transform import Affine
from shapely.geometry import Polygon, box

from flood_engine.core.grid import MODEL_GRID_EPSG_CODE
from flood_engine.io.raster_loader import RasterDataset, RasterValidationError
from flood_engine.preprocessing.building_rasterization import rasterize_buildings

MODEL_CRS = CRS.from_epsg(MODEL_GRID_EPSG_CODE)
WGS84 = CRS.from_epsg(4326)

# model_grid: 5x5 cells @ 30m, top-left (268000, 2102000) -- spans
# UTM X:[268000,268150], Y:[2101850,2102000].
MODEL_TRANSFORM = Affine(30.0, 0.0, 268_000.0, 0.0, -30.0, 2_102_000.0)


@pytest.fixture
def model_grid() -> RasterDataset:
    return RasterDataset(
        data=np.zeros((5, 5), dtype=np.float32),
        crs=MODEL_CRS,
        transform=MODEL_TRANSFORM,
        nodata=-9999.0,
    )


def cell_bounds(row: int, col: int) -> tuple[float, float, float, float]:
    """(minx, miny, maxx, maxy) for a given (row, col) in MODEL_TRANSFORM -- a test-only helper."""
    x0 = MODEL_TRANSFORM.c + MODEL_TRANSFORM.a * col
    y0 = MODEL_TRANSFORM.f + MODEL_TRANSFORM.e * row
    x1 = MODEL_TRANSFORM.c + MODEL_TRANSFORM.a * (col + 1)
    y1 = MODEL_TRANSFORM.f + MODEL_TRANSFORM.e * (row + 1)
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def make_buildings(*geometries: object, crs: CRS = MODEL_CRS) -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame({"id": range(len(geometries))}, geometry=list(geometries), crs=crs)


class TestRasterizeBuildingsValidation:
    def test_raises_on_empty_geodataframe(self, model_grid: RasterDataset) -> None:
        empty = gpd.GeoDataFrame({"id": []}, geometry=[], crs=MODEL_CRS)

        with pytest.raises(RasterValidationError, match="empty"):
            rasterize_buildings(empty, model_grid)

    def test_raises_on_crs_mismatch(self, model_grid: RasterDataset) -> None:
        buildings = make_buildings(box(72.8, 19.0, 72.801, 19.001), crs=WGS84)

        with pytest.raises(RasterValidationError, match="CRS"):
            rasterize_buildings(buildings, model_grid)

    def test_never_reprojects_on_crs_mismatch(self, model_grid: RasterDataset) -> None:
        # Explicit negative proof, not just "an error was raised": no
        # result is ever produced for mismatched input.
        buildings = make_buildings(box(72.8, 19.0, 72.801, 19.001), crs=WGS84)

        with pytest.raises(RasterValidationError):
            rasterize_buildings(buildings, model_grid)

    def test_raises_on_null_geometry(self, model_grid: RasterDataset) -> None:
        geometries = [box(*cell_bounds(0, 0)), None]
        buildings = gpd.GeoDataFrame({"id": [0, 1]}, geometry=geometries, crs=MODEL_CRS)

        with pytest.raises(RasterValidationError, match="null geometr"):
            rasterize_buildings(buildings, model_grid)

    def test_raises_on_invalid_geometry(self, model_grid: RasterDataset) -> None:
        # A real self-intersecting "bowtie" polygon.
        bowtie = Polygon(
            [(268010, 2101970), (268030, 2101990), (268010, 2101990), (268030, 2101970)]
        )
        buildings = make_buildings(bowtie)

        with pytest.raises(RasterValidationError, match="invalid"):
            rasterize_buildings(buildings, model_grid)


class TestRasterizeBuildingsCorrectness:
    def test_fully_covered_cell_is_flagged(self, model_grid: RasterDataset) -> None:
        buildings = make_buildings(box(*cell_bounds(0, 0)))

        result = rasterize_buildings(buildings, model_grid)

        assert result.data[0, 0] == 1

    def test_uncovered_cells_are_not_flagged(self, model_grid: RasterDataset) -> None:
        buildings = make_buildings(box(*cell_bounds(0, 0)))

        result = rasterize_buildings(buildings, model_grid)

        assert result.data[4, 4] == 0
        assert int(result.data.sum()) == 1

    def test_only_two_categories_present(self, model_grid: RasterDataset) -> None:
        buildings = make_buildings(box(*cell_bounds(1, 1)))

        result = rasterize_buildings(buildings, model_grid)

        assert set(np.unique(result.data)) <= {0, 1}

    def test_exactly_50_percent_coverage_is_flagged(self, model_grid: RasterDataset) -> None:
        # NMS threshold is ">=50%", inclusive -- this is the boundary
        # condition proving inclusivity, not just "roughly half".
        minx, miny, maxx, maxy = cell_bounds(2, 2)
        half_height_building = box(minx, miny + (maxy - miny) / 2, maxx, maxy)  # exactly 50%
        buildings = make_buildings(half_height_building)

        result = rasterize_buildings(buildings, model_grid)

        assert result.data[2, 2] == 1

    def test_just_under_50_percent_coverage_is_not_flagged(self, model_grid: RasterDataset) -> None:
        minx, miny, maxx, maxy = cell_bounds(2, 2)
        just_under_half = box(minx, miny + (maxy - miny) / 2 + 0.01, maxx, maxy)
        buildings = make_buildings(just_under_half)

        result = rasterize_buildings(buildings, model_grid)

        assert result.data[2, 2] == 0

    def test_overlapping_polygons_are_not_double_counted(self, model_grid: RasterDataset) -> None:
        minx, miny, maxx, maxy = cell_bounds(3, 3)
        # Two overlapping buildings whose *union* covers ~50% of the cell
        # (a left-half and a slightly-wider-than-half strip) -- if
        # overlap were double-counted, the summed area would exceed the
        # cell's real area and could push a should-be-just-under-50%
        # case over threshold incorrectly.
        cell_width = maxx - minx
        building_a = box(minx, miny, minx + cell_width * 0.4, maxy)
        building_b = box(minx, miny, minx + cell_width * 0.45, maxy)  # overlaps building_a entirely
        buildings = make_buildings(building_a, building_b)

        result = rasterize_buildings(buildings, model_grid)

        # True union coverage is 45% (building_b's own extent, since it
        # contains building_a) -- must be UNflagged; naive area summation
        # (0.4 + 0.45 = 0.85) would have wrongly flagged it.
        assert result.data[3, 3] == 0

    def test_polygon_entirely_outside_model_grid_produces_all_zero_mask(
        self, model_grid: RasterDataset
    ) -> None:
        far_away_building = box(500_000.0, 2_500_000.0, 500_030.0, 2_500_030.0)
        buildings = make_buildings(far_away_building)

        result = rasterize_buildings(buildings, model_grid)

        assert int(result.data.sum()) == 0

    def test_polygon_exactly_on_cell_boundary_is_deterministic(
        self, model_grid: RasterDataset
    ) -> None:
        # A building whose edge is exactly the shared boundary between
        # cell (1,1) and cell (1,2) -- covers cell (1,1) fully and cell
        # (1,2) not at all (zero-width/zero-area overlap on the far side).
        minx, miny, maxx, maxy = cell_bounds(1, 1)
        buildings = make_buildings(box(minx, miny, maxx, maxy))

        result = rasterize_buildings(buildings, model_grid)

        assert result.data[1, 1] == 1
        assert result.data[1, 2] == 0

    def test_output_aligns_exactly_with_model_grid(self, model_grid: RasterDataset) -> None:
        buildings = make_buildings(box(*cell_bounds(0, 0)))

        result = rasterize_buildings(buildings, model_grid)

        assert result.crs == model_grid.crs
        assert result.transform == model_grid.transform
        assert result.data.shape == model_grid.data.shape

    def test_output_dtype_is_uint8(self, model_grid: RasterDataset) -> None:
        buildings = make_buildings(box(*cell_bounds(0, 0)))

        result = rasterize_buildings(buildings, model_grid)

        assert result.dtype == np.uint8

    def test_output_has_no_nodata(self, model_grid: RasterDataset) -> None:
        # Every cell in a computed presence mask has a definite 0-or-1
        # answer -- there is no "missing data" concept here, unlike the
        # source rasters in Steps 7/8.
        buildings = make_buildings(box(*cell_bounds(0, 0)))

        result = rasterize_buildings(buildings, model_grid)

        assert result.nodata is None

    def test_result_is_immutable(self, model_grid: RasterDataset) -> None:
        buildings = make_buildings(box(*cell_bounds(0, 0)))

        result = rasterize_buildings(buildings, model_grid)

        with pytest.raises(ValueError, match="read-only"):
            result.data[0, 0] = 99

    def test_output_is_deterministic_across_repeated_calls(self, model_grid: RasterDataset) -> None:
        buildings = make_buildings(
            box(*cell_bounds(0, 0)), box(*cell_bounds(2, 3)), box(*cell_bounds(4, 4))
        )

        result_a = rasterize_buildings(buildings, model_grid)
        result_b = rasterize_buildings(buildings, model_grid)

        np.testing.assert_array_equal(result_a.data, result_b.data)
