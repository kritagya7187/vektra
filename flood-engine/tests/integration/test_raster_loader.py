"""Integration tests for flood_engine.io.raster_loader.

Placed under tests/integration/ (not tests/unit/) per this module's own
categorization in tests/integration/__init__.py: RasterDataset's
construction-time validation is pure logic, but load_raster fundamentally
exercises real file I/O against real (fixture) GeoTIFFs written to
tmp_path -- the file is grouped by what it predominantly tests, not
fragmented per individual test.
"""

import logging
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.windows import Window

from flood_engine.io.raster_loader import (
    RasterCRSMismatchError,
    RasterDataset,
    RasterValidationError,
    load_raster,
)

UTM_43N = CRS.from_epsg(32643)
WGS84 = CRS.from_epsg(4326)


def _write_geotiff(
    path: Path,
    *,
    data: np.ndarray,
    crs: CRS | None = UTM_43N,
    transform: Affine | None = None,
    nodata: float | None = -9999.0,
    count: int = 1,
) -> None:
    transform = transform or Affine(30.0, 0.0, 200_000.0, 0.0, -30.0, 2_100_000.0)
    height, width = data.shape[-2], data.shape[-1]
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=count,
        dtype=data.dtype,
        crs=crs,
        transform=transform,
        nodata=nodata,
    ) as dst:
        if count == 1:
            dst.write(data, 1)
        else:
            for band in range(1, count + 1):
                dst.write(data, band)


@pytest.fixture
def valid_raster_path(tmp_path: Path) -> Path:
    """A small, valid, georeferenced single-band GeoTIFF in UTM 43N."""
    path = tmp_path / "valid.tif"
    data = np.arange(9, dtype=np.float32).reshape(3, 3)
    _write_geotiff(path, data=data)
    return path


class TestRasterDatasetValidation:
    """Pure construction-time validation -- no file I/O in this class."""

    def _valid_kwargs(self) -> dict[str, object]:
        return {
            "data": np.zeros((3, 3), dtype=np.float32),
            "crs": UTM_43N,
            "transform": Affine(30.0, 0.0, 0.0, 0.0, -30.0, 0.0),
            "nodata": -9999.0,
        }

    def test_valid_construction_succeeds_with_correct_derived_properties(self) -> None:
        raster = RasterDataset(**self._valid_kwargs())  # type: ignore[arg-type]

        assert raster.height == 3
        assert raster.width == 3
        assert raster.resolution == (30.0, 30.0)
        assert raster.dtype == np.float32
        assert raster.bounds.left == 0.0
        assert raster.bounds.top == 0.0

    def test_rejects_missing_crs(self) -> None:
        kwargs = self._valid_kwargs()
        kwargs["crs"] = None

        with pytest.raises(RasterValidationError, match="no CRS"):
            RasterDataset(**kwargs)  # type: ignore[arg-type]

    def test_rejects_identity_transform(self) -> None:
        kwargs = self._valid_kwargs()
        kwargs["transform"] = Affine.identity()

        with pytest.raises(RasterValidationError, match="not georeferenced"):
            RasterDataset(**kwargs)  # type: ignore[arg-type]

    def test_rejects_non_2d_array(self) -> None:
        kwargs = self._valid_kwargs()
        kwargs["data"] = np.zeros((3, 3, 3), dtype=np.float32)

        with pytest.raises(RasterValidationError, match="2D"):
            RasterDataset(**kwargs)  # type: ignore[arg-type]

    def test_rejects_empty_array(self) -> None:
        kwargs = self._valid_kwargs()
        kwargs["data"] = np.zeros((0, 0), dtype=np.float32)

        with pytest.raises(RasterValidationError, match="non-positive dimension"):
            RasterDataset(**kwargs)  # type: ignore[arg-type]

    def test_rejects_zero_pixel_size(self) -> None:
        kwargs = self._valid_kwargs()
        kwargs["transform"] = Affine(0.0, 0.0, 0.0, 0.0, -30.0, 0.0)

        with pytest.raises(RasterValidationError, match="zero pixel size"):
            RasterDataset(**kwargs)  # type: ignore[arg-type]

    def test_reassigning_data_attribute_raises(self) -> None:
        raster = RasterDataset(**self._valid_kwargs())  # type: ignore[arg-type]

        with pytest.raises(AttributeError):
            raster.data = np.ones((3, 3))  # type: ignore[misc]

    def test_mutating_array_contents_in_place_raises(self) -> None:
        raster = RasterDataset(**self._valid_kwargs())  # type: ignore[arg-type]

        with pytest.raises(ValueError, match="read-only"):
            raster.data[0, 0] = 999.0


