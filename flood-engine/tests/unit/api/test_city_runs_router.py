"""Unit tests for flood_engine.api.routers.city_runs.

Pure filesystem fixtures via tmp_path -- no database, no job queue.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from flood_engine.api.app import create_app
from flood_engine.api.routers.city_runs import get_storage_config
from flood_engine.config import StorageConfig


def _client_over(base_dir: Path) -> TestClient:
    test_app = create_app()
    test_app.dependency_overrides[get_storage_config] = lambda: StorageConfig(
        flood_output_storage_dir=base_dir
    )
    return TestClient(test_app)


def _write_run(base_dir: Path, run_id: str, *, tile_statuses: list[str]) -> None:
    run_dir = base_dir / run_id
    run_dir.mkdir(parents=True)
    manifest = {
        "run_id": run_id,
        "created_at": "2026-08-13T15:45:57Z",
        "tiles": [{"tile_id": f"t{i}", "status": s} for i, s in enumerate(tile_statuses)],
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest))
    (run_dir / "run_summary.json").write_text(
        json.dumps({"run_id": run_id, "tile_count": len(tile_statuses)})
    )
    (run_dir / "run_status.json").write_text(json.dumps({"status": "completed"}))


class TestListCityRuns:
    def test_returns_empty_list_when_storage_dir_does_not_exist(self, tmp_path: Path) -> None:
        client = _client_over(tmp_path / "does-not-exist")

        response = client.get("/api/v1/city-runs")

        assert response.status_code == 200
        assert response.json() == []

    def test_lists_a_real_run_with_tile_progress(self, tmp_path: Path) -> None:
        _write_run(
            tmp_path, "mumbai-20260813T154557Z", tile_statuses=["completed", "completed", "pending"]
        )
        client = _client_over(tmp_path)

        response = client.get("/api/v1/city-runs")

        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["run_id"] == "mumbai-20260813T154557Z"
        assert body[0]["status"] == "completed"
        assert body[0]["tile_count"] == 3
        assert body[0]["tiles_completed"] == 2

    def test_skips_directories_without_a_manifest(self, tmp_path: Path) -> None:
        (tmp_path / "not-a-run").mkdir()
        client = _client_over(tmp_path)

        response = client.get("/api/v1/city-runs")

        assert response.json() == []


class TestGetCityRun:
    def test_returns_manifest_summary_and_status(self, tmp_path: Path) -> None:
        _write_run(tmp_path, "mumbai-20260813T154557Z", tile_statuses=["completed"])
        client = _client_over(tmp_path)

        response = client.get("/api/v1/city-runs/mumbai-20260813T154557Z")

        assert response.status_code == 200
        body = response.json()
        assert body["manifest"]["run_id"] == "mumbai-20260813T154557Z"
        assert body["run_summary"]["tile_count"] == 1
        assert body["run_status"]["status"] == "completed"

    def test_returns_404_when_run_does_not_exist(self, tmp_path: Path) -> None:
        client = _client_over(tmp_path)

        response = client.get("/api/v1/city-runs/no-such-run")

        assert response.status_code == 404

    def test_rejects_path_traversal_in_run_id(self, tmp_path: Path) -> None:
        client = _client_over(tmp_path)

        response = client.get("/api/v1/city-runs/..%2F..%2Fetc")

        assert response.status_code in (400, 404)


class TestGetCityRunBoundary:
    def test_returns_the_real_geojson_verbatim(self, tmp_path: Path) -> None:
        _write_run(tmp_path, "mumbai-20260813T154557Z", tile_statuses=["completed"])
        boundary = {"type": "FeatureCollection", "features": []}
        (tmp_path / "mumbai-20260813T154557Z" / "aoi.geojson").write_text(json.dumps(boundary))
        client = _client_over(tmp_path)

        response = client.get("/api/v1/city-runs/mumbai-20260813T154557Z/boundary")

        assert response.status_code == 200
        assert response.json() == boundary

    def test_returns_404_when_boundary_file_is_missing(self, tmp_path: Path) -> None:
        _write_run(tmp_path, "mumbai-20260813T154557Z", tile_statuses=["completed"])
        client = _client_over(tmp_path)

        response = client.get("/api/v1/city-runs/mumbai-20260813T154557Z/boundary")

        assert response.status_code == 404


class TestDownloadCityRunArtifact:
    def test_streams_a_real_geotiff(self, tmp_path: Path) -> None:
        _write_run(tmp_path, "mumbai-20260813T154557Z", tile_statuses=["completed"])
        outputs_dir = tmp_path / "mumbai-20260813T154557Z" / "outputs"
        outputs_dir.mkdir()
        (outputs_dir / "max_depth_m.tif").write_bytes(b"fake-tiff-bytes")
        client = _client_over(tmp_path)

        response = client.get(
            "/api/v1/city-runs/mumbai-20260813T154557Z/download/max-depth-geotiff"
        )

        assert response.status_code == 200
        assert response.content == b"fake-tiff-bytes"
        assert response.headers["content-type"] == "image/tiff"

    def test_returns_404_when_output_file_is_missing(self, tmp_path: Path) -> None:
        _write_run(tmp_path, "mumbai-20260813T154557Z", tile_statuses=["completed"])
        client = _client_over(tmp_path)

        response = client.get(
            "/api/v1/city-runs/mumbai-20260813T154557Z/download/max-depth-geotiff"
        )

        assert response.status_code == 404
