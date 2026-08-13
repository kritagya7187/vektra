"""api.routers.rainfall_events: real ERA5-Land rainfall days, and a real per-day forcing array.

``meteorological_observation`` holds real ERA5-Land hourly precipitation
for one station point -- this router lists which real UTC days have a
complete 24-hour series, and can turn one real day's real hourly values
into a validated :class:`~flood_engine.inputs.rainfall.RainfallForcing`
array a job submission can reference. No fabricated rainfall, no WCA2D
change -- this only prepares one of the five array inputs the existing
job-queue submission path already accepts.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from psycopg_pool import ConnectionPool

from flood_engine.api.dependencies import get_db_pool
from flood_engine.config import StorageConfig
from flood_engine.inputs.rainfall import RainfallForcingError, load_rainfall_forcing
from flood_engine.logging_config import LogSubsystem, get_logger
from flood_engine.persistence.serialization import write_array

logger = get_logger(LogSubsystem.API, "rainfall_events")

router = APIRouter(prefix="/api/v1/rainfall-events", tags=["rainfall-events"])

_VARIABLE_NAME = "total_precipitation_hourly"
_STATION_LON = 72.8325
_STATION_LAT = 18.9275
_HOURS_PER_DAY = 24
_METERS_TO_MM = 1000.0

PoolDep = Annotated[ConnectionPool, Depends(get_db_pool)]


def get_storage_config() -> StorageConfig:
    """Build the storage configuration a route needs to locate the rainfall-array scratch dir."""
    return StorageConfig()


StorageConfigDep = Annotated[StorageConfig, Depends(get_storage_config)]


@router.get("")
def list_rainfall_events(pool: PoolDep) -> dict[str, Any]:
    """List every real UTC day with a complete 24-hour precipitation series."""
    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT (observation_timestamp AT TIME ZONE 'UTC')::date AS day,
                   SUM(variable_value) AS total_m,
                   MAX(variable_value) AS max_hourly_m,
                   COUNT(*) AS row_count
            FROM meteorological_observation
            WHERE variable_name = %s
            GROUP BY day
            HAVING COUNT(*) = %s
            ORDER BY day
            """,
            (_VARIABLE_NAME, _HOURS_PER_DAY),
        ).fetchall()
        provenance_row = conn.execute(
            """
            SELECT dp.source_product_identifier, dp.license, dp.retrieval_timestamp,
                   ds.display_name
            FROM data_provenance_record dp
            JOIN meteorological_observation mo ON mo.provenance_id = dp.provenance_id
            JOIN data_source ds ON ds.source_code = mo.source_code
            WHERE mo.variable_name = %s
            LIMIT 1
            """,
            (_VARIABLE_NAME,),
        ).fetchone()

    days = [
        {
            "date": day.isoformat(),
            "total_mm": float(total_m) * _METERS_TO_MM,
            "max_hourly_mm": float(max_hourly_m) * _METERS_TO_MM,
        }
        for day, total_m, max_hourly_m, _row_count in rows
    ]
    provenance = (
        {
            "source_product_identifier": provenance_row[0],
            "license": provenance_row[1],
            "retrieved_at": provenance_row[2].isoformat(),
            "source_display_name": provenance_row[3],
        }
        if provenance_row
        else None
    )
    return {
        "station": {"lon": _STATION_LON, "lat": _STATION_LAT},
        "provenance": provenance,
        "days": days,
    }


@router.post("/{event_date}/prepare")
def prepare_rainfall_event(
    event_date: str, pool: PoolDep, storage: StorageConfigDep
) -> dict[str, Any]:
    """Build a real per-hour forcing array from one real day's real ERA5-Land rows.

    Raises:
        HTTPException: 400 if ``event_date`` is not a valid ISO date; 404
            if that day does not have a real, complete 24-hour series.
    """
    try:
        parsed_date = date.fromisoformat(event_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date {event_date!r}.") from exc

    start = datetime(parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=UTC)
    end = start + timedelta(days=1)

    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT observation_timestamp, variable_value
            FROM meteorological_observation
            WHERE variable_name = %s AND observation_timestamp >= %s AND observation_timestamp < %s
            ORDER BY observation_timestamp
            """,
            (_VARIABLE_NAME, start, end),
        ).fetchall()

    if len(rows) != _HOURS_PER_DAY:
        raise HTTPException(
            status_code=404,
            detail=f"No complete real 24-hour rainfall series exists for {event_date!r}.",
        )

    records = [(timestamp, float(value) * _METERS_TO_MM) for timestamp, value in rows]
    try:
        forcing = load_rainfall_forcing(records, unit="mm/hr")
    except RainfallForcingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    output_path = storage.flood_output_storage_dir / "rainfall-events" / f"{event_date}.npy"
    write_array(forcing.rainfall_mm_per_hr, output_path)
    logger.info(
        "rainfall-events.prepared",
        extra={"date": event_date, "path": str(output_path)},
    )

    return {
        "rainfall_rates_path": str(output_path),
        "hours": len(forcing.timestamps),
        "total_mm": float(forcing.rainfall_mm_per_hr.sum()),
    }


__all__ = ["router"]
