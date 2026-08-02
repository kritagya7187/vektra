"""Integration tests for flood_engine.preprocessing.landcover_preprocessing.

Placed under tests/integration/ per this module's own categorization
(tests/integration/__init__.py): resampling is real geospatial warp
computation, tested against real (fixture) GeoTIFFs, not pure logic.
"""

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.transform import Affine

from flood_engine.core.grid import MODEL_GRID_EPSG_CODE
from flood_engine.io.raster_loader import RasterDataset, RasterValidationError, load_raster
from flood_engine.preprocessing.landcover_preprocessing import preprocess_landcover

WGS84 = CRS.from_epsg(4326)
MODEL_CRS = CRS.from_epsg(MODEL_GRID_EPSG_CODE)

# Real ESA WorldCover v100 class codes, used here only as arbitrary test
# values -- this test file, like the module under test, attaches no
# meaning to them.
CROPLAND = 40
BUILT_UP = 50


def _write_geotiff(
    path: Path,
    *,
    data: np.ndarray,
    crs: CRS,
    transform: Affine,
    nodata: float | None,
) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype=data.dtype,
        crs=crs,
        transform=transform,
        nodata=nodata,
    ) as dst:
        dst.write(data, 1)


@pytest.fixture
def model_grid() -> RasterDataset:
    """A small, already-established model-grid raster -- stands in for Step 7's DEM output.

    Constructed directly (not loaded from a file) since only its crs/
    transform/shape are used by the module under test, per its own
    documented contract ("its own pixel values are not read").
    """
    return RasterDataset(
        data=np.zeros((9, 9), dtype=np.float32),
        crs=MODEL_CRS,
        transform=Affine(30.0, 0.0, 268_000.0, 0.0, -30.0, 2_102_000.0),
        nodata=-9999.0,
    )


@pytest.fixture
def wgs84_landcover_path(tmp_path: Path) -> Path:
    """A small, valid WorldCover-like categorical raster in WGS84, 10m native resolution.

    Origin chosen to genuinely spatially overlap model_grid's UTM footprint
    (verified by converting model_grid's corners to WGS84: roughly
    lon [72.7962, 72.7988], lat [18.9951, 18.9975]) with margin on all
    sides -- a real bug in an earlier version of this fixture used origins
    that were geographically close (~400m apart) but did not actually
    overlap once reprojected, given how small both rasters are, causing
    every destination cell to correctly (but unhelpfully for this test)
    resolve to nodata.
    """
    path = tmp_path / "worldcover_wgs84.tif"
    transform = Affine(0.00009, 0.0, 72.795, 0.0, -0.00009, 18.998)  # ~10m
    data = np.full((40, 40), CROPLAND, dtype=np.uint8)
    data[0:12, 0:12] = BUILT_UP  # a distinct block, for majority-resampling assertions
    _write_geotiff(path, data=data, crs=WGS84, transform=transform, nodata=255)
    return path


@pytest.fixture
def already_aligned_landcover_path(tmp_path: Path, model_grid: RasterDataset) -> Path:
    """A land-cover raster already pixel-for-pixel identical to model_grid's own grid."""
    path = tmp_path / "worldcover_aligned.tif"
    data = np.full((9, 9), CROPLAND, dtype=np.uint8)
    _write_geotiff(
        path, data=data, crs=model_grid.crs, transform=model_grid.transform, nodata=255
    )
    return path


class TestPreprocessLandcover:
    def test_returns_same_object_when_already_aligned(
        self, already_aligned_landcover_path: Path, model_grid: RasterDataset
    ) -> None:
        landcover = load_raster(already_aligned_landcover_path)

        result = preprocess_landcover(landcover, model_grid)

        # Identity, not just equality -- proves zero resampling happened.
        assert result is landcover

    def test_aligns_to_model_grid_crs_transform_and_shape_exactly(
        self, wgs84_landcover_path: Path, model_grid: RasterDataset
    ) -> None:
        landcover = load_raster(wgs84_landcover_path)

        result = preprocess_landcover(landcover, model_grid)

        assert result.crs == model_grid.crs
        assert result.transform == model_grid.transform
        assert result.data.shape == model_grid.data.shape
        assert result is not landcover

    def test_preserves_source_dtype(
        self, wgs84_landcover_path: Path, model_grid: RasterDataset
    ) -> None:
        landcover = load_raster(wgs84_landcover_path)

        result = preprocess_landcover(landcover, model_grid)

        assert result.dtype == landcover.dtype

    def test_preserves_source_nodata_value(
        self, wgs84_landcover_path: Path, model_grid: RasterDataset
    ) -> None:
        landcover = load_raster(wgs84_landcover_path)

        result = preprocess_landcover(landcover, model_grid)

        assert result.nodata == landcover.nodata

    def test_only_source_class_values_appear_never_interpolated_values(
        self, wgs84_landcover_path: Path, model_grid: RasterDataset
    ) -> None:
        landcover = load_raster(wgs84_landcover_path)

        result = preprocess_landcover(landcover, model_grid)

        # The defining property of majority resampling on categorical
        # data: every output value must be one of the real source class
        # codes (or nodata) -- never a fractional/averaged value, which
        # bilinear/cubic would produce and which would be scientifically
        # meaningless for a class code.
        valid_values = set(np.unique(result.data)) - {result.nodata}
        assert valid_values <= {CROPLAND, BUILT_UP}

    def test_majority_class_wins_within_a_resampled_cell(
        self, wgs84_landcover_path: Path, model_grid: RasterDataset
    ) -> None:
        landcover = load_raster(wgs84_landcover_path)

        result = preprocess_landcover(landcover, model_grid)

        # The source BUILT_UP block occupies a small corner of the 30x30
        # source grid -- the overwhelming majority of resampled cells
        # must resolve to CROPLAND, proving mode (not e.g. first-value or
        # last-value) resampling is actually in effect.
        valid = result.data[result.data != result.nodata]
        assert (valid == CROPLAND).sum() > (valid == BUILT_UP).sum()

    def test_raises_when_source_has_no_nodata(
        self, tmp_path: Path, model_grid: RasterDataset
    ) -> None:
        path = tmp_path / "no_nodata.tif"
        transform = Affine(0.00009, 0.0, 72.8, 0.0, -0.00009, 19.0)
        _write_geotiff(
            path,
            data=np.full((10, 10), CROPLAND, dtype=np.uint8),
            crs=WGS84,
            transform=transform,
            nodata=None,
        )
        landcover = load_raster(path)

        with pytest.raises(RasterValidationError, match="no defined nodata"):
            preprocess_landcover(landcover, model_grid)

    def test_result_is_a_valid_immutable_raster_dataset(
        self, wgs84_landcover_path: Path, model_grid: RasterDataset
    ) -> None:
        landcover = load_raster(wgs84_landcover_path)

        result = preprocess_landcover(landcover, model_grid)

        assert isinstance(result, RasterDataset)
        with pytest.raises(ValueError, match="read-only"):
            result.data[0, 0] = 1
