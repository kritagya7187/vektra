"""Builds a real, small, fast demo scenario from actual ingested Mumbai data.

Replaces the old /vektra-demo-data placeholder (files that never existed)
with real .npy arrays windowed from the real SRTM DEM / ESA WorldCover
extracts and real OSM buildings already ingested for this project.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import geopandas as gpd
import numpy as np
import psycopg
from rasterio.crs import CRS
from rasterio.windows import Window
from shapely import wkb
from shapely.geometry import box

from flood_engine.config import DatabaseConfig
from flood_engine.core.grid import MODEL_GRID_EPSG_CODE
from flood_engine.core.solver.infiltration import infiltration_grid
from flood_engine.core.solver.roughness import roughness_grid
from flood_engine.io.raster_loader import load_raster
from flood_engine.persistence.serialization import write_array
from flood_engine.preprocessing.building_rasterization import rasterize_buildings
from flood_engine.preprocessing.dem_preprocessing import preprocess_dem
from flood_engine.preprocessing.landcover_preprocessing import preprocess_landcover

MODEL_CRS = CRS.from_epsg(MODEL_GRID_EPSG_CODE)
DEMO_WINDOW_PX = 120


def build(dem_path: Path, landcover_path: Path, out_dir: Path) -> None:
    """Write real demo elevation/building_mask/manning_n/infiltration .npy arrays to out_dir."""
    dem_full = load_raster(dem_path)
    window = Window(
        col_off=dem_full.width // 2 - DEMO_WINDOW_PX // 2,
        row_off=dem_full.height // 2 - DEMO_WINDOW_PX // 2,
        width=DEMO_WINDOW_PX,
        height=DEMO_WINDOW_PX,
    )
    dem_window = load_raster(dem_path, window=window)
    dem = preprocess_dem(dem_window)

    landcover_window = load_raster(
        landcover_path, window=_scaled_window(window, dem_full, landcover_path)
    )
    landcover = preprocess_landcover(landcover_window, dem)

    database_config = DatabaseConfig()  # type: ignore[call-arg]
    conninfo = (
        f"host={database_config.postgres_host} port={database_config.postgres_port} "
        f"dbname={database_config.postgres_db} user={database_config.postgres_user} "
        f"password={database_config.postgres_password.get_secret_value()}"
    )
    minx, miny, maxx, maxy = _bounds_wgs84(dem)
    with psycopg.connect(conninfo) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT building_id, ST_AsBinary(geom_utm43n) FROM building "
            "WHERE geom_utm43n IS NOT NULL "
            "AND ST_Intersects(geom_wgs84, ST_MakeEnvelope(%s, %s, %s, %s, 4326))",
            (minx, miny, maxx, maxy),
        )
        rows = cur.fetchall()

    if rows:
        geoms = [wkb.loads(bytes(row[1])) for row in rows]
        buildings = gpd.GeoDataFrame(
            {"building_id": [r[0] for r in rows]}, geometry=geoms, crs=MODEL_CRS
        )
        building_mask = rasterize_buildings(buildings, dem).data.astype(np.bool_)
    else:
        building_mask = np.zeros(dem.data.shape, dtype=np.bool_)

    manning_n = roughness_grid(landcover.data, building_mask=building_mask)
    infiltration = infiltration_grid(landcover.data, building_mask=building_mask)
    elevation_m = dem.data.astype(np.float64)
    rainfall_rates = np.full(2, 30.0, dtype=np.float64)

    out_dir.mkdir(parents=True, exist_ok=True)
    write_array(elevation_m, out_dir / "elevation.npy")
    write_array(building_mask.astype(np.float64), out_dir / "building_mask.npy")
    write_array(manning_n, out_dir / "manning_n.npy")
    write_array(infiltration, out_dir / "infiltration.npy")
    write_array(rainfall_rates, out_dir / "rainfall.npy")

    provenance = {
        "generated_at": datetime.now(UTC).isoformat(),
        "source_dem": str(dem_path),
        "source_landcover": str(landcover_path),
        "window_px": DEMO_WINDOW_PX,
        "grid_shape": list(elevation_m.shape),
        "bounds_wgs84": [minx, miny, maxx, maxy],
        "elevation_transform": [
            dem.transform.a,
            dem.transform.b,
            dem.transform.c,
            dem.transform.d,
            dem.transform.e,
            dem.transform.f,
        ],
        "elevation_crs_epsg": MODEL_GRID_EPSG_CODE,
        "building_count": len(rows),
        "note": "Real windowed subset of the actual ingested Mumbai DEM/land-cover/buildings, "
        "not synthetic.",
    }
    (out_dir / "provenance.json").write_text(json.dumps(provenance, indent=2))


_REPROJECTION_MARGIN_PX = 3


def _scaled_window(window: Window, dem_full: object, landcover_path: Path) -> Window:
    dem_transform = dem_full.transform  # type: ignore[attr-defined]
    x0, y0 = dem_transform * (window.col_off, window.row_off)
    x1, y1 = dem_transform * (window.col_off + window.width, window.row_off + window.height)
    lc = load_raster(landcover_path)
    inv = ~lc.transform
    col0, row0 = inv * (x0, y0)
    col1, row1 = inv * (x1, y1)
    col_off = max(0, min(col0, col1) - _REPROJECTION_MARGIN_PX)
    row_off = max(0, min(row0, row1) - _REPROJECTION_MARGIN_PX)
    col_end = min(lc.width, max(col0, col1) + _REPROJECTION_MARGIN_PX)
    row_end = min(lc.height, max(row0, row1) + _REPROJECTION_MARGIN_PX)
    return Window(
        col_off=col_off,
        row_off=row_off,
        width=col_end - col_off,
        height=row_end - row_off,
    )


def _bounds_wgs84(dem: object) -> tuple[float, float, float, float]:
    transform = dem.transform  # type: ignore[attr-defined]
    data = dem.data  # type: ignore[attr-defined]
    height, width = data.shape
    x0, y0 = transform * (0, 0)
    x1, y1 = transform * (width, height)
    gdf = gpd.GeoDataFrame(
        geometry=[box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))], crs=MODEL_CRS
    )
    b = gdf.to_crs(epsg=4326).total_bounds
    return float(b[0]), float(b[1]), float(b[2]), float(b[3])


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--dem", type=Path, required=True)
    parser.add_argument("--landcover", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, default=Path("demo-data"))
    args = parser.parse_args()
    build(args.dem, args.landcover, args.out_dir)
    print(f"wrote real demo scenario to {args.out_dir}")
