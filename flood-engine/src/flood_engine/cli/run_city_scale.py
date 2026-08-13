"""Real, tiled, city-scale WCA2D run against real Mumbai data.

Municipal boundary (OSM) -> real SRTM DEM + ESA WorldCover (already
ingested into PostGIS/raster-storage by the Node backend) -> real OSM
buildings (PostGIS) -> preprocessing -> tile grid -> per-tile WCA2D
(unmodified) -> mosaic -> GeoTIFF -> run manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import geopandas as gpd
import numpy as np
import psycopg
from rasterio.crs import CRS
from shapely import wkb

from flood_engine.aoi.boundary import fetch_mumbai_municipal_boundary
from flood_engine.config import DatabaseConfig, LoggingConfig
from flood_engine.core.grid import MODEL_GRID_EPSG_CODE, MODEL_GRID_RESOLUTION_M
from flood_engine.core.solver.infiltration import infiltration_grid
from flood_engine.core.solver.roughness import roughness_grid
from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.core.timestepping import TimesteppingParameters
from flood_engine.io.raster_loader import load_raster
from flood_engine.logging_config import LogSubsystem, configure_logging, get_logger, log_duration
from flood_engine.output.geotiff import write_geotiff
from flood_engine.preprocessing.building_rasterization import rasterize_buildings
from flood_engine.preprocessing.dem_preprocessing import preprocess_dem
from flood_engine.preprocessing.landcover_preprocessing import preprocess_landcover
from flood_engine.tiling.grid import TileSpec, generate_tile_grid
from flood_engine.tiling.manifest import RunManifest, TileRecord, TileStatus, write_manifest
from flood_engine.tiling.runner import mosaic_arrays, run_tile

MODEL_CRS = CRS.from_epsg(MODEL_GRID_EPSG_CODE)
logger = get_logger(LogSubsystem.SIMULATION, "run_city_scale")


class RunStatus:
    """Top-level run status, distinct from ``manifest.json``'s per-tile detail.

    A failed tile still fails the whole run today (the loop re-raises) --
    this file exists so a caller can tell "genuinely still running" from
    "crashed" without needing to poll process liveness, satisfying the
    same explicit QUEUED/RUNNING/COMPLETED/FAILED requirement the
    DB-backed job queue already meets for single-scenario runs.
    """

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


def _write_run_status(run_dir: Path, status: str, *, error_message: str | None = None) -> None:
    payload = {
        "status": status,
        "updated_at": datetime.now(UTC).isoformat(),
        "error_message": error_message,
    }
    (run_dir / "run_status.json").write_text(json.dumps(payload, indent=2))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            cwd=Path(__file__).parents[3],
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


def _load_buildings(
    database_config: DatabaseConfig, aoi_wgs84: gpd.GeoDataFrame
) -> gpd.GeoDataFrame:
    conninfo = (
        f"host={database_config.postgres_host} port={database_config.postgres_port} "
        f"dbname={database_config.postgres_db} user={database_config.postgres_user} "
        f"password={database_config.postgres_password.get_secret_value()}"
    )
    minx, miny, maxx, maxy = aoi_wgs84.total_bounds
    with psycopg.connect(conninfo) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT building_id, ST_AsBinary(geom_utm43n) FROM building "
            "WHERE geom_utm43n IS NOT NULL "
            "AND ST_Intersects(geom_wgs84, ST_MakeEnvelope(%s, %s, %s, %s, 4326))",
            (minx, miny, maxx, maxy),
        )
        rows = cur.fetchall()
    geoms = [wkb.loads(bytes(row[1])) for row in rows]
    return gpd.GeoDataFrame({"building_id": [r[0] for r in rows]}, geometry=geoms, crs=MODEL_CRS)


def run(
    *,
    aoi_cache_dir: Path,
    dem_path: Path,
    landcover_path: Path,
    run_output_dir: Path,
    tile_size: int,
    overlap: int,
    rainfall_rate_mm_per_hr: float,
    rainfall_hours: int,
    total_duration_s: float | None,
    solver_parameters: SolverParameters,
    timestepping_parameters: TimesteppingParameters,
) -> Path:
    """Run one real, tiled city-scale simulation and write a full run directory."""
    run_id = datetime.now(UTC).strftime("mumbai-%Y%m%dT%H%M%SZ")
    run_dir = run_output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    _write_run_status(run_dir, RunStatus.RUNNING)

    try:
        return _run(
            run_id=run_id,
            run_dir=run_dir,
            aoi_cache_dir=aoi_cache_dir,
            dem_path=dem_path,
            landcover_path=landcover_path,
            tile_size=tile_size,
            overlap=overlap,
            rainfall_rate_mm_per_hr=rainfall_rate_mm_per_hr,
            rainfall_hours=rainfall_hours,
            total_duration_s=total_duration_s,
            solver_parameters=solver_parameters,
            timestepping_parameters=timestepping_parameters,
        )
    except Exception as exc:
        _write_run_status(run_dir, RunStatus.FAILED, error_message=str(exc))
        raise


def _run(
    *,
    run_id: str,
    run_dir: Path,
    aoi_cache_dir: Path,
    dem_path: Path,
    landcover_path: Path,
    tile_size: int,
    overlap: int,
    rainfall_rate_mm_per_hr: float,
    rainfall_hours: int,
    total_duration_s: float | None,
    solver_parameters: SolverParameters,
    timestepping_parameters: TimesteppingParameters,
) -> Path:
    """The real work :func:`run` wraps with top-level RunStatus tracking."""
    with log_duration(logger, "AOI fetched", run_id=run_id):
        aoi_gdf, aoi_provenance = fetch_mumbai_municipal_boundary(cache_dir=aoi_cache_dir)
    (run_dir / "aoi.geojson").write_text(aoi_gdf.to_json())
    (run_dir / "aoi_provenance.json").write_text(json.dumps(aoi_provenance.to_dict(), indent=2))

    with log_duration(logger, "DEM preprocessed", run_id=run_id):
        dem_raw = load_raster(dem_path)
        dem = preprocess_dem(dem_raw)
    with log_duration(logger, "Land cover preprocessed", run_id=run_id):
        landcover_raw = load_raster(landcover_path)
        landcover = preprocess_landcover(landcover_raw, dem)

    with log_duration(logger, "Buildings loaded and rasterized", run_id=run_id):
        buildings = _load_buildings(DatabaseConfig(), aoi_gdf)  # type: ignore[call-arg]
        if len(buildings) == 0:
            building_mask = np.zeros(dem.data.shape, dtype=np.bool_)
        else:
            building_mask_raster = rasterize_buildings(buildings, dem)
            building_mask = building_mask_raster.data.astype(np.bool_)

    # Real SRTM DEM voids exist over Mumbai's coastal/harbor water (a
    # documented SRTM limitation, confirmed by inspecting the real data:
    # 30,535 of 1,086,612 cells) -- preprocess_dem's own contract passes
    # dem.nodata (-32768.0) through verbatim rather than fabricating an
    # elevation, but nothing downstream excluded those cells before this
    # was discovered. Excluded from the flow domain the same way
    # buildings are (no known terrain here, most plausibly open water
    # outside the DEM product's real coverage) rather than feeding a
    # literal -32768 "elevation" into the solver.
    terrain_unknown_mask = dem.data == dem.nodata
    excluded_mask = building_mask | terrain_unknown_mask | (landcover.data == 0)
    unknown_terrain_cell_count = int(terrain_unknown_mask.sum())
    logger.info(
        "terrain-unknown cells excluded from flow domain",
        extra={"run_id": run_id, "unknown_terrain_cell_count": unknown_terrain_cell_count},
    )

    manning_n = roughness_grid(landcover.data, building_mask=excluded_mask)
    infiltration = infiltration_grid(landcover.data, building_mask=excluded_mask)
    elevation_m = np.where(terrain_unknown_mask, 0.0, dem.data).astype(np.float64)
    building_mask = excluded_mask

    rainfall_rates = np.full(rainfall_hours, rainfall_rate_mm_per_hr, dtype=np.float64)

    height, width = elevation_m.shape
    tiles: tuple[TileSpec, ...] = generate_tile_grid(
        height, width, tile_size=tile_size, overlap=overlap
    )

    manifest = RunManifest(
        run_id=run_id,
        created_at=datetime.now(UTC).isoformat(),
        aoi_provenance=aoi_provenance.to_dict(),
        model_config={
            "resolution_m": MODEL_GRID_RESOLUTION_M,
            "tile_size": tile_size,
            "overlap": overlap,
            "rainfall_rate_mm_per_hr": rainfall_rate_mm_per_hr,
            "rainfall_hours": rainfall_hours,
            "total_duration_s_override": total_duration_s,
            "solver_parameters": asdict(solver_parameters),
            "timestepping_parameters": asdict(timestepping_parameters),
            "crs_epsg": MODEL_GRID_EPSG_CODE,
        },
        software_versions={
            "python": platform.python_version(),
            "git_commit": _git_commit(),
        },
        input_checksums={
            "dem": _sha256(dem_path),
            "landcover": _sha256(landcover_path),
        },
        grid_height=height,
        grid_width=width,
        tiles=[TileRecord(tile_id=t.tile_id, status=TileStatus.PENDING) for t in tiles],
    )
    manifest_path = run_dir / "manifest.json"
    write_manifest(manifest, manifest_path)
    logger.info(
        "city-scale tiling starting", extra={"run_id": run_id, "tile_count": len(tiles)}
    )

    tile_results = []
    for tile_index, tile in enumerate(tiles):
        record = manifest.tile(tile.tile_id)
        record.status = TileStatus.RUNNING
        record.started_at = datetime.now(UTC).isoformat()
        write_manifest(manifest, manifest_path)
        try:
            with log_duration(
                logger,
                "tile completed",
                run_id=run_id,
                tile_id=tile.tile_id,
                tile_index=tile_index,
                tile_count=len(tiles),
            ):
                summary = run_tile(
                    tile,
                    elevation_m=elevation_m,
                    building_mask=building_mask,
                    manning_n=manning_n,
                    infiltration_loss_mm_per_hr=infiltration,
                    rainfall_rates_mm_per_hr=rainfall_rates,
                    solver_parameters=solver_parameters,
                    timestepping_parameters=timestepping_parameters,
                    total_duration_s=total_duration_s,
                )
        except Exception as exc:
            record.status = TileStatus.FAILED
            record.error_message = str(exc)
            record.completed_at = datetime.now(UTC).isoformat()
            write_manifest(manifest, manifest_path)
            raise
        record.status = TileStatus.COMPLETED
        record.completed_at = datetime.now(UTC).isoformat()
        record.step_count = summary.step_count
        record.max_depth_m = float(summary.max_depth_m.max())
        write_manifest(manifest, manifest_path)
        tile_results.append((tile, summary))

    with log_duration(logger, "tiles mosaicked", run_id=run_id):
        mosaic = mosaic_arrays(tile_results, height=height, width=width)

    outputs_dir = run_dir / "outputs"
    outputs_dir.mkdir(exist_ok=True)
    with log_duration(logger, "mosaic GeoTIFFs written", run_id=run_id):
        written = {
            name: write_geotiff(
                array, transform=dem.transform, crs=MODEL_CRS, path=outputs_dir / f"{name}.tif"
            )
            for name, array in mosaic.items()
        }

    summary_json = {
        "run_id": run_id,
        "grid_shape": [height, width],
        "tile_count": len(tiles),
        "max_depth_m_city": float(mosaic["max_depth_m"].max()),
        "wet_cell_count": int(np.count_nonzero(mosaic["max_depth_m"] > 0.05)),
        "wet_area_m2": float(
            np.count_nonzero(mosaic["max_depth_m"] > 0.05) * MODEL_GRID_RESOLUTION_M**2
        ),
        "unknown_terrain_cell_count": unknown_terrain_cell_count,
        "unknown_terrain_note": (
            "Cells with no valid SRTM DEM elevation (real voids, most plausibly "
            "open water/harbor) or no valid land-cover class are excluded from "
            "the flow domain, same as building cells -- not fabricated."
        ),
        "outputs": {k: str(v) for k, v in written.items()},
    }
    (run_dir / "run_summary.json").write_text(json.dumps(summary_json, indent=2))
    _write_run_status(run_dir, RunStatus.COMPLETED)
    logger.info("city-scale run complete", extra={"run_id": run_id, **summary_json})

    return run_dir


def main() -> None:
    """CLI entrypoint: python -m flood_engine.cli.run_city_scale --dem ... --landcover ..."""
    configure_logging(LoggingConfig())
    parser = argparse.ArgumentParser()
    parser.add_argument("--dem", type=Path, required=True)
    parser.add_argument("--landcover", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("run-output"))
    parser.add_argument("--aoi-cache-dir", type=Path, default=Path("aoi_cache"))
    parser.add_argument("--tile-size", type=int, default=256)
    parser.add_argument("--overlap", type=int, default=48)
    parser.add_argument("--rainfall-rate-mm-per-hr", type=float, default=40.0)
    parser.add_argument("--rainfall-hours", type=int, default=2)
    parser.add_argument("--total-duration-s", type=float, default=None)
    args = parser.parse_args()

    started = time.monotonic()
    run_dir = run(
        aoi_cache_dir=args.aoi_cache_dir,
        dem_path=args.dem,
        landcover_path=args.landcover,
        run_output_dir=args.output_dir,
        tile_size=args.tile_size,
        overlap=args.overlap,
        rainfall_rate_mm_per_hr=args.rainfall_rate_mm_per_hr,
        rainfall_hours=args.rainfall_hours,
        total_duration_s=args.total_duration_s,
        solver_parameters=SolverParameters(),
        timestepping_parameters=TimesteppingParameters(),
    )
    elapsed = time.monotonic() - started
    print(f"run complete in {elapsed:.1f}s: {run_dir}")


if __name__ == "__main__":
    main()
