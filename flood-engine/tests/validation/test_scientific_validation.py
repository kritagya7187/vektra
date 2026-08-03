"""Step 18, Part C: scientific validation of the complete model.

Every test here calls :func:`~flood_engine.simulation.controller.run`
(never the solver or timestepping engine directly) -- validating
properties of the *full simulation*, not re-testing invariants
``core.solver.wca2d``'s/``core.timestepping``'s own frozen unit tests
already establish at the single-step/single-run-loop level. Comparisons
are against analytical expectations where the WCA2D formulation makes one
tractable (mass conservation, monotonic accumulation, dry-domain
behavior), and against manually-computed synthetic-scenario expectations
everywhere else (per the Step 18 prompt's own instruction) -- no
comparison against real CADDIES reference output anywhere in this file,
since none is available to this project.
"""

from typing import TypedDict

import numpy as np
from numpy.typing import NDArray

from flood_engine.core.solver.infiltration import (
    IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR,
    PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
)
from flood_engine.core.solver.roughness import (
    BARE_SPARSE_VEGETATION,
    BUILDING_MANNING_N_PLACEHOLDER,
    MANNING_N_BY_LANDCOVER_CLASS,
)
from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.output.generator import ARRIVAL_THRESHOLD_M, generate_summary
from flood_engine.simulation.controller import run as run_simulation
from tests.factories import (
    building_barrier_mask,
    depression_dem,
    flat_dem,
    hill_dem,
    no_buildings,
    sloped_dem,
    zero_rainfall,
)

SHAPE = (12, 12)
_SECONDS_PER_MINUTE = 60.0


class _RunInputs(TypedDict):
    elevation_m: NDArray[np.float64]
    building_mask: NDArray[np.bool_]
    manning_n: NDArray[np.float64]
    infiltration_loss_mm_per_hr: NDArray[np.float64]
    rainfall_rates_mm_per_hr: NDArray[np.float64]


def _inputs(
    *,
    elevation_m: NDArray[np.float64],
    building_mask: NDArray[np.bool_] | None = None,
    rainfall_rates_mm_per_hr: NDArray[np.float64],
) -> _RunInputs:
    """A ready-to-unpack kwargs dict for controller.run() -- pervious (bare-soil) everywhere."""
    shape = elevation_m.shape
    mask = building_mask if building_mask is not None else no_buildings(shape)
    pervious_n = MANNING_N_BY_LANDCOVER_CLASS[BARE_SPARSE_VEGETATION]
    manning_n = np.where(mask, BUILDING_MANNING_N_PLACEHOLDER, pervious_n)
    infiltration = np.where(
        mask, IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR, PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR
    )
    return {
        "elevation_m": elevation_m,
        "building_mask": mask,
        "manning_n": manning_n,
        "infiltration_loss_mm_per_hr": infiltration,
        "rainfall_rates_mm_per_hr": rainfall_rates_mm_per_hr,
    }


def _copy_inputs(inputs: _RunInputs) -> _RunInputs:
    """A fresh, independently-constructed copy -- proves repeatability of the computation itself.

    Not just that the same array object was passed twice.
    """
    return {
        "elevation_m": np.array(inputs["elevation_m"]),
        "building_mask": np.array(inputs["building_mask"]),
        "manning_n": np.array(inputs["manning_n"]),
        "infiltration_loss_mm_per_hr": np.array(inputs["infiltration_loss_mm_per_hr"]),
        "rainfall_rates_mm_per_hr": np.array(inputs["rainfall_rates_mm_per_hr"]),
    }


