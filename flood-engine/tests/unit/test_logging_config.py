"""Unit tests for flood_engine.logging_config.

Verifies the three guarantees the module docstring commits to: closed
subsystem set, run-id traceability that is safe under concurrency, and
that array content can never leak into a log record. No database,
filesystem, or running service is touched.
"""

import asyncio
import json
import logging
from collections.abc import Iterator

import numpy as np
import pytest

from flood_engine.config import LoggingConfig
from flood_engine.logging_config import (
    JsonFormatter,
    LogSubsystem,
    SimulationLifecycleEvent,
    _current_run_id,
    _RunIdFilter,
    configure_logging,
    get_logger,
    log_duration,
    run_context,
    summarize_array,
)


class _CapturingHandler(logging.Handler):
    """Appends every emitted record to a list, bypassing caplog/propagation entirely."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture(autouse=True)
def _reset_flood_engine_logger() -> Iterator[None]:
    """Restore the flood_engine root logger's state after each test.

    configure_logging() mutates global logging.Logger state (handlers,
    level, propagate) -- without this, one test's call would leak
    configuration into every later test regardless of execution order.
    """
    logger = logging.getLogger("flood_engine")
    original_handlers = list(logger.handlers)
    original_level = logger.level
    original_propagate = logger.propagate
    yield
    logger.handlers = original_handlers
    logger.setLevel(original_level)
    logger.propagate = original_propagate


class TestLogSubsystem:
    """The subsystem set must be exactly the eight named categories -- no more, no fewer."""

    def test_is_exactly_the_eight_named_categories(self) -> None:
        assert {member.value for member in LogSubsystem} == {
            "application",
            "infrastructure",
            "database",
            "raster_io",
            "simulation",
            "api",
            "validation",
            "performance",
        }


class TestSimulationLifecycleEvent:
    """A frozen vocabulary, not yet consumed by any built step.

    This pins the values themselves.
    """

    def test_is_exactly_the_six_named_transitions(self) -> None:
        assert {member.value for member in SimulationLifecycleEvent} == {
            "simulation.created",
            "simulation.started",
            "simulation.step",
            "simulation.completed",
            "simulation.failed",
            "simulation.cancelled",
        }


class TestGetLogger:
    def test_names_logger_under_flood_engine_and_subsystem(self) -> None:
        logger = get_logger(LogSubsystem.DATABASE)

        assert logger.name == "flood_engine.database"

    def test_appends_optional_name_without_creating_a_new_subsystem(self) -> None:
        logger = get_logger(LogSubsystem.RASTER_IO, "dem_loader")

        assert logger.name == "flood_engine.raster_io.dem_loader"


class TestRunContext:
    def test_binds_and_clears_run_id(self) -> None:
        assert _current_run_id.get() is None

        with run_context("run-123"):
            assert _current_run_id.get() == "run-123"

        assert _current_run_id.get() is None

    def test_restores_previous_value_after_nested_context(self) -> None:
        with run_context("outer-run"):
            with run_context("inner-run"):
                assert _current_run_id.get() == "inner-run"
            assert _current_run_id.get() == "outer-run"

    def test_clears_even_when_the_block_raises(self) -> None:
        with pytest.raises(ValueError, match="boom"), run_context("run-that-fails"):
            raise ValueError("boom")

        assert _current_run_id.get() is None

    def test_isolated_across_concurrent_async_tasks(self) -> None:
        # This is the real justification for ContextVar over a plain
        # module-level variable: two "runs" executing concurrently must
        # never see each other's id, even when one task suspends
        # (await asyncio.sleep) while the other resumes and completes.
        observed: dict[str, str | None] = {}

        async def _worker(run_id: str, delay: float) -> None:
            with run_context(run_id):
                await asyncio.sleep(delay)
                observed[run_id] = _current_run_id.get()

        async def _main() -> None:
            await asyncio.gather(_worker("run-a", 0.02), _worker("run-b", 0.0))

        asyncio.run(_main())

        assert observed == {"run-a": "run-a", "run-b": "run-b"}


class TestRunIdFilter:
    def test_attaches_bound_run_id_to_record(self) -> None:
        record = logging.makeLogRecord({"msg": "hello"})
        filter_ = _RunIdFilter()

        with run_context("run-456"):
            result = filter_.filter(record)

        assert result is True
        assert record.run_id == "run-456"  # type: ignore[attr-defined]

    def test_attaches_none_when_no_run_is_bound(self) -> None:
        record = logging.makeLogRecord({"msg": "hello"})
        filter_ = _RunIdFilter()

        filter_.filter(record)

        assert record.run_id is None  # type: ignore[attr-defined]


class TestJsonFormatter:
    def _make_record(self, **extra: object) -> logging.LogRecord:
        record = logging.getLogger("flood_engine.api.routers").makeRecord(
            name="flood_engine.api.routers",
            level=logging.INFO,
            fn="test",
            lno=1,
            msg="scenario created",
            args=(),
            exc_info=None,
            extra=extra or None,
        )
        return record

    def test_produces_valid_json_with_expected_fields(self) -> None:
        record = self._make_record()

        line = JsonFormatter().format(record)
        payload = json.loads(line)

        assert payload["level"] == "INFO"
        assert payload["logger"] == "flood_engine.api.routers"
        assert payload["subsystem"] == "api"
        assert payload["message"] == "scenario created"
        assert "timestamp" in payload

    def test_omits_run_id_when_not_bound(self) -> None:
        record = self._make_record()
        _RunIdFilter().filter(record)

        payload = json.loads(JsonFormatter().format(record))

        assert "run_id" not in payload

    def test_includes_run_id_when_bound(self) -> None:
        record = self._make_record()
        with run_context("run-789"):
            _RunIdFilter().filter(record)

        payload = json.loads(JsonFormatter().format(record))

        assert payload["run_id"] == "run-789"

    def test_merges_extra_fields(self) -> None:
        record = self._make_record(elapsed_seconds=1.234, scenario_id="abc")

        payload = json.loads(JsonFormatter().format(record))

        assert payload["elapsed_seconds"] == 1.234
        assert payload["scenario_id"] == "abc"

    def test_includes_formatted_exception_when_present(self) -> None:
        try:
            raise ValueError("solver diverged")
        except ValueError:
            import sys

            record = self._make_record()
            record.exc_info = sys.exc_info()

        payload = json.loads(JsonFormatter().format(record))

        assert "exc_info" in payload
        assert "ValueError: solver diverged" in payload["exc_info"]

    def test_non_flood_engine_logger_name_passes_through_as_subsystem(self) -> None:
        record = logging.getLogger("uvicorn.error").makeRecord(
            name="uvicorn.error",
            level=logging.WARNING,
            fn="test",
            lno=1,
            msg="third-party log line",
            args=(),
            exc_info=None,
        )

        payload = json.loads(JsonFormatter().format(record))

        assert payload["subsystem"] == "uvicorn.error"


class TestConfigureLogging:
    def test_sets_level_from_config(self) -> None:
        configure_logging(LoggingConfig(log_level="warning"))

        assert logging.getLogger("flood_engine").level == logging.WARNING

    def test_attaches_exactly_one_json_handler(self) -> None:
        configure_logging(LoggingConfig())

        handlers = logging.getLogger("flood_engine").handlers
        assert len(handlers) == 1
        assert isinstance(handlers[0].formatter, JsonFormatter)

    def test_repeated_calls_do_not_accumulate_handlers(self) -> None:
        configure_logging(LoggingConfig())
        configure_logging(LoggingConfig())
        configure_logging(LoggingConfig())

        assert len(logging.getLogger("flood_engine").handlers) == 1

    def test_disables_propagation_to_avoid_duplicate_output(self) -> None:
        configure_logging(LoggingConfig())

        assert logging.getLogger("flood_engine").propagate is False


class TestSummarizeArray:
    def test_returns_shape_dtype_and_statistics(self) -> None:
        array = np.array([[1.0, 2.0], [3.0, 4.0]])

        summary = summarize_array(array)

        assert summary["shape"] == (2, 2)
        assert summary["dtype"] == "float64"
        assert summary["min"] == 1.0
        assert summary["max"] == 4.0
        assert summary["mean"] == 2.5
        assert summary["nan_count"] == 0

    def test_excludes_nan_from_min_max_mean_but_counts_it(self) -> None:
        array = np.array([1.0, np.nan, 3.0])

        summary = summarize_array(array)

        assert summary["nan_count"] == 1
        assert summary["min"] == 1.0
        assert summary["max"] == 3.0
        assert summary["mean"] == 2.0

    def test_all_nan_array_omits_min_max_mean_rather_than_crashing(self) -> None:
        # A fully no-data grid is a real possibility (e.g. a run whose AOI
        # has no computable cells yet) -- must not raise on an empty
        # finite-value slice.
        array = np.array([np.nan, np.nan, np.nan])

        summary = summarize_array(array)

        assert summary["nan_count"] == 3
        assert "min" not in summary
        assert "max" not in summary
        assert "mean" not in summary

    def test_integer_array_has_zero_nan_count_and_no_crash(self) -> None:
        array = np.array([1, 2, 3], dtype=np.int32)

        summary = summarize_array(array)

        assert summary["nan_count"] == 0
        assert summary["min"] == 1

    def test_label_included_when_provided(self) -> None:
        summary = summarize_array(np.array([1.0]), label="water_depth_m")

        assert summary["label"] == "water_depth_m"

    def test_never_includes_the_raw_array_or_any_array_valued_field(self) -> None:
        # The enforcement test for the module's central guarantee: no key
        # in the returned summary may itself be an ndarray, and the
        # serialized form must not balloon with per-cell values.
        large_array = np.random.default_rng(seed=0).random((100, 100))

        summary = summarize_array(large_array, label="synthetic_grid")

        assert all(not isinstance(value, np.ndarray) for value in summary.values())
        assert len(json.dumps(summary, default=str)) < 500


class TestLogDuration:
    def test_logs_elapsed_seconds_as_a_structured_field(self) -> None:
        logger = get_logger(LogSubsystem.PERFORMANCE, "test_log_duration")
        logger.setLevel(logging.INFO)
        handler = _CapturingHandler()
        logger.addHandler(handler)
        try:
            with log_duration(logger, "solver step completed", cell_count=900):
                pass
        finally:
            logger.removeHandler(handler)

        assert len(handler.records) == 1
        record = handler.records[0]
        assert record.getMessage() == "solver step completed"
        assert record.elapsed_seconds >= 0.0  # type: ignore[attr-defined]
        assert record.cell_count == 900  # type: ignore[attr-defined]

    def test_logs_duration_even_when_the_block_raises(self) -> None:
        logger = get_logger(LogSubsystem.PERFORMANCE, "test_log_duration_error")
        logger.setLevel(logging.INFO)
        handler = _CapturingHandler()
        logger.addHandler(handler)
        try:
            with pytest.raises(ValueError, match="boom"):
                with log_duration(logger, "solver step failed"):
                    raise ValueError("boom")
        finally:
            logger.removeHandler(handler)

        assert len(handler.records) == 1
