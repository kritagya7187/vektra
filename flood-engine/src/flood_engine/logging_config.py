"""Structured, subsystem-scoped logging for flood-engine.

Three guarantees this module exists to provide, all enforced in code
rather than left as convention:

1. Every log record belongs to exactly one of a closed, enumerated set of
   subsystems (:class:`LogSubsystem`) -- application, infrastructure,
   database, raster I/O, simulation, API, validation, performance. Adding
   a ninth requires an explicit, reviewed change to this module, not an
   ad-hoc ``logging.getLogger(__name__)`` call anywhere in the codebase.
2. A simulation run is traceable end-to-end -- ingestion through
   completion -- via a ``run_id`` that is bound once (:func:`run_context`)
   and then automatically attached to every log record emitted within
   that context, including from code that has no idea a run is in
   progress. This uses a :class:`contextvars.ContextVar`, not a plain
   module-level variable, so it stays correct when multiple runs execute
   concurrently under FastAPI's async request handling or Step 16's job
   queue -- a global variable would leak one run's id into another's logs.
3. Scientific array content is never logged directly.
   :func:`summarize_array` is the *only* sanctioned way to reference a
   NumPy array's content in a log message anywhere in this codebase --
   never ``logger.info(f"...{array}...")``. A full water-depth timestep
   grid can be hundreds of thousands of cells; logging it raw is both a
   log-volume problem and produces nothing a human can act on. Summary
   statistics (shape, dtype, min/max/mean, NaN count) are logged instead.

Output is one JSON object per line (:class:`JsonFormatter`) -- not a new
dependency, just a ``logging.Formatter`` subclass -- so ``run_id`` and
``subsystem`` are queryable/filterable fields rather than substrings to
grep for in prose, which is what "without ... creating excessive log
volume" means in practice: compact, structured records over verbose text.
"""

import json
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from numpy.typing import NDArray

    from flood_engine.config import LoggingConfig

_ROOT_LOGGER_NAME = "flood_engine"


class LogSubsystem(StrEnum):
    """The closed set of logging categories every log record belongs to.

    Deliberately a fixed enum, not free-form per-module logger names --
    this is what makes "every log record belongs to one subsystem" an
    enforced property instead of a convention that drifts over time.
    """

    APPLICATION = "application"
    INFRASTRUCTURE = "infrastructure"
    DATABASE = "database"
    RASTER_IO = "raster_io"
    SIMULATION = "simulation"
    API = "api"
    VALIDATION = "validation"
    PERFORMANCE = "performance"


class SimulationLifecycleEvent(StrEnum):
    """The canonical vocabulary for a flood_simulation_run's lifecycle.

    Not tied to any single subsystem -- the same run passes through the
    API (creation), the job queue (Step 16), the simulation controller
    (Step 13), and persistence (Step 17), and every layer should log the
    same event name for the same transition rather than each inventing
    its own phrasing ("run started" vs. "beginning execution" vs.
    "Executing"). Nothing consumes this enum yet -- Steps 13/15/16/17
    don't exist -- it is declared now, alongside LogSubsystem, so those
    steps have one frozen vocabulary to log against from the start rather
    than retrofitting consistency later.
    """

    CREATED = "simulation.created"
    STARTED = "simulation.started"
    STEP = "simulation.step"
    COMPLETED = "simulation.completed"
    FAILED = "simulation.failed"
    CANCELLED = "simulation.cancelled"


def get_logger(subsystem: LogSubsystem, name: str | None = None) -> logging.Logger:
    """Return the logger for a given subsystem, optionally with a sub-name.

    Args:
        subsystem: The closed-set category this logger's records belong to.
        name: Optional finer-grained name (e.g. a module or component name)
            nested under the subsystem, for readability in log output --
            it does not create a new subsystem.

    Returns:
        A standard-library ``Logger``, named ``flood_engine.<subsystem>``
        or ``flood_engine.<subsystem>.<name>``.
    """
    logger_name = f"{_ROOT_LOGGER_NAME}.{subsystem.value}"
    if name is not None:
        logger_name = f"{logger_name}.{name}"
    return logging.getLogger(logger_name)


_current_run_id: ContextVar[str | None] = ContextVar("flood_engine_run_id", default=None)


@contextmanager
def run_context(run_id: str) -> Iterator[None]:
    """Bind a simulation run id to every log record emitted within this block.

    Every module in the eventual ingestion -> preprocessing -> solver ->
    output -> validation pipeline (Steps 6-17) should wrap its
    per-run work in this context once, at the point a ``flood_simulation_run``
    id becomes known -- not thread through a ``run_id`` parameter to every
    function. Uses a ``ContextVar`` so concurrent runs (multiple FastAPI
    requests, multiple queued jobs) never see each other's id.

    Args:
        run_id: The ``flood_simulation_run`` identifier (SDS Section 7) to
            attach to every log record emitted while this context is active.

    Yields:
        None.
    """
    token = _current_run_id.set(run_id)
    try:
        yield
    finally:
        _current_run_id.reset(token)


