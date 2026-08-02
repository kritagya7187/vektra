"""Unit tests for flood_engine.simulation.controller.

Pure NumPy, no I/O. Tests only the public contract (:func:`run`,
:class:`SimulationResult`) -- consistent with this project's established
convention of never importing underscore-prefixed helpers directly. One
test mocks :func:`~flood_engine.core.timestepping.run_simulation` to
exercise the mass-conservation-failure path in isolation: the real solver
conserves mass by construction (verified exhaustively in
``test_wca2d.py``/``test_timestepping.py``), so triggering this module's
own guard requires injecting a deliberately-corrupted step sequence rather
than a real physical scenario.
"""

from unittest.mock import patch

import numpy as np
import pytest

from flood_engine.core.solver.wca2d import SolverParameters, StepResult, WCA2DError
from flood_engine.core.state import MassLedger, SolverState
from flood_engine.core.timestepping import TimesteppingError, TimestepRecord
from flood_engine.simulation.controller import (
    MASS_CONSERVATION_RTOL,
    SimulationControllerError,
    run,
)


def _flat_inputs(shape: tuple[int, int] = (3, 3)) -> dict:
    return {
        "elevation_m": np.full(shape, 5.0),
        "building_mask": np.zeros(shape, dtype=bool),
        "manning_n": np.full(shape, 0.03),
        "infiltration_loss_mm_per_hr": np.zeros(shape),
        "rainfall_rates_mm_per_hr": np.array([0.0]),
    }


class TestDryInitialCondition:
    def test_a_dry_no_rain_run_produces_no_change_and_a_zero_ledger(self) -> None:
        result = run(**_flat_inputs())

        np.testing.assert_array_equal(result.final_state.water_depth_m, np.zeros((3, 3)))
        assert result.mass_ledger.rainfall_input_m3 == 0.0
        assert result.mass_ledger.infiltration_loss_m3 == 0.0
        assert result.mass_ledger.boundary_outflow_m3 == 0.0


class TestSimulationResultContents:
    def test_step_count_and_duration_match_the_underlying_records(self) -> None:
        params = SolverParameters(time_maxdt_s=1800.0)

        result = run(**_flat_inputs(), solver_parameters=params)

        assert result.step_count == len(result.timestep_records)
        assert result.simulated_duration_s == result.timestep_records[-1].elapsed_s

    def test_final_state_matches_the_last_records_state(self) -> None:
        result = run(**_flat_inputs())

        np.testing.assert_array_equal(
            result.final_state.water_depth_m,
            result.timestep_records[-1].result.state.water_depth_m,
        )


