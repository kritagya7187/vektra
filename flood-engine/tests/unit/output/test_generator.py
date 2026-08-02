"""Unit tests for flood_engine.output.generator.

Pure NumPy, no I/O. Most tests build a hand-picked, chronologically-ordered
sequence of :class:`TimestepRecord` directly (all public types) rather than
running a real simulation, so ``arrival_time_min``/``duration_above_threshold_min``
can be verified against an exact, hand-computed expectation -- the same
"construct records directly" pattern already used in
``test_controller.py``'s conservation-failure test. One integration-style
test runs a real simulation end-to-end through
:func:`~flood_engine.simulation.controller.run` to confirm the two modules
actually compose.
"""

import numpy as np
import pytest

from flood_engine.core.solver.wca2d import StepResult
from flood_engine.core.state import MassLedger, SolverState
from flood_engine.core.timestepping import TimestepRecord
from flood_engine.output.generator import ARRIVAL_THRESHOLD_M, generate_summary
from flood_engine.simulation.controller import SimulationResult
from flood_engine.simulation.controller import run as run_controller


def _record(elapsed_s: float, dt_used_s: float, depth: list[list[float]]) -> TimestepRecord:
    state = SolverState(water_depth_m=np.array(depth))
    result = StepResult(
        state=state,
        dt_used_s=dt_used_s,
        next_dt_proposed_s=dt_used_s,
        mass_ledger=MassLedger(
            rainfall_input_m3=0.0, infiltration_loss_m3=0.0, boundary_outflow_m3=0.0
        ),
        diagnostic_velocity_mps=np.zeros_like(state.water_depth_m),
    )
    return TimestepRecord(elapsed_s=elapsed_s, result=result)


def _hand_built_result() -> SimulationResult:
    # cell (0,0): never exceeds ARRIVAL_THRESHOLD_M (0.05) -- stays dry throughout.
    # cell (0,1): below at step 0, crosses at step 1, stays above at step 2.
    # cell (1,0): above at step 0 only, then drops back below for good.
    # cell (1,1): above at step 0, drops below at step 1, crosses again at step 2 --
    #             duration must sum both above-threshold steps, arrival_time must
    #             stay pinned to the FIRST crossing, not reset at the second.
    records = (
        _record(10.0, 10.0, [[0.0, 0.02], [0.06, 0.10]]),
        _record(25.0, 15.0, [[0.0, 0.10], [0.03, 0.02]]),
        _record(40.0, 15.0, [[0.0, 0.20], [0.01, 0.09]]),
    )
    ledger = MassLedger(rainfall_input_m3=123.0, infiltration_loss_m3=45.0, boundary_outflow_m3=6.0)
    return SimulationResult(
        final_state=records[-1].result.state,
        timestep_records=records,
        mass_ledger=ledger,
        step_count=len(records),
        simulated_duration_s=records[-1].elapsed_s,
    )


class TestMaxDepth:
    def test_max_depth_is_the_elementwise_maximum_across_all_records(self) -> None:
        summary = generate_summary(_hand_built_result())

        np.testing.assert_allclose(
            summary.max_depth_m, [[0.0, 0.20], [0.06, 0.10]]
        )


class TestArrivalTime:
    def test_never_crossing_cell_is_nan(self) -> None:
        summary = generate_summary(_hand_built_result())

        assert np.isnan(summary.arrival_time_min[0, 0])

    def test_arrival_time_is_the_first_crossing_in_minutes(self) -> None:
        summary = generate_summary(_hand_built_result())

        np.testing.assert_allclose(summary.arrival_time_min[0, 1], 25.0 / 60.0)
        np.testing.assert_allclose(summary.arrival_time_min[1, 0], 10.0 / 60.0)

    def test_arrival_time_stays_pinned_to_the_first_crossing_not_a_later_one(self) -> None:
        # cell (1,1) crosses at step 0 (elapsed=10), drops below at step 1,
        # then crosses AGAIN at step 2 (elapsed=40) -- arrival_time must
        # remain 10/60, not be overwritten by the second crossing.
        summary = generate_summary(_hand_built_result())

        np.testing.assert_allclose(summary.arrival_time_min[1, 1], 10.0 / 60.0)


