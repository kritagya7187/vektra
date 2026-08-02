"""Unit tests for flood_engine.inputs.rainfall.

Pure logic -- no file I/O, no database, no rasterio/geopandas -- per this
module's own placement under tests/unit/, mirroring flood_engine.inputs'
own I/O-free design.
"""

from datetime import UTC, datetime, timedelta, timezone

import numpy as np
import pytest

from flood_engine.inputs.rainfall import (
    EXPECTED_INTERVAL,
    RAINFALL_UNIT,
    RainfallForcing,
    RainfallForcingError,
    load_rainfall_forcing,
)

_DEFAULT_START = datetime(2026, 7, 1, 0, 0, tzinfo=UTC)


def hourly_timestamps(count: int, start: datetime = _DEFAULT_START) -> list[datetime]:
    return [start + i * EXPECTED_INTERVAL for i in range(count)]


class TestLoadRainfallForcingValid:
    def test_loads_a_valid_hourly_series(self) -> None:
        timestamps = hourly_timestamps(4)
        records = list(zip(timestamps, [0.0, 2.5, 10.0, 1.0], strict=True))

        forcing = load_rainfall_forcing(records, unit=RAINFALL_UNIT)

        assert forcing.timestamps == tuple(timestamps)
        np.testing.assert_array_equal(forcing.rainfall_mm_per_hr, [0.0, 2.5, 10.0, 1.0])

    def test_single_record_series_is_valid(self) -> None:
        forcing = load_rainfall_forcing(
            [(datetime(2026, 7, 1, tzinfo=UTC), 5.0)], unit=RAINFALL_UNIT
        )

        assert len(forcing.timestamps) == 1
        assert forcing.duration == timedelta(0)

    def test_zero_rainfall_is_valid(self) -> None:
        timestamps = hourly_timestamps(3)
        records = list(zip(timestamps, [0.0, 0.0, 0.0], strict=True))

        forcing = load_rainfall_forcing(records, unit=RAINFALL_UNIT)

        np.testing.assert_array_equal(forcing.rainfall_mm_per_hr, [0.0, 0.0, 0.0])

    def test_loading_is_deterministic(self) -> None:
        timestamps = hourly_timestamps(5)
        records = list(zip(timestamps, [1.0, 2.0, 3.0, 4.0, 5.0], strict=True))

        forcing_a = load_rainfall_forcing(records, unit=RAINFALL_UNIT)
        forcing_b = load_rainfall_forcing(records, unit=RAINFALL_UNIT)

        assert forcing_a.timestamps == forcing_b.timestamps
        np.testing.assert_array_equal(forcing_a.rainfall_mm_per_hr, forcing_b.rainfall_mm_per_hr)

    def test_backing_array_is_read_only(self) -> None:
        forcing = load_rainfall_forcing(
            list(zip(hourly_timestamps(2), [1.0, 2.0], strict=True)), unit=RAINFALL_UNIT
        )

        with pytest.raises(ValueError, match="read-only"):
            forcing.rainfall_mm_per_hr[0] = 99.0


