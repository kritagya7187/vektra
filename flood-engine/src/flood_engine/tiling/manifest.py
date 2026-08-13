"""Persistent, resumable tile-execution manifest for a city-scale run."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any


class TileStatus(StrEnum):
    """Lifecycle state of one tile's execution."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(slots=True)
class TileRecord:
    """Status, provenance and output location for one tile."""

    tile_id: str
    status: TileStatus
    error_message: str | None = None
    output_dir: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    step_count: int | None = None
    max_depth_m: float | None = None


@dataclass(slots=True)
class RunManifest:
    """The persistent, resumable record of one city-scale tiled run."""

    run_id: str
    created_at: str
    aoi_provenance: dict[str, Any]
    model_config: dict[str, Any]
    software_versions: dict[str, str]
    input_checksums: dict[str, str]
    grid_height: int
    grid_width: int
    tiles: list[TileRecord] = field(default_factory=list)

    def tile(self, tile_id: str) -> TileRecord:
        """Return the record for tile_id, raising if it does not exist."""
        for record in self.tiles:
            if record.tile_id == tile_id:
                return record
        raise KeyError(f"No tile record for {tile_id!r}.")

    def pending_tiles(self) -> list[TileRecord]:
        """Tiles still needing a (re)run -- pending or previously failed."""
        return [t for t in self.tiles if t.status in (TileStatus.PENDING, TileStatus.FAILED)]

    def is_complete(self) -> bool:
        """Whether every tile has completed successfully."""
        return all(t.status == TileStatus.COMPLETED for t in self.tiles)

    def to_dict(self) -> dict[str, Any]:
        """JSON-serializable representation of this manifest."""
        return {
            "run_id": self.run_id,
            "created_at": self.created_at,
            "aoi_provenance": self.aoi_provenance,
            "model_config": self.model_config,
            "software_versions": self.software_versions,
            "input_checksums": self.input_checksums,
            "grid_height": self.grid_height,
            "grid_width": self.grid_width,
            "tiles": [asdict(t) for t in self.tiles],
        }


def write_manifest(manifest: RunManifest, path: Path) -> None:
    """Write a manifest to disk as JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest.to_dict(), indent=2, default=str))


def read_manifest(path: Path) -> RunManifest:
    """Read a manifest back from disk, for resuming a run."""
    data = json.loads(path.read_text())
    tiles = [TileRecord(**{**t, "status": TileStatus(t["status"])}) for t in data.pop("tiles")]
    return RunManifest(tiles=tiles, **data)


__all__ = ["RunManifest", "TileRecord", "TileStatus", "read_manifest", "write_manifest"]
