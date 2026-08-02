"""Rainfall forcing: the model's first dynamic input, represented and validated.

Implements the NMS's frozen "Dynamic inputs" requirement: "Rainfall:
ERA5-Land hourly precipitation... applied spatially uniform... across the
AOI." **This is deliberately not a raster.** SDS Section 10 states
explicitly that rainfall forcing is "effectively uniform per timestep
across the AOI, not genuinely spatially-varying storm structure" -- so
this module represents it as a single time-indexed sequence of scalar
rates, not a :class:`~flood_engine.io.raster_loader.RasterDataset` or a
stack of grids. Forcing it into the raster contract would add spatial
structure the model explicitly does not have.

**Scope: historical replay only.** SDS Section 5 defines two forcing
modes -- ``historical_replay`` (a real ERA5-Land time series) and
``synthetic_design_storm`` (generated from intensity/duration/pattern
parameters). "Loading" means reading real, already-existing data; a
synthetic storm is not loaded from anywhere, it is constructed from three
scalar parameters -- a different operation, out of scope here, deferred
to wherever the scenario engine (Step 13) is built.

**Loading mechanism, confirmed with the project owner before
implementation, not assumed**: this module operates on an already-parsed,
in-memory sequence of ``(timestamp, rate)`` records, not a file path. No
rainfall file format is frozen anywhere in the NMS/SDS; inventing one now
would be adding an undocumented convention. Reading raw records out of
wherever ERA5-Land data actually lives (the shared PostGIS database, per
the existing meteorological ingestion pipeline) is explicitly out of
scope -- this module performs no database access and no file I/O at all.

Zero flood physics. Zero solver logic. This module represents and
validates forcing; it does not interpret it or simulate its consequences.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

import numpy as np
from numpy.typing import NDArray

RAINFALL_UNIT: Final[str] = "mm/hr"
"""The only accepted rainfall-rate unit.

Matches SDS Section 5's ``synthetic_design_storm.intensity_mm_per_hr``
convention and ERA5-Land's native hourly precipitation-rate semantics.
"""

EXPECTED_INTERVAL: Final[timedelta] = timedelta(hours=1)
"""The frozen native cadence of the ERA5-Land data source -- NOT the solver's timestep.

