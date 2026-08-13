"""Georeferenced GeoTIFF output for FloodOutputSummary rasters."""

from pathlib import Path
from typing import Final

import numpy as np
import rasterio
from numpy.typing import NDArray
from rasterio.crs import CRS
from rasterio.transform import Affine

from flood_engine.output.generator import FloodOutputSummary

NODATA_VALUE: Final[float] = -9999.0

_GTIFF_PROFILE: Final[dict[str, object]] = {
    "driver": "GTiff",
    "dtype": "float32",
    "count": 1,
    "tiled": True,
    "blockxsize": 256,
    "blockysize": 256,
    "compress": "DEFLATE",
    "predictor": 3,
    "interleave": "band",
}


def write_geotiff(
    array: NDArray[np.float64],
    *,
    transform: Affine,
    crs: CRS,
    path: Path,
    nodata: float = NODATA_VALUE,
) -> Path:
    """Write one 2D array as a real, CRS-tagged, tiled/compressed GeoTIFF."""
    path.parent.mkdir(parents=True, exist_ok=True)
    filled = np.where(np.isnan(array), nodata, array).astype(np.float32)

    profile = dict(_GTIFF_PROFILE)
    profile.update(
        height=array.shape[0],
        width=array.shape[1],
        transform=transform,
        crs=crs,
        nodata=nodata,
    )

    with rasterio.open(path, "w", **profile) as dst:
        dst.write(filled, 1)

    return path


def write_flood_output_geotiffs(
    summary: FloodOutputSummary,
    *,
    transform: Affine,
    crs: CRS,
    out_dir: Path,
) -> dict[str, Path]:
    """Write max_depth/arrival_time/duration as three georeferenced GeoTIFFs."""
    out_dir.mkdir(parents=True, exist_ok=True)
    return {
        "max_depth_m": write_geotiff(
            summary.max_depth_m, transform=transform, crs=crs, path=out_dir / "max_depth_m.tif"
        ),
        "arrival_time_min": write_geotiff(
            summary.arrival_time_min,
            transform=transform,
            crs=crs,
            path=out_dir / "arrival_time_min.tif",
        ),
        "duration_above_threshold_min": write_geotiff(
            summary.duration_above_threshold_min,
            transform=transform,
            crs=crs,
            path=out_dir / "duration_above_threshold_min.tif",
        ),
    }


__all__ = ["NODATA_VALUE", "write_flood_output_geotiffs", "write_geotiff"]
