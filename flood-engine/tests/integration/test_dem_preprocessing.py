"""Integration tests for flood_engine.preprocessing.dem_preprocessing.

Placed under tests/integration/ per this module's own categorization
(tests/integration/__init__.py): reprojection is real geospatial warp
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
from flood_engine.preprocessing.dem_preprocessing import preprocess_dem

WGS84 = CRS.from_epsg(4326)
MODEL_CRS = CRS.from_epsg(MODEL_GRID_EPSG_CODE)


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
def wgs84_dem_path(tmp_path: Path) -> Path:
    """A small, valid DEM in WGS84 -- Copernicus GLO-30's real native CRS."""
    path = tmp_path / "dem_wgs84.tif"
    # A South-Mumbai-scale coordinate origin (real GLO-30 pixel size,
    # ~0.0002777... deg = 1 arc-second), uniform elevation for easy
    # value-correctness assertions after reprojection.
    transform = Affine(0.0002777778, 0.0, 72.8, 0.0, -0.0002777778, 19.0)
    data = np.full((50, 50), 42.0, dtype=np.float32)
    _write_geotiff(path, data=data, crs=WGS84, transform=transform, nodata=-9999.0)
    return path


@pytest.fixture
def already_utm43n_dem_path(tmp_path: Path) -> Path:
    """A DEM already in the model CRS -- the no-op path."""
    path = tmp_path / "dem_utm43n.tif"
    transform = Affine(30.0, 0.0, 268_000.0, 0.0, -30.0, 2_102_000.0)
    data = np.full((10, 10), 15.0, dtype=np.float32)
    _write_geotiff(path, data=data, crs=MODEL_CRS, transform=transform, nodata=-9999.0)
    return path


class TestPreprocessDem:
    def test_returns_same_object_when_already_in_model_crs(
        self, already_utm43n_dem_path: Path
    ) -> None:
        dem = load_raster(already_utm43n_dem_path)

        result = preprocess_dem(dem)

        # Identity, not just equality -- proves zero resampling happened,
        # not merely that the output happens to look the same.
        assert result is dem

    def test_reprojects_wgs84_dem_to_model_crs(self, wgs84_dem_path: Path) -> None:
        dem = load_raster(wgs84_dem_path)

        result = preprocess_dem(dem)

        assert result.crs == MODEL_CRS
        assert result is not dem

    def test_reprojected_resolution_is_close_to_30m(self, wgs84_dem_path: Path) -> None:
        dem = load_raster(wgs84_dem_path)

        result = preprocess_dem(dem)

        res_x, res_y = result.resolution
        # Reprojection distortion at this latitude is small but real --
        # "close to 30m", not exactly 30.0, is the honest expectation.
        assert 29.0 < res_x < 31.0
        assert 29.0 < res_y < 31.0

    def test_preserves_source_nodata_value(self, wgs84_dem_path: Path) -> None:
        dem = load_raster(wgs84_dem_path)

        result = preprocess_dem(dem)

        assert result.nodata == dem.nodata

    def test_preserves_source_dtype(self, wgs84_dem_path: Path) -> None:
        dem = load_raster(wgs84_dem_path)

        result = preprocess_dem(dem)

        assert result.dtype == dem.dtype

    def test_interior_cells_retain_source_value_uniform_dem(self, wgs84_dem_path: Path) -> None:
        dem = load_raster(wgs84_dem_path)

        result = preprocess_dem(dem)

        # The source is a uniform 42.0 grid -- any valid (non-nodata) cell
        # after bilinear interpolation must still be exactly 42.0, proving
        # no scientific alteration of values, only geometric resampling.
        valid = result.data[result.data != result.nodata]
        assert valid.size > 0
        np.testing.assert_allclose(valid, 42.0)

    def test_destination_edge_cells_outside_source_footprint_are_nodata(
        self, wgs84_dem_path: Path
    ) -> None:
        dem = load_raster(wgs84_dem_path)

        result = preprocess_dem(dem)

        # calculate_default_transform's axis-aligned destination bounding
        # box will not perfectly tile the rotated reprojected footprint --
        # some corner cells must be nodata, never a fabricated value.
        assert np.any(result.data == result.nodata)

    def test_raises_when_source_has_no_nodata(self, tmp_path: Path) -> None:
        path = tmp_path / "no_nodata.tif"
        transform = Affine(0.0002777778, 0.0, 72.8, 0.0, -0.0002777778, 19.0)
        _write_geotiff(
            path,
            data=np.full((10, 10), 1.0, dtype=np.float32),
            crs=WGS84,
            transform=transform,
            nodata=None,
        )
        dem = load_raster(path)

        with pytest.raises(RasterValidationError, match="no defined nodata"):
            preprocess_dem(dem)

    def test_result_is_a_valid_immutable_raster_dataset(self, wgs84_dem_path: Path) -> None:
        dem = load_raster(wgs84_dem_path)

        result = preprocess_dem(dem)

        assert isinstance(result, RasterDataset)
        with pytest.raises(ValueError, match="read-only"):
            result.data[0, 0] = 999.0
