"""Integration tests for flood_engine.api.routers.rainfall_events.

Runs against a real, disposable Postgres instance
(``FLOOD_ENGINE_TEST_DB_*`` env vars, same convention as
test_postgres_job_repository.py) -- skipped if unreachable. Creates its
own minimal ``data_source``/``data_provenance_record``/
``meteorological_observation`` fixture rows rather than depending on the
real Mumbai dataset always being present.
"""

import os
from collections.abc import Iterator
from datetime import datetime, timedelta
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg_pool import ConnectionPool

from flood_engine.api.app import create_app
from flood_engine.api.dependencies import get_db_pool
from flood_engine.api.routers.rainfall_events import get_storage_config
from flood_engine.config import StorageConfig

TEST_DB_HOST = os.environ.get("FLOOD_ENGINE_TEST_DB_HOST", "localhost")
TEST_DB_PORT = int(os.environ.get("FLOOD_ENGINE_TEST_DB_PORT", "55432"))
TEST_DB_NAME = os.environ.get("FLOOD_ENGINE_TEST_DB_NAME", "flood_engine_test")
TEST_DB_USER = os.environ.get("FLOOD_ENGINE_TEST_DB_USER", "postgres")
TEST_DB_PASSWORD = os.environ.get("FLOOD_ENGINE_TEST_DB_PASSWORD", "test_password")


def _conninfo() -> str:
    return (
        f"host={TEST_DB_HOST} port={TEST_DB_PORT} dbname={TEST_DB_NAME} "
        f"user={TEST_DB_USER} password={TEST_DB_PASSWORD}"
    )


def _db_reachable() -> bool:
    try:
        with psycopg.connect(_conninfo(), connect_timeout=2):
            return True
    except psycopg.OperationalError:
        return False


pytestmark = pytest.mark.skipif(
    not _db_reachable(), reason="Real disposable test Postgres is not reachable."
)

_SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS data_source (
    source_code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    license TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS data_provenance_record (
    provenance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code TEXT NOT NULL REFERENCES data_source(source_code),
    source_product_identifier TEXT NOT NULL,
    retrieval_timestamp TIMESTAMPTZ NOT NULL,
    license TEXT NOT NULL,
    ingestion_pipeline_version TEXT NOT NULL,
    checksum TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meteorological_observation (
    met_observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code TEXT NOT NULL REFERENCES data_source(source_code),
    observation_timestamp TIMESTAMPTZ NOT NULL,
    location TEXT NOT NULL,
    variable_name TEXT NOT NULL,
    variable_value NUMERIC NOT NULL,
    variable_unit TEXT NOT NULL,
    provenance_id UUID NOT NULL REFERENCES data_provenance_record(provenance_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


@pytest.fixture
def pool() -> Iterator[ConnectionPool]:
    test_pool = ConnectionPool(conninfo=_conninfo(), min_size=1, max_size=2, open=True)
    with test_pool.connection() as conn:
        conn.execute(_SCHEMA_SQL)
        conn.execute(
            "TRUNCATE meteorological_observation, data_provenance_record, data_source CASCADE"
        )
        conn.execute(
            "INSERT INTO data_source (source_code, display_name, license) "
            "VALUES ('era5', 'ERA5-Land test fixture', 'Test license')"
        )
        conn.execute(
            "INSERT INTO data_provenance_record "
            "(provenance_id, source_code, source_product_identifier, retrieval_timestamp, "
            " license, ingestion_pipeline_version) "
            "VALUES (gen_random_uuid(), 'era5', 'test:fixture', now(), 'Test license', 'test')"
        )
    yield test_pool
    test_pool.close()


def _first_provenance_id(conn: psycopg.Connection) -> str:
    row = conn.execute("SELECT provenance_id FROM data_provenance_record LIMIT 1").fetchone()
    assert row is not None
    return str(row[0])


def _insert_full_day(pool: ConnectionPool, day: str, mm_per_hour: float) -> None:
    with pool.connection() as conn:
        provenance_id = _first_provenance_id(conn)
        start = datetime.fromisoformat(f"{day}T00:00:00+00:00")
        for hour in range(24):
            timestamp = start + timedelta(hours=hour)
            conn.execute(
                "INSERT INTO meteorological_observation "
                "(source_code, observation_timestamp, location, variable_name, variable_value, "
                " variable_unit, provenance_id) "
                "VALUES ('era5', %s, 'POINT(72.8325 18.9275)', "
                "'total_precipitation_hourly', %s, 'm', %s)",
                (timestamp, mm_per_hour / 1000.0, provenance_id),
            )


def _client(pool: ConnectionPool, tmp_path: Path) -> TestClient:
    test_app = create_app()
    test_app.dependency_overrides[get_db_pool] = lambda: pool
    test_app.dependency_overrides[get_storage_config] = lambda: StorageConfig(
        flood_output_storage_dir=tmp_path
    )
    return TestClient(test_app)


class TestListRainfallEvents:
    def test_returns_empty_days_when_no_data_exists(
        self, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        client = _client(pool, tmp_path)

        response = client.get("/api/v1/rainfall-events")

        assert response.status_code == 200
        assert response.json()["days"] == []

    def test_lists_a_real_complete_day_with_correct_mm_conversion(
        self, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        _insert_full_day(pool, "2020-07-15", mm_per_hour=2.0)
        client = _client(pool, tmp_path)

        response = client.get("/api/v1/rainfall-events")

        assert response.status_code == 200
        body = response.json()
        assert len(body["days"]) == 1
        assert body["days"][0]["date"] == "2020-07-15"
        assert body["days"][0]["total_mm"] == pytest.approx(48.0)
        assert body["days"][0]["max_hourly_mm"] == pytest.approx(2.0)
        assert body["provenance"]["source_display_name"] == "ERA5-Land test fixture"

    def test_excludes_an_incomplete_day(self, pool: ConnectionPool, tmp_path: Path) -> None:
        with pool.connection() as conn:
            provenance_id = _first_provenance_id(conn)
            conn.execute(
                "INSERT INTO meteorological_observation "
                "(source_code, observation_timestamp, location, variable_name, variable_value, "
                " variable_unit, provenance_id) "
                "VALUES ('era5', '2020-07-16T00:00:00+00', 'POINT(72.8325 18.9275)', "
                "'total_precipitation_hourly', 0.001, 'm', %s)",
                (provenance_id,),
            )
        client = _client(pool, tmp_path)

        response = client.get("/api/v1/rainfall-events")

        assert response.json()["days"] == []


class TestPrepareRainfallEvent:
    def test_writes_a_real_array_for_a_complete_day(
        self, pool: ConnectionPool, tmp_path: Path
    ) -> None:
        _insert_full_day(pool, "2020-07-15", mm_per_hour=2.0)
        client = _client(pool, tmp_path)

        response = client.post("/api/v1/rainfall-events/2020-07-15/prepare")

        assert response.status_code == 200
        body = response.json()
        assert body["hours"] == 24
        assert body["total_mm"] == pytest.approx(48.0)
        written = Path(body["rainfall_rates_path"])
        assert written.is_file()

    def test_returns_404_for_a_day_with_no_data(self, pool: ConnectionPool, tmp_path: Path) -> None:
        client = _client(pool, tmp_path)

        response = client.post("/api/v1/rainfall-events/2020-01-01/prepare")

        assert response.status_code == 404

    def test_returns_400_for_an_invalid_date(self, pool: ConnectionPool, tmp_path: Path) -> None:
        client = _client(pool, tmp_path)

        response = client.post("/api/v1/rainfall-events/not-a-date/prepare")

        assert response.status_code == 400