class TestLoadRaster:
    def test_loads_valid_raster_with_correct_data_and_metadata(
        self, valid_raster_path: Path
    ) -> None:
        raster = load_raster(valid_raster_path)

        assert raster.crs == UTM_43N
        assert raster.width == 3
        assert raster.height == 3
        assert raster.nodata == -9999.0
        np.testing.assert_array_equal(raster.data, np.arange(9, dtype=np.float32).reshape(3, 3))

    def test_loaded_raster_data_is_read_only(self, valid_raster_path: Path) -> None:
        raster = load_raster(valid_raster_path)

        with pytest.raises(ValueError, match="read-only"):
            raster.data[0, 0] = 1.0

    def test_raises_file_not_found_for_missing_path(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            load_raster(tmp_path / "does-not-exist.tif")

    def test_raises_and_logs_on_corrupt_file(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        # A path that exists (so the FileNotFoundError check does not fire)
        # but is not a real raster -- rasterio.open() itself must raise,
        # and load_raster must log before re-raising rather than swallow it.
        path = tmp_path / "corrupt.tif"
        path.write_bytes(b"not a real geotiff, just garbage bytes")

        with (
            caplog.at_level(logging.ERROR, logger="flood_engine.raster_io.raster_loader"),
            pytest.raises(rasterio.errors.RasterioIOError),
        ):
            load_raster(path)

        assert "Failed to open raster" in caplog.text

    def test_succeeds_when_expected_crs_matches(self, valid_raster_path: Path) -> None:
        raster = load_raster(valid_raster_path, expected_crs=UTM_43N)

        assert raster.crs == UTM_43N

    def test_raises_crs_mismatch_when_expected_crs_differs(self, valid_raster_path: Path) -> None:
        with pytest.raises(RasterCRSMismatchError) as exc_info:
            load_raster(valid_raster_path, expected_crs=WGS84)

        assert exc_info.value.actual == UTM_43N
        assert exc_info.value.expected == WGS84

    def test_never_reprojects_on_crs_mismatch(self, valid_raster_path: Path) -> None:
        # The strict-CRS-policy enforcement test: a mismatch must fail
        # loudly, never silently produce a raster in the "expected" CRS.
        with pytest.raises(RasterCRSMismatchError):
            load_raster(valid_raster_path, expected_crs=WGS84)

        # And loading without an expectation still yields the ORIGINAL,
        # unconverted CRS -- proving no reprojection happened anywhere.
        raster = load_raster(valid_raster_path)
        assert raster.crs == UTM_43N

    def test_rejects_multi_band_raster(self, tmp_path: Path) -> None:
        path = tmp_path / "multiband.tif"
        _write_geotiff(path, data=np.zeros((3, 3), dtype=np.float32), count=2)

        with pytest.raises(RasterValidationError, match="single-band"):
            load_raster(path)

    def test_windowed_read_returns_correct_shape_and_offset_transform(
        self, tmp_path: Path
    ) -> None:
        path = tmp_path / "large.tif"
        data = np.arange(100, dtype=np.float32).reshape(10, 10)
        base_transform = Affine(30.0, 0.0, 200_000.0, 0.0, -30.0, 2_100_000.0)
        _write_geotiff(path, data=data, transform=base_transform)

        window = Window(col_off=2, row_off=3, width=4, height=5)
        raster = load_raster(path, window=window)

        assert raster.width == 4
        assert raster.height == 5
        np.testing.assert_array_equal(raster.data, data[3:8, 2:6])
        # The windowed transform's origin must be offset by the window's
        # pixel offset, not identical to the full raster's transform --
        # otherwise every downstream coordinate computed from it would be
        # silently wrong.
        assert raster.transform.c == base_transform.c + 2 * base_transform.a
        assert raster.transform.f == base_transform.f + 3 * base_transform.e

    def test_full_read_without_window_matches_windowed_full_extent_read(
        self, tmp_path: Path
    ) -> None:
        path = tmp_path / "compare.tif"
        data = np.arange(100, dtype=np.float32).reshape(10, 10)
        _write_geotiff(path, data=data)

        full = load_raster(path)
        windowed = load_raster(path, window=Window(col_off=0, row_off=0, width=10, height=10))

        np.testing.assert_array_equal(full.data, windowed.data)
        assert full.transform == windowed.transform