class _RunIdFilter(logging.Filter):
    """Attaches the currently-bound run id (if any) to every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Set ``record.run_id`` from the active context and always pass the record through.

        Args:
            record: The log record being processed.

        Returns:
            Always ``True`` -- this filter enriches records, it never
            suppresses one.
        """
        record.run_id = _current_run_id.get()
        return True


_RESERVED_RECORD_ATTRS = frozenset(vars(logging.makeLogRecord({})).keys()) | {
    "message",
    "asctime",
    "run_id",
}


class JsonFormatter(logging.Formatter):
    """Formats each log record as one JSON object per line.

    Fixed fields: ``timestamp``, ``level``, ``subsystem`` (parsed from the
    logger name), ``logger``, ``message``, and ``run_id`` when bound.
    Anything passed via ``extra={...}`` on the log call is merged in as
    additional fields -- this is how :func:`log_duration`'s
    ``elapsed_seconds`` and :func:`summarize_array`'s statistics reach the
    output without a bespoke formatter per subsystem.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Render one log record as a single-line JSON string.

        Args:
            record: The log record to format.

        Returns:
            A JSON-encoded string, non-JSON-serializable values coerced
            via ``str()`` rather than raising.
        """
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "subsystem": self._subsystem_from_logger_name(record.name),
            "message": record.getMessage(),
        }

        run_id = getattr(record, "run_id", None)
        if run_id is not None:
            payload["run_id"] = run_id

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        for key, value in vars(record).items():
            if key in _RESERVED_RECORD_ATTRS:
                continue
            payload[key] = value

        return json.dumps(payload, default=str)

    @staticmethod
    def _subsystem_from_logger_name(logger_name: str) -> str:
        prefix = f"{_ROOT_LOGGER_NAME}."
        if not logger_name.startswith(prefix):
            return logger_name
        return logger_name.removeprefix(prefix).split(".", maxsplit=1)[0]


def configure_logging(config: LoggingConfig) -> None:
    """Configure the root ``flood_engine`` logger from deployment configuration.

    Called once at process startup (mirrors the "load once, inject,
    read-only" pattern already applied to :func:`flood_engine.config.load_config`)
    -- not re-invoked per request or per run. Attaches one
    ``StreamHandler`` with :class:`JsonFormatter` and the run-id filter,
    and disables propagation to the stdlib root logger so output is never
    duplicated.

    Args:
        config: The validated :class:`flood_engine.config.LoggingConfig`.
    """
    root = logging.getLogger(_ROOT_LOGGER_NAME)
    root.setLevel(config.log_level.upper())
    root.handlers.clear()

    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler.addFilter(_RunIdFilter())

    root.addHandler(handler)
    root.propagate = False


def summarize_array(array: NDArray[Any], *, label: str | None = None) -> dict[str, Any]:
    """Produce a safe-to-log summary of a NumPy array -- shape and statistics only.

    This is the only sanctioned way to reference array content in a log
    message anywhere in this codebase. See the module docstring.

    Args:
        array: The array to summarize (e.g. a water-depth grid).
        label: Optional human-readable label to include in the summary
            (e.g. "water_depth_m" or "max_depth_summary_raster").

    Returns:
        A dict of ``shape``, ``dtype``, ``nan_count``, and -- when the
        array contains at least one finite value -- ``min``/``max``/``mean``.
        Never the array's raw values.
    """
    import numpy as np

    summary: dict[str, Any] = {
        "shape": array.shape,
        "dtype": str(array.dtype),
        "nan_count": int(np.isnan(array).sum()) if np.issubdtype(array.dtype, np.floating) else 0,
    }
    finite = array[np.isfinite(array)] if np.issubdtype(array.dtype, np.floating) else array
    if finite.size > 0:
        summary["min"] = float(finite.min())
        summary["max"] = float(finite.max())
        summary["mean"] = float(finite.mean())
    if label is not None:
        summary["label"] = label
    return summary


@contextmanager
def log_duration(logger: logging.Logger, message: str, **extra: object) -> Iterator[None]:
    """Time a block and log its elapsed duration when it completes.

    Standardizes the timing/logging shape the Experiment Plan's item 6
    (runtime/performance benchmark) needs, rather than ad-hoc
    ``time.time()`` calls scattered through the codebase. Callers should
    pass a logger obtained via ``get_logger(LogSubsystem.PERFORMANCE, ...)``
    -- this helper does not choose the subsystem itself.

    Args:
        logger: The logger to record the duration on.
        message: The log message.
        **extra: Additional structured fields merged into the log record.

    Yields:
        None.
    """
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_seconds = time.perf_counter() - start
        logger.info(message, extra={"elapsed_seconds": round(elapsed_seconds, 6), **extra})