class TestMassConservation:
    def test_identity_holds_for_a_representative_run(self) -> None:
        shape = (4, 4)
        elevation = np.array(
            [
                [5.0, 4.0, 3.0, 2.0],
                [5.0, 4.0, 3.0, 2.0],
                [5.0, 4.0, 3.0, 2.0],
                [5.0, 4.0, 3.0, 2.0],
            ]
        )
        result = run(
            elevation_m=elevation,
            building_mask=np.zeros(shape, dtype=bool),
            manning_n=np.full(shape, 0.03),
            infiltration_loss_mm_per_hr=np.full(shape, 5.0),
            rainfall_rates_mm_per_hr=np.array([20.0, 10.0]),
        )

        cell_area_m2 = 30.0 * 30.0
        final_storage_m3 = float((result.final_state.water_depth_m * cell_area_m2).sum())
        expected_final_storage_m3 = (
            result.mass_ledger.rainfall_input_m3
            - result.mass_ledger.boundary_outflow_m3
            - result.mass_ledger.infiltration_loss_m3
        )
        assert final_storage_m3 == pytest.approx(expected_final_storage_m3, abs=1e-6)

    def test_identity_holds_across_randomized_multi_step_runs(self) -> None:
        """Empirically establishes the real achieved error, same discipline as Step 11.

        ``MASS_CONSERVATION_RTOL`` (1e-9) is looser than the single-step
        1e-12 bound precisely to account for accumulation across many
        steps -- this test measures the actual worst-case relative error
        across 50 randomized multi-step runs to confirm 1e-9 is a real,
        evidenced bound rather than an assumed one.
        """
        rng = np.random.default_rng(seed=7)
        worst_relative_error = 0.0
        cell_area_m2 = 30.0 * 30.0

        for _ in range(50):
            size = int(rng.integers(3, 6))
            shape = (size, size)
            elevation = rng.uniform(0.0, 10.0, size=shape)
            building_mask = rng.random(shape) < 0.1
            manning_n = rng.uniform(0.01, 0.15, size=shape)
            infiltration = rng.uniform(0.0, 20.0, size=shape)
            rainfall_rates = rng.uniform(0.0, 50.0, size=int(rng.integers(1, 4)))

            result = run(
                elevation_m=elevation,
                building_mask=building_mask,
                manning_n=manning_n,
                infiltration_loss_mm_per_hr=infiltration,
                rainfall_rates_mm_per_hr=rainfall_rates,
            )

            final_storage_m3 = float((result.final_state.water_depth_m * cell_area_m2).sum())
            expected_final_storage_m3 = (
                result.mass_ledger.rainfall_input_m3
                - result.mass_ledger.boundary_outflow_m3
                - result.mass_ledger.infiltration_loss_m3
            )
            # Normalized by the mass budget's own scale, matching
            # controller.py's own check -- final storage legitimately
            # approaches zero for a full run (recession tail drains most
            # water out), so normalizing by final_storage_m3 alone would
            # spuriously amplify ordinary floating-point noise.
            scale_m3 = max(
                abs(final_storage_m3),
                abs(result.mass_ledger.rainfall_input_m3),
                abs(result.mass_ledger.boundary_outflow_m3),
                abs(result.mass_ledger.infiltration_loss_m3),
                1e-12,
            )
            relative_error = abs(final_storage_m3 - expected_final_storage_m3) / scale_m3
            worst_relative_error = max(worst_relative_error, relative_error)

        assert worst_relative_error < MASS_CONSERVATION_RTOL, (
            f"Worst observed relative error {worst_relative_error:.3e} exceeds "
            f"MASS_CONSERVATION_RTOL={MASS_CONSERVATION_RTOL:.3e}."
        )

    def test_raises_when_the_conservation_identity_is_violated(self) -> None:
        # The real solver conserves mass by construction -- to exercise
        # this module's own guard, a corrupted step sequence is injected
        # directly rather than attempting to provoke a real physical
        # violation (which the frozen solver does not permit).
        shape = (2, 2)
        corrupted_state = SolverState(water_depth_m=np.full(shape, 10.0))
        fake_result = StepResult(
            state=corrupted_state,
            dt_used_s=1.0,
            next_dt_proposed_s=1.0,
            mass_ledger=MassLedger(
                rainfall_input_m3=0.0, infiltration_loss_m3=0.0, boundary_outflow_m3=0.0
            ),
            diagnostic_velocity_mps=np.zeros(shape),
        )
        fake_records = (TimestepRecord(elapsed_s=1.0, result=fake_result),)

        with patch(
            "flood_engine.simulation.controller.run_simulation", return_value=fake_records
        ):
            with pytest.raises(SimulationControllerError, match="mass conservation"):
                run(**_flat_inputs(shape))


class TestErrorPropagation:
    def test_shape_mismatch_propagates_the_solvers_own_error(self) -> None:
        inputs = _flat_inputs()
        inputs["building_mask"] = np.zeros((2, 2), dtype=bool)

        with pytest.raises(WCA2DError, match="building_mask"):
            run(**inputs)

    def test_empty_rainfall_propagates_the_timesteppers_own_error(self) -> None:
        inputs = _flat_inputs()
        inputs["rainfall_rates_mm_per_hr"] = np.array([])

        with pytest.raises(TimesteppingError, match="rainfall_rates_mm_per_hr"):
            run(**inputs)


class TestDeterminism:
    def test_identical_inputs_produce_identical_output(self) -> None:
        inputs = _flat_inputs()
        inputs["elevation_m"] = np.array(
            [[3.0, 2.0, 1.0], [3.0, 2.0, 1.0], [3.0, 2.0, 1.0]]
        )
        inputs["rainfall_rates_mm_per_hr"] = np.array([10.0])

        result_a = run(**inputs)
        result_b = run(**inputs)

        np.testing.assert_array_equal(
            result_a.final_state.water_depth_m, result_b.final_state.water_depth_m
        )
        assert result_a.mass_ledger == result_b.mass_ledger
        assert result_a.step_count == result_b.step_count
        assert result_a.simulated_duration_s == result_b.simulated_duration_s