class TestLoadRainfallForcingValidation:
    def test_raises_on_empty_records(self) -> None:
        with pytest.raises(RainfallForcingError, match="empty"):
            load_rainfall_forcing([], unit=RAINFALL_UNIT)

    def test_raises_on_unsupported_unit(self) -> None:
        records = list(zip(hourly_timestamps(2), [1.0, 2.0], strict=True))

        with pytest.raises(RainfallForcingError, match="unit"):
            load_rainfall_forcing(records, unit="mm/day")

    def test_does_not_convert_units_it_only_rejects(self) -> None:
        # Explicit negative proof, not just "an error was raised": the
        # function never silently reinterprets a differently-labeled unit.
        records = list(zip(hourly_timestamps(2), [1.0, 2.0], strict=True))

        with pytest.raises(RainfallForcingError):
            load_rainfall_forcing(records, unit="in/hr")

    def test_raises_on_duplicate_timestamps(self) -> None:
        t = datetime(2026, 7, 1, tzinfo=UTC)
        records = [(t, 1.0), (t, 2.0)]

        with pytest.raises(RainfallForcingError, match="Duplicate"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)

    def test_raises_on_missing_timestep(self) -> None:
        t0 = datetime(2026, 7, 1, 0, 0, tzinfo=UTC)
        t2 = t0 + 2 * EXPECTED_INTERVAL  # skips the record at t0 + 1h
        records = [(t0, 1.0), (t2, 2.0)]

        with pytest.raises(RainfallForcingError, match="irregular timestep"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)

    def test_raises_on_out_of_order_timestamps(self) -> None:
        t0 = datetime(2026, 7, 1, 0, 0, tzinfo=UTC)
        records = [(t0 + EXPECTED_INTERVAL, 1.0), (t0, 2.0)]

        with pytest.raises(RainfallForcingError, match="not strictly increasing"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)

    def test_raises_on_negative_rainfall(self) -> None:
        timestamps = hourly_timestamps(3)
        records = list(zip(timestamps, [1.0, -0.5, 2.0], strict=True))

        with pytest.raises(RainfallForcingError, match="negative"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)

    def test_raises_on_malformed_record_wrong_arity(self) -> None:
        records = [(datetime(2026, 7, 1, tzinfo=UTC), 1.0, "extra")]

        with pytest.raises(RainfallForcingError, match="Malformed"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)  # type: ignore[arg-type]

    def test_raises_on_non_datetime_timestamp(self) -> None:
        records = [("2026-07-01", 1.0)]

        with pytest.raises(RainfallForcingError, match="not a datetime"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)  # type: ignore[arg-type]

    def test_raises_on_naive_timestamp(self) -> None:
        records = [(datetime(2026, 7, 1), 1.0)]  # no tzinfo

        with pytest.raises(RainfallForcingError, match="timezone-aware UTC"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)

    def test_raises_on_non_utc_timestamp(self) -> None:
        ist = timezone(timedelta(hours=5, minutes=30))  # India Standard Time, not UTC
        records = [(datetime(2026, 7, 1, tzinfo=ist), 1.0)]

        with pytest.raises(RainfallForcingError, match="timezone-aware UTC"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)

    def test_raises_on_non_numeric_rate(self) -> None:
        records = [(datetime(2026, 7, 1, tzinfo=UTC), "heavy")]

        with pytest.raises(RainfallForcingError, match="not numeric"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)  # type: ignore[arg-type]

    def test_raises_on_boolean_rate(self) -> None:
        # bool is technically an int subclass in Python -- must be
        # explicitly rejected rather than silently accepted as 0.0/1.0.
        records = [(datetime(2026, 7, 1, tzinfo=UTC), True)]

        with pytest.raises(RainfallForcingError, match="not numeric"):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)

    def test_does_not_gap_fill_or_interpolate(self) -> None:
        # Explicit proof of the "reject invalid forcing" discipline: a
        # gap raises rather than being silently filled with an
        # interpolated or zero value.
        t0 = datetime(2026, 7, 1, 0, 0, tzinfo=UTC)
        records = [(t0, 1.0), (t0 + 3 * EXPECTED_INTERVAL, 2.0)]

        with pytest.raises(RainfallForcingError):
            load_rainfall_forcing(records, unit=RAINFALL_UNIT)


class TestRainfallForcingDirectConstruction:
    """RainfallForcing's own __post_init__ validation, independent of the loader."""

    def test_raises_on_mismatched_lengths(self) -> None:
        with pytest.raises(RainfallForcingError, match="same length"):
            RainfallForcing(
                timestamps=tuple(hourly_timestamps(3)),
                rainfall_mm_per_hr=np.array([1.0, 2.0], dtype=np.float64),
            )

    def test_raises_on_empty_timestamps(self) -> None:
        with pytest.raises(RainfallForcingError, match="at least one record"):
            RainfallForcing(timestamps=(), rainfall_mm_per_hr=np.array([], dtype=np.float64))