class TestDurationAboveThreshold:
    def test_duration_sums_only_steps_whose_own_depth_exceeds_the_threshold(self) -> None:
        summary = generate_summary(_hand_built_result())

        expected = [
            [0.0, (15.0 + 15.0) / 60.0],
            [10.0 / 60.0, (10.0 + 15.0) / 60.0],
        ]
        np.testing.assert_allclose(summary.duration_above_threshold_min, expected)


class TestPassThroughMetadata:
    def test_mass_ledger_step_count_and_duration_are_forwarded_unmodified(self) -> None:
        result = _hand_built_result()

        summary = generate_summary(result)

        assert summary.mass_ledger == result.mass_ledger
        assert summary.step_count == result.step_count
        assert summary.simulated_duration_s == result.simulated_duration_s


class TestImmutability:
    def test_output_arrays_are_read_only(self) -> None:
        summary = generate_summary(_hand_built_result())

        with pytest.raises(ValueError, match="read-only"):
            summary.max_depth_m[0, 0] = 999.0
        with pytest.raises(ValueError, match="read-only"):
            summary.arrival_time_min[0, 0] = 999.0
        with pytest.raises(ValueError, match="read-only"):
            summary.duration_above_threshold_min[0, 0] = 999.0

    def test_simulation_result_is_not_modified(self) -> None:
        result = _hand_built_result()
        depth_before = [r.result.state.water_depth_m.copy() for r in result.timestep_records]

        generate_summary(result)

        for record, depth_snapshot in zip(result.timestep_records, depth_before, strict=True):
            np.testing.assert_array_equal(record.result.state.water_depth_m, depth_snapshot)


class TestDeterminism:
    def test_identical_input_produces_identical_output(self) -> None:
        result = _hand_built_result()

        summary_a = generate_summary(result)
        summary_b = generate_summary(result)

        np.testing.assert_array_equal(summary_a.max_depth_m, summary_b.max_depth_m)
        np.testing.assert_array_equal(summary_a.arrival_time_min, summary_b.arrival_time_min)
        np.testing.assert_array_equal(
            summary_a.duration_above_threshold_min, summary_b.duration_above_threshold_min
        )


class TestEndToEndComposition:
    def test_composes_with_a_real_simulation_controller_run(self) -> None:
        shape = (4, 4)
        elevation = np.array(
            [
                [5.0, 4.0, 3.0, 2.0],
                [5.0, 4.0, 3.0, 2.0],
                [5.0, 4.0, 3.0, 2.0],
                [5.0, 4.0, 3.0, 2.0],
            ]
        )
        result = run_controller(
            elevation_m=elevation,
            building_mask=np.zeros(shape, dtype=bool),
            manning_n=np.full(shape, 0.03),
            infiltration_loss_mm_per_hr=np.full(shape, 5.0),
            rainfall_rates_mm_per_hr=np.array([30.0]),
        )

        summary = generate_summary(result)

        assert summary.max_depth_m.shape == shape
        assert summary.arrival_time_min.shape == shape
        assert summary.duration_above_threshold_min.shape == shape
        assert (summary.max_depth_m >= 0.0).all()
        # Any cell whose max depth never exceeded the threshold must show
        # a NaN arrival time and zero duration -- the two fields must
        # agree with each other and with max_depth_m, not just with
        # themselves in isolation.
        never_crossed = summary.max_depth_m <= ARRIVAL_THRESHOLD_M
        assert np.all(np.isnan(summary.arrival_time_min[never_crossed]))
        assert np.all(summary.duration_above_threshold_min[never_crossed] == 0.0)