class TestMassConservationOverFullSimulation:
    def test_ledger_identity_holds_for_a_hill_scenario(self) -> None:
        dem = hill_dem(SHAPE, base_elevation_m=10.0, peak_height_m=3.0)
        rainfall = np.array([20.0, 30.0, 10.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        cell_area_m2 = 30.0 * 30.0
        initial_storage_m3 = 0.0  # controller.run() always starts dry
        final_storage_m3 = float((result.final_state.water_depth_m * cell_area_m2).sum())
        expected_final_storage_m3 = (
            initial_storage_m3
            + result.mass_ledger.rainfall_input_m3
            - result.mass_ledger.boundary_outflow_m3
            - result.mass_ledger.infiltration_loss_m3
        )
        # controller.run() itself already enforces this (raises
        # SimulationControllerError on violation) -- this test verifies
        # the SAME identity independently, from the outside, proving the
        # internal check is not vacuously true.
        np.testing.assert_allclose(final_storage_m3, expected_final_storage_m3, atol=1e-6)

    def test_ledger_identity_holds_for_a_depression_scenario(self) -> None:
        dem = depression_dem(SHAPE, base_elevation_m=10.0, depth_m=3.0)
        rainfall = np.array([40.0, 40.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        cell_area_m2 = 30.0 * 30.0
        final_storage_m3 = float((result.final_state.water_depth_m * cell_area_m2).sum())
        expected_final_storage_m3 = (
            result.mass_ledger.rainfall_input_m3
            - result.mass_ledger.boundary_outflow_m3
            - result.mass_ledger.infiltration_loss_m3
        )
        np.testing.assert_allclose(final_storage_m3, expected_final_storage_m3, atol=1e-6)

    def test_every_ledger_term_is_non_negative(self) -> None:
        dem = hill_dem(SHAPE)
        rainfall = np.array([25.0, 15.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        assert result.mass_ledger.rainfall_input_m3 >= 0.0
        assert result.mass_ledger.infiltration_loss_m3 >= 0.0
        assert result.mass_ledger.boundary_outflow_m3 >= 0.0


class TestNoNegativeDepths:
    def test_final_state_has_no_negative_depths(self) -> None:
        dem = hill_dem(SHAPE)
        rainfall = np.array([30.0, 20.0, 10.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        assert np.all(result.final_state.water_depth_m >= 0.0)

    def test_every_intermediate_timestep_has_no_negative_depths(self) -> None:
        dem = depression_dem(SHAPE, depth_m=2.0)
        rainfall = np.array([35.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        for record in result.timestep_records:
            assert np.all(record.result.state.water_depth_m >= 0.0), (
                f"Negative depth at elapsed_s={record.elapsed_s}"
            )


class TestStableTimestepEvolution:
    def test_dt_used_never_exceeds_configured_bounds(self) -> None:
        params = SolverParameters(time_mindt_s=0.1, time_maxdt_s=60.0)
        dem = hill_dem(SHAPE, peak_height_m=5.0)
        rainfall = np.array([50.0, 30.0])
        result = run_simulation(
            **_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall),
            solver_parameters=params,
        )

        for record in result.timestep_records:
            assert 0.0 < record.result.dt_used_s <= params.time_maxdt_s

    def test_dt_used_and_proposed_are_always_finite_and_positive(self) -> None:
        dem = hill_dem(SHAPE)
        rainfall = np.array([40.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        for record in result.timestep_records:
            assert np.isfinite(record.result.dt_used_s)
            assert np.isfinite(record.result.next_dt_proposed_s)
            assert record.result.dt_used_s > 0.0
            assert record.result.next_dt_proposed_s > 0.0

    def test_elapsed_time_is_strictly_increasing_and_matches_cumulative_dt(self) -> None:
        dem = hill_dem(SHAPE)
        rainfall = np.array([25.0, 25.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        cumulative = 0.0
        previous_elapsed = -1.0
        for record in result.timestep_records:
            cumulative += record.result.dt_used_s
            assert record.elapsed_s > previous_elapsed
            np.testing.assert_allclose(record.elapsed_s, cumulative, rtol=1e-9)
            previous_elapsed = record.elapsed_s


class TestRainfallVolumeConservation:
    def test_total_rainfall_input_matches_the_analytical_rate_times_area_times_duration(
        self,
    ) -> None:
        # A fully impervious, flat, boundary-free-outflow-dominant domain
        # would still lose volume to boundary outflow, so isolate the
        # rainfall-input side alone: mass_ledger.rainfall_input_m3 is
        # computed purely from the rainfall schedule and cell area,
        # independent of what happens to the water afterward -- exactly
        # rate * area * duration for a constant-rate forcing, an
        # analytical expectation, not a synthetic approximation.
        dem = flat_dem(SHAPE, elevation_m=10.0)
        rate_mm_per_hr = 20.0
        hours = 3
        rainfall = np.full(hours, rate_mm_per_hr)
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        cell_area_m2 = 30.0 * 30.0
        domain_area_m2 = cell_area_m2 * dem.data.size
        rate_m_per_s = rate_mm_per_hr / 1000.0 / 3600.0
        expected_m3 = rate_m_per_s * domain_area_m2 * (hours * 3600.0)

        np.testing.assert_allclose(
            result.mass_ledger.rainfall_input_m3, expected_m3, rtol=1e-6
        )

    def test_zero_rainfall_produces_zero_rainfall_input(self) -> None:
        dem = flat_dem(SHAPE)
        forcing = zero_rainfall(hours=2)
        result = run_simulation(
            **_inputs(
                elevation_m=dem.data, rainfall_rates_mm_per_hr=forcing.rainfall_mm_per_hr
            )
        )

        assert result.mass_ledger.rainfall_input_m3 == 0.0


class TestInfiltrationAccounting:
    def test_impervious_domain_has_zero_infiltration_loss(self) -> None:
        dem = flat_dem(SHAPE)
        shape = dem.data.shape
        manning_n = np.full(shape, 0.016)
        infiltration = np.full(shape, IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR)
        rainfall = np.array([25.0, 25.0])

        result = run_simulation(
            elevation_m=dem.data,
            building_mask=no_buildings(shape),
            manning_n=manning_n,
            infiltration_loss_mm_per_hr=infiltration,
            rainfall_rates_mm_per_hr=rainfall,
        )

        assert result.mass_ledger.infiltration_loss_m3 == 0.0

    def test_pervious_domain_with_rainfall_has_positive_infiltration_loss(self) -> None:
        dem = flat_dem(SHAPE)
        rainfall = np.array([30.0, 30.0, 30.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        assert result.mass_ledger.infiltration_loss_m3 > 0.0

    def test_infiltration_loss_never_exceeds_rainfall_input(self) -> None:
        # Physically impossible to infiltrate more water than fell --
        # the bucket-removal mechanism (remove = min(h, rate)) enforces
        # this at the per-step/per-cell level; this checks the run-level
        # aggregate holds too.
        dem = hill_dem(SHAPE)
        rainfall = np.array([15.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        assert result.mass_ledger.infiltration_loss_m3 <= result.mass_ledger.rainfall_input_m3


class TestBoundaryOutflowAccounting:
    def test_sloped_terrain_produces_positive_boundary_outflow(self) -> None:
        dem = sloped_dem(SHAPE, high_elevation_m=20.0, low_elevation_m=0.0)
        rainfall = np.array([40.0, 40.0, 40.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        assert result.mass_ledger.boundary_outflow_m3 > 0.0

    def test_deep_depression_with_modest_rainfall_has_negligible_boundary_outflow(self) -> None:
        # Water pools toward the center of a closed depression, but this
        # is NOT zero boundary outflow: per the frozen open-boundary
        # convention (NUMERICAL_DEVIATIONS.md, "H_boundary = z_center"),
        # any wet edge cell has an inherent outward gradient regardless
        # of terrain slope, and rainfall falls on edge cells directly too
        # -- a real, documented model property, not a defect. The
        # correct expectation is "small relative to total rainfall", not
        # exactly zero.
        dem = depression_dem(SHAPE, base_elevation_m=10.0, depth_m=5.0)
        rainfall = np.array([5.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        assert result.mass_ledger.boundary_outflow_m3 < 0.01 * result.mass_ledger.rainfall_input_m3


class TestBuildingObstruction:
    def test_building_cells_remain_dry_throughout_a_full_run(self) -> None:
        mask = building_barrier_mask(SHAPE)
        dem = hill_dem(SHAPE, peak_height_m=4.0)
        rainfall = np.array([50.0, 50.0])
        result = run_simulation(
            **_inputs(
                elevation_m=dem.data, building_mask=mask, rainfall_rates_mm_per_hr=rainfall
            )
        )

        for record in result.timestep_records:
            assert np.all(record.result.state.water_depth_m[mask] == 0.0)
        assert np.all(result.final_state.water_depth_m[mask] == 0.0)

    def test_building_barrier_does_not_prevent_water_on_either_side(self) -> None:
        # The barrier blocks crossing, but both sides still receive
        # direct rainfall independently -- confirms the mask is not
        # over-broadly zeroing the whole domain by mistake.
        mask = building_barrier_mask(SHAPE)
        dem = flat_dem(SHAPE)
        rainfall = np.array([30.0, 30.0])
        result = run_simulation(
            **_inputs(
                elevation_m=dem.data, building_mask=mask, rainfall_rates_mm_per_hr=rainfall
            )
        )

        non_building_depth = result.final_state.water_depth_m[~mask]
        assert np.any(non_building_depth > 0.0)


class TestArrivalTimeCorrectness:
    def test_arrival_time_is_nan_where_threshold_never_crossed(self) -> None:
        dem = flat_dem(SHAPE)
        rainfall = np.array([1.0])  # negligible: infiltration alone consumes it
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))
        summary = generate_summary(result)

        assert np.all(np.isnan(summary.arrival_time_min))

    def test_arrival_time_is_never_earlier_than_the_first_timestep_a_cell_crosses_threshold(
        self,
    ) -> None:
        dem = depression_dem(SHAPE, depth_m=4.0)
        rainfall = np.array([50.0, 50.0, 50.0, 50.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))
        summary = generate_summary(result)

        # Manually recompute arrival time per cell by scanning the real
        # timestep records, independent of generate_summary's own
        # implementation, and compare -- an analytical cross-check, not
        # a re-statement of the same code path.
        crossed_at = np.full(dem.data.shape, np.nan)
        for record in result.timestep_records:
            above = record.result.state.water_depth_m > ARRIVAL_THRESHOLD_M
            newly = above & np.isnan(crossed_at)
            crossed_at = np.where(newly, record.elapsed_s / _SECONDS_PER_MINUTE, crossed_at)

        np.testing.assert_array_equal(summary.arrival_time_min, crossed_at)


class TestMaximumDepthAccumulation:
    def test_max_depth_matches_the_true_maximum_across_every_recorded_timestep(self) -> None:
        dem = hill_dem(SHAPE, peak_height_m=3.0)
        rainfall = np.array([35.0, 25.0, 15.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))
        summary = generate_summary(result)

        manual_max = np.zeros(dem.data.shape)
        for record in result.timestep_records:
            manual_max = np.maximum(manual_max, record.result.state.water_depth_m)

        np.testing.assert_array_equal(summary.max_depth_m, manual_max)

    def test_max_depth_is_never_less_than_the_final_depth(self) -> None:
        # The maximum across the whole run can never be smaller than
        # wherever depth ends up at the last recorded step.
        dem = depression_dem(SHAPE, depth_m=3.0)
        rainfall = np.array([30.0, 30.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))
        summary = generate_summary(result)

        assert np.all(summary.max_depth_m >= result.final_state.water_depth_m)


class TestDurationAboveThresholdAccumulation:
    def test_duration_matches_the_sum_of_dt_across_every_above_threshold_step(self) -> None:
        dem = depression_dem(SHAPE, depth_m=4.0)
        rainfall = np.array([50.0, 50.0, 50.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))
        summary = generate_summary(result)

        manual_duration_s = np.zeros(dem.data.shape)
        for record in result.timestep_records:
            above = record.result.state.water_depth_m > ARRIVAL_THRESHOLD_M
            manual_duration_s = manual_duration_s + np.where(above, record.result.dt_used_s, 0.0)

        np.testing.assert_allclose(
            summary.duration_above_threshold_min, manual_duration_s / _SECONDS_PER_MINUTE
        )

    def test_duration_is_zero_wherever_the_cell_never_crossed_threshold(self) -> None:
        dem = flat_dem(SHAPE)
        rainfall = np.array([1.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))
        summary = generate_summary(result)

        assert np.all(summary.duration_above_threshold_min == 0.0)


class TestDryDomainBehavior:
    def test_zero_rainfall_leaves_the_domain_completely_dry(self) -> None:
        dem = hill_dem(SHAPE)
        forcing = zero_rainfall(hours=1)
        result = run_simulation(
            **_inputs(
                elevation_m=dem.data, rainfall_rates_mm_per_hr=forcing.rainfall_mm_per_hr
            )
        )

        assert np.all(result.final_state.water_depth_m == 0.0)
        for record in result.timestep_records:
            assert np.all(record.result.state.water_depth_m == 0.0)

    def test_zero_rainfall_produces_an_all_zero_mass_ledger(self) -> None:
        dem = hill_dem(SHAPE)
        forcing = zero_rainfall(hours=1)
        result = run_simulation(
            **_inputs(
                elevation_m=dem.data, rainfall_rates_mm_per_hr=forcing.rainfall_mm_per_hr
            )
        )

        assert result.mass_ledger.rainfall_input_m3 == 0.0
        assert result.mass_ledger.infiltration_loss_m3 == 0.0
        assert result.mass_ledger.boundary_outflow_m3 == 0.0

    def test_zero_rainfall_summary_has_no_arrival_anywhere(self) -> None:
        dem = depression_dem(SHAPE)
        forcing = zero_rainfall(hours=1)
        result = run_simulation(
            **_inputs(
                elevation_m=dem.data, rainfall_rates_mm_per_hr=forcing.rainfall_mm_per_hr
            )
        )
        summary = generate_summary(result)

        assert np.all(np.isnan(summary.arrival_time_min))
        assert np.all(summary.max_depth_m == 0.0)
        assert np.all(summary.duration_above_threshold_min == 0.0)


class TestSymmetryPreservation:
    def test_radially_symmetric_hill_produces_a_left_right_symmetric_depth_field(self) -> None:
        # A hill centered exactly on the grid, uniform roughness/
        # infiltration, no buildings: the physical setup has left-right
        # mirror symmetry, so the WCA2D solver's neighbor-transfer
        # computation (which has no directional bias built in) must
        # preserve it. A broken symmetry here is a strong, sensitive
        # signal of a real solver bug (e.g. a transposed row/column
        # index), not just an aesthetic property.
        dem = hill_dem(SHAPE, peak_height_m=3.0)
        rainfall = np.array([30.0, 20.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        depth = result.final_state.water_depth_m
        mirrored = np.fliplr(depth)
        np.testing.assert_allclose(depth, mirrored, atol=1e-9)

    def test_radially_symmetric_hill_produces_a_top_bottom_symmetric_depth_field(self) -> None:
        dem = hill_dem(SHAPE, peak_height_m=3.0)
        rainfall = np.array([30.0, 20.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        depth = result.final_state.water_depth_m
        mirrored = np.flipud(depth)
        np.testing.assert_allclose(depth, mirrored, atol=1e-9)

    def test_radially_symmetric_depression_preserves_symmetry_too(self) -> None:
        dem = depression_dem(SHAPE, depth_m=3.0)
        rainfall = np.array([25.0, 25.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        depth = result.final_state.water_depth_m
        np.testing.assert_allclose(depth, np.fliplr(depth), atol=1e-9)
        np.testing.assert_allclose(depth, np.flipud(depth), atol=1e-9)


class TestRepeatability:
    def test_identical_inputs_produce_bit_identical_final_state(self) -> None:
        dem = hill_dem(SHAPE, peak_height_m=2.5)
        rainfall = np.array([20.0, 30.0, 10.0])
        inputs = _inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall)

        # Fresh, independently-constructed arrays for each call (not the
        # same object reused) -- proves repeatability of the computation
        # itself, not just that the same array was passed twice.
        result_a = run_simulation(**_copy_inputs(inputs))
        result_b = run_simulation(**_copy_inputs(inputs))

        np.testing.assert_array_equal(
            result_a.final_state.water_depth_m, result_b.final_state.water_depth_m
        )
        assert result_a.step_count == result_b.step_count
        assert result_a.simulated_duration_s == result_b.simulated_duration_s

    def test_identical_inputs_produce_bit_identical_mass_ledger(self) -> None:
        dem = depression_dem(SHAPE, depth_m=2.0)
        rainfall = np.array([25.0, 25.0])
        inputs = _inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall)

        result_a = run_simulation(**_copy_inputs(inputs))
        result_b = run_simulation(**_copy_inputs(inputs))

        assert result_a.mass_ledger == result_b.mass_ledger

    def test_summary_generation_is_repeatable_given_the_same_result(self) -> None:
        dem = hill_dem(SHAPE)
        rainfall = np.array([15.0, 15.0])
        result = run_simulation(**_inputs(elevation_m=dem.data, rainfall_rates_mm_per_hr=rainfall))

        summary_a = generate_summary(result)
        summary_b = generate_summary(result)

        np.testing.assert_array_equal(summary_a.max_depth_m, summary_b.max_depth_m)
        np.testing.assert_array_equal(summary_a.arrival_time_min, summary_b.arrival_time_min)
