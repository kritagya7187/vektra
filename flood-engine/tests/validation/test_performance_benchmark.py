"""Step 18, Part E: performance benchmark.

Measures runtime, peak memory, cells/sec, and timesteps/sec at
100x100, 250x250, 500x500, and 1000x1000 grid sizes -- reports numbers,
does not optimize anything. Per the prompt's own instruction ("If
performance bottlenecks are discovered, document them without changing
the implementation"), any finding here is recorded in ``VALIDATION.md``
(Part H), never acted on by editing the frozen solver.

The 500x500 and 1000x1000 sizes take real wall-clock minutes (single-run
measurements on one dev machine, not controlled multi-run statistics --
consistent with "only measure", not a claim of benchmark-grade rigor).
They are skipped by default so the ordinary ``pytest`` run stays fast;
set ``FLOOD_ENGINE_RUN_BENCHMARKS=1`` to run the full suite. 100x100 and
250x250 always run (a few seconds each) as a standing regression guard
against a catastrophic performance break, using a generously loose floor
-- not a tight pin, since wall-clock timing is inherently machine- and
load-dependent.
"""

import os
import time
import tracemalloc
from dataclasses import dataclass

import numpy as np
import pytest

from flood_engine.core.solver.infiltration import (
    IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR,
    PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
)
from flood_engine.core.solver.roughness import (
    BARE_SPARSE_VEGETATION,
    BUILDING_MANNING_N_PLACEHOLDER,
    MANNING_N_BY_LANDCOVER_CLASS,
)
from flood_engine.simulation.controller import run as run_simulation
from tests.factories import hill_dem, no_buildings

_RUN_SLOW_BENCHMARKS = os.environ.get("FLOOD_ENGINE_RUN_BENCHMARKS") == "1"
_SKIP_SLOW_REASON = (
    "Slow benchmark (500x500/1000x1000 take real wall-clock minutes) -- "
    "set FLOOD_ENGINE_RUN_BENCHMARKS=1 to include it."
)


@dataclass(frozen=True, slots=True)
class BenchmarkResult:
    shape: tuple[int, int]
    cells: int
    step_count: int
    elapsed_s: float
    peak_memory_mb: float

    @property
    def cells_per_sec(self) -> float:
        return self.cells * self.step_count / self.elapsed_s

    @property
    def steps_per_sec(self) -> float:
        return self.step_count / self.elapsed_s


def _run_benchmark(shape: tuple[int, int]) -> BenchmarkResult:
    """Runs one real simulation at ``shape`` and measures it -- no shortcut, the real solver."""
    dem = hill_dem(shape, base_elevation_m=10.0, peak_height_m=3.0)
    mask = no_buildings(shape)
    pervious_n = MANNING_N_BY_LANDCOVER_CLASS[BARE_SPARSE_VEGETATION]
    manning_n = np.where(mask, BUILDING_MANNING_N_PLACEHOLDER, pervious_n)
    infiltration = np.where(
        mask, IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR, PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR
    )
    rainfall = np.array([20.0])

    tracemalloc.start()
    start = time.perf_counter()
    result = run_simulation(
        elevation_m=dem.data,
        building_mask=mask,
        manning_n=manning_n,
        infiltration_loss_mm_per_hr=infiltration,
        rainfall_rates_mm_per_hr=rainfall,
    )
    elapsed_s = time.perf_counter() - start
    _current, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    return BenchmarkResult(
        shape=shape,
        cells=shape[0] * shape[1],
        step_count=result.step_count,
        elapsed_s=elapsed_s,
        peak_memory_mb=peak_bytes / 1e6,
    )


def _report(benchmark: BenchmarkResult) -> None:
    print(
        f"\n[benchmark] shape={benchmark.shape} cells={benchmark.cells} "
        f"steps={benchmark.step_count} elapsed_s={benchmark.elapsed_s:.3f} "
        f"cells_per_sec={benchmark.cells_per_sec:.0f} "
        f"steps_per_sec={benchmark.steps_per_sec:.2f} "
        f"peak_memory_mb={benchmark.peak_memory_mb:.2f}"
    )


class TestPerformanceBenchmark:
    """Real, actually-measured results (captured once, recorded in VALIDATION.md):

    | Grid size | Cells | Steps | Elapsed (s) | Cells/sec | Steps/sec | Peak memory (MB) |
    |---|---|---|---|---|---|---|
    | 100x100 | 10,000 | 300 | 0.903 | 3,322,721 | 332.27 | 51.62 |
    | 250x250 | 62,500 | 301 | 4.060 | 4,634,176 | 74.15 | 322.36 |
    | 500x500 | 250,000 | 300 | 30.350 | 2,471,172 | 9.88 | 1284.72 |
    | 1000x1000 | 1,000,000 | 300 | 130.772 | 2,294,070 | 2.29 | 5138.26 |

    Runtime does not scale linearly with cell count (100->250 is ~4.5x
    slower for 6.25x the cells; 250->500 is ~7.5x slower for 4x the
    cells; 500->1000 is ~4.3x slower for 4x the cells) -- a real,
    observed, undocumented-until-now performance characteristic, noted
    in VALIDATION.md rather than investigated/changed here, per this
    Part's own "document, do not optimize" instruction.
    """

    def test_100x100_completes_and_reports(self) -> None:
        benchmark = _run_benchmark((100, 100))
        _report(benchmark)

        assert benchmark.elapsed_s > 0.0
        assert benchmark.step_count > 0
        # A generously loose floor (real measurement: ~3.3M cells/sec) --
        # this is a catastrophic-regression guard, not a performance pin.
        assert benchmark.cells_per_sec > 100_000.0

    def test_250x250_completes_and_reports(self) -> None:
        benchmark = _run_benchmark((250, 250))
        _report(benchmark)

        assert benchmark.elapsed_s > 0.0
        assert benchmark.step_count > 0
        assert benchmark.cells_per_sec > 100_000.0

    @pytest.mark.skipif(not _RUN_SLOW_BENCHMARKS, reason=_SKIP_SLOW_REASON)
    def test_500x500_completes_and_reports(self) -> None:
        benchmark = _run_benchmark((500, 500))
        _report(benchmark)

        assert benchmark.elapsed_s > 0.0
        assert benchmark.step_count > 0
        assert benchmark.cells_per_sec > 50_000.0

    @pytest.mark.skipif(not _RUN_SLOW_BENCHMARKS, reason=_SKIP_SLOW_REASON)
    def test_1000x1000_completes_and_reports(self) -> None:
        benchmark = _run_benchmark((1000, 1000))
        _report(benchmark)

        assert benchmark.elapsed_s > 0.0
        assert benchmark.step_count > 0
        assert benchmark.cells_per_sec > 50_000.0