NMS "Dynamic inputs": "ERA5-Land HOURLY precipitation" -- this is a data
-availability fact about the source, validated here to catch a
malformed/gappy loaded series. It must not be read as implying the WCA2D
solver itself advances in one-hour steps: the NMS's "Stability / timestep"
section is explicit that the solver uses "an adaptive, self-limiting
timestep, recomputed each iteration" and is "not" CFL-like or fixed-step
at all. How this hourly forcing series is applied across the solver's own
much finer adaptive sub-steps (held constant within each hour? interpolated?)
is a Step 11 solver-design question, not resolved by this module -- this
module only guarantees the *source* series itself is well-formed.
"""


class RainfallForcingError(Exception):
    """Raised when rainfall forcing records fail validation.

    A distinct exception type from
    :class:`flood_engine.io.raster_loader.RasterValidationError` --
    rainfall is not a raster, and reusing a raster-named error for a time
    series would be a misleading abstraction, not a saved one. Forcing is
    always rejected outright, never repaired, gap-filled, or interpolated.
    """


@dataclass(frozen=True, slots=True)
class RainfallForcing:
    """A validated, immutable historical rainfall forcing time series.

    Attributes:
        timestamps: Strictly increasing, timezone-aware (UTC) datetimes,
            one per record, at the frozen :data:`EXPECTED_INTERVAL`
            (hourly) cadence.
        rainfall_mm_per_hr: A same-length array of non-negative rainfall
            *rate* values in :data:`RAINFALL_UNIT`. Read-only after
            construction -- same discipline as
            :class:`~flood_engine.io.raster_loader.RasterDataset`'s
            backing array.
    """

    timestamps: tuple[datetime, ...]
    rainfall_mm_per_hr: NDArray[np.float64]

    def __post_init__(self) -> None:
        """Validate structural correctness and freeze the backing array.

        Raises:
            RainfallForcingError: if there are no records, the two
                sequences have mismatched lengths, timestamps are not
                strictly increasing, a timestamp is duplicated, the gap
                between consecutive timestamps is not exactly
                :data:`EXPECTED_INTERVAL`, or any rainfall value is
                negative.
        """
        if len(self.timestamps) == 0:
            raise RainfallForcingError("RainfallForcing must have at least one record.")
        if len(self.timestamps) != len(self.rainfall_mm_per_hr):
            raise RainfallForcingError(
                f"timestamps ({len(self.timestamps)} records) and rainfall_mm_per_hr "
                f"({len(self.rainfall_mm_per_hr)} records) must have the same length."
            )

        for index in range(len(self.timestamps) - 1):
            current, following = self.timestamps[index], self.timestamps[index + 1]
            if following == current:
                raise RainfallForcingError(
                    f"Duplicate timestamp at index {index + 1}: {following!r}."
                )
            if following < current:
                raise RainfallForcingError(
                    f"Timestamps are not strictly increasing at index {index + 1}: "
                    f"{current!r} -> {following!r}."
                )
            gap = following - current
            if gap != EXPECTED_INTERVAL:
                raise RainfallForcingError(
                    f"Missing or irregular timestep between index {index} and {index + 1}: "
                    f"expected a {EXPECTED_INTERVAL} gap (NMS: ERA5-Land hourly), got {gap}."
                )

        if np.any(self.rainfall_mm_per_hr < 0):
            negative_count = int(np.sum(self.rainfall_mm_per_hr < 0))
            raise RainfallForcingError(
                f"{negative_count} rainfall value(s) are negative -- physically impossible."
            )

        self.rainfall_mm_per_hr.flags.writeable = False

    @property
    def duration(self) -> timedelta:
        """The span from the first to the last timestamp (zero for a single-record forcing)."""
        return self.timestamps[-1] - self.timestamps[0]


def load_rainfall_forcing(
    records: Sequence[tuple[datetime, float]],
    *,
    unit: str,
) -> RainfallForcing:
    """Validate and structure raw rainfall records into a :class:`RainfallForcing`.

    Args:
        records: An already-parsed, in-memory sequence of
            ``(timestamp, rainfall_rate)`` pairs. This function performs
            no file or database I/O -- see the module docstring.
        unit: The unit the caller asserts ``records`` are already in.
            Must equal :data:`RAINFALL_UNIT` exactly; this function
            performs no unit conversion.

    Returns:
        A validated, immutable :class:`RainfallForcing`.

    Raises:
        RainfallForcingError: if ``records`` is empty, ``unit`` is not
            :data:`RAINFALL_UNIT`, any record is malformed (wrong arity,
            a non-``datetime`` timestamp, a naive or non-UTC timestamp,
            or a non-numeric rate), or the resulting sequence fails
            :class:`RainfallForcing`'s own structural validation
            (ordering, duplicates, interval regularity, negative values).
    """
    if len(records) == 0:
        raise RainfallForcingError("Cannot load rainfall forcing from an empty record sequence.")

    if unit != RAINFALL_UNIT:
        raise RainfallForcingError(
            f"Unsupported rainfall unit {unit!r} -- only {RAINFALL_UNIT!r} is accepted. "
            "This function does not perform unit conversion."
        )

    for index, record in enumerate(records):
        if len(record) != 2:
            raise RainfallForcingError(
                f"Malformed record at index {index}: expected (timestamp, rate), got {record!r}."
            )
        timestamp, rate = record
        if not isinstance(timestamp, datetime):
            raise RainfallForcingError(
                f"Malformed record at index {index}: timestamp is not a datetime: {timestamp!r}."
            )
        if timestamp.tzinfo is None or timestamp.utcoffset() != timedelta(0):
            raise RainfallForcingError(
                f"Malformed record at index {index}: timestamp {timestamp!r} is not "
                "timezone-aware UTC. ERA5-Land is UTC-referenced; this function does "
                "not infer or convert timezones."
            )
        if isinstance(rate, bool) or not isinstance(rate, int | float):
            raise RainfallForcingError(
                f"Malformed record at index {index}: rainfall rate is not numeric: {rate!r}."
            )

    timestamps = tuple(record[0] for record in records)
    rates = np.array([float(record[1]) for record in records], dtype=np.float64)

    return RainfallForcing(timestamps=timestamps, rainfall_mm_per_hr=rates)


__all__ = [
    "EXPECTED_INTERVAL",
    "RAINFALL_UNIT",
    "RainfallForcing",
    "RainfallForcingError",
    "load_rainfall_forcing",
]
