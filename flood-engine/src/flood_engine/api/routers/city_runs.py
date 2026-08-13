"""api.routers.city_runs: read-only exposure of tiled city-scale run artifacts.

``flood_engine.cli.run_city_scale`` writes each run's manifest, AOI
provenance, and summary directly to ``StorageConfig.flood_output_storage_dir``
as plain JSON files -- this router only reads them back. No database, no
job queue, no solver call; a pure filesystem passthrough, the same
"orchestration only" discipline ``api.routers.simulations`` already
follows for the single-scenario job queue.
"""

import json
import re
from pathlib import Path
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from flood_engine.config import StorageConfig
from flood_engine.logging_config import LogSubsystem, get_logger

_ARTIFACT_FILENAMES: dict[str, str] = {
    "max-depth-geotiff": "max_depth_m.tif",
    "arrival-time-geotiff": "arrival_time_min.tif",
    "duration-above-threshold-geotiff": "duration_above_threshold_min.tif",
}

logger = get_logger(LogSubsystem.API, "city_runs")

router = APIRouter(prefix="/api/v1/city-runs", tags=["city-runs"])

_RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def get_storage_config() -> StorageConfig:
    """Build the storage configuration a route needs to locate run directories."""
    return StorageConfig()


StorageConfigDep = Annotated[StorageConfig, Depends(get_storage_config)]


def _run_dir(storage: StorageConfig, run_id: str) -> Path:
    """Resolve ``run_id`` to a run directory, rejecting anything not a plain directory name.

    Raises:
        HTTPException: 400 if ``run_id`` is not a safe bare directory name
            (guards against path traversal via ``..`` or path separators).
    """
    if not _RUN_ID_PATTERN.match(run_id):
        raise HTTPException(status_code=400, detail=f"Invalid run id {run_id!r}.")
    return storage.flood_output_storage_dir / run_id


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    return cast("dict[str, Any]", json.loads(path.read_text()))


@router.get("")
def list_city_runs(storage: StorageConfigDep) -> list[dict[str, Any]]:
    """List every real city-scale run directory, newest first.

    Each entry is a lightweight summary (id, status, tile counts) --
    callers needing full detail (provenance, checksums, per-tile status,
    output paths) call :func:`get_city_run`.
    """
    base_dir = storage.flood_output_storage_dir
    if not base_dir.is_dir():
        return []

    runs: list[dict[str, Any]] = []
    for entry in sorted(base_dir.iterdir(), reverse=True):
        manifest = _read_json(entry / "manifest.json")
        if manifest is None:
            continue
        status = _read_json(entry / "run_status.json")
        tiles = manifest.get("tiles", [])
        completed = sum(1 for tile in tiles if tile.get("status") == "completed")
        runs.append(
            {
                "run_id": manifest.get("run_id", entry.name),
                "created_at": manifest.get("created_at"),
                "status": (status or {}).get("status", "unknown"),
                "tile_count": len(tiles),
                "tiles_completed": completed,
            }
        )
    return runs


@router.get("/{run_id}")
def get_city_run(run_id: str, storage: StorageConfigDep) -> dict[str, Any]:
    """Return one run's manifest, summary, and status, merged.

    Raises:
        HTTPException: 404 if the run directory or its manifest doesn't exist.
    """
    run_dir = _run_dir(storage, run_id)
    manifest = _read_json(run_dir / "manifest.json")
    if manifest is None:
        raise HTTPException(status_code=404, detail=f"No city-scale run found with id {run_id!r}.")

    return {
        "manifest": manifest,
        "run_summary": _read_json(run_dir / "run_summary.json"),
        "run_status": _read_json(run_dir / "run_status.json"),
    }


@router.get("/{run_id}/boundary")
def get_city_run_boundary(run_id: str, storage: StorageConfigDep) -> dict[str, Any]:
    """Return the real municipal-boundary GeoJSON a city-scale run used, verbatim.

    Raises:
        HTTPException: 404 if the run or its ``aoi.geojson`` doesn't exist.
    """
    run_dir = _run_dir(storage, run_id)
    boundary = _read_json(run_dir / "aoi.geojson")
    if boundary is None:
        raise HTTPException(
            status_code=404, detail=f"No AOI boundary found for city-scale run {run_id!r}."
        )
    return boundary


@router.get("/{run_id}/download/{artifact}")
def download_city_run_artifact(
    run_id: str,
    artifact: Literal[
        "max-depth-geotiff", "arrival-time-geotiff", "duration-above-threshold-geotiff"
    ],
    storage: StorageConfigDep,
) -> FileResponse:
    """Stream one real mosaic GeoTIFF from a completed city-scale run.

    Raises:
        HTTPException: 404 if the run or the specific output file doesn't exist.
    """
    run_dir = _run_dir(storage, run_id)
    file_path = run_dir / "outputs" / _ARTIFACT_FILENAMES[artifact]
    if not file_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"No {artifact!r} output found for city-scale run {run_id!r}.",
        )
    return FileResponse(
        path=file_path,
        media_type="image/tiff",
        filename=f"{run_id}-{artifact}.tif",
    )


__all__ = ["router"]
