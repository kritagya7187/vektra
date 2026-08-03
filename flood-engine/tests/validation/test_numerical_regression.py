"""Step 18, Part D: permanent numerical regression suite.

Every scenario below is run once, its real, actually-computed output
captured, and pinned as a permanent expected value -- not a property
check (Part C already covers properties/invariants). A future change
that alters the WCA2D solver, timestepping, roughness/infiltration
crosswalks, or output generation in a way that shifts these numbers is
exactly what this suite exists to catch. Per the frozen review discipline
in ``docs/NUMERICAL_DEVIATIONS.md`` ("any change to wca2d.py that could
alter output requires a dedicated numerical audit before merge"), a
failure here is a signal to investigate, not to casually update the
pinned value.

Tolerances: ``rtol=1e-9`` for floating-point ledger/depth values (the
same bound the frozen mass-ledger machine-precision regression test in
``core/timestepping``'s own test suite uses) -- tight enough to catch a
real behavioral change, loose enough to tolerate platform/BLAS-level
floating-point noise. ``step_count``/``simulated_duration_s`` are
asserted exactly: both are deterministic integers/exact multiples of a
fixed timestep grid, not accumulated floating-point sums.
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
from flood_engine.simulation.controller import SimulationResult
from flood_engine.simulation.controller import run as run_simulation
from tests.factories import (
    building_barrier_mask,
    depression_dem,
    flat_dem,
    hill_dem,
    no_buildings,
    sloped_dem,
)

SHAPE = (12, 12)


class _RunInputs(TypedDict):
    elevation_m: NDArray[np.float64]
    building_mask: NDArray[np.bool_]
    manning_n: NDArray[np.float64]
    infiltration_loss_mm_per_hr: NDArray[np.float64]
    rainfall_rates_mm_per_hr: NDArray[np.float64]


def _inputs(
    elevation_m: NDArray[np.float64],
    rainfall: NDArray[np.float64],
    building_mask: NDArray[np.bool_] | None = None,
) -> _RunInputs:
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
        "rainfall_rates_mm_per_hr": rainfall,
    }


def _assert_matches_pinned(
    result: SimulationResult,
    *,
    step_count: int,
    simulated_duration_s: float,
    final_depth_sum: float,
    final_depth_max: float,
    rainfall_input_m3: float,
    infiltration_loss_m3: float,
    boundary_outflow_m3: float,
) -> None:
    assert result.step_count == step_count
    assert result.simulated_duration_s == simulated_duration_s
    depth = result.final_state.water_depth_m
    ledger = result.mass_ledger
    np.testing.assert_allclose(depth.sum(), final_depth_sum, rtol=1e-9, atol=1e-12)
    np.testing.assert_allclose(depth.max(), final_depth_max, rtol=1e-9, atol=1e-12)
    np.testing.assert_allclose(ledger.rainfall_input_m3, rainfall_input_m3, rtol=1e-9)
    np.testing.assert_allclose(ledger.infiltration_loss_m3, infiltration_loss_m3, rtol=1e-9)
    np.testing.assert_allclose(ledger.boundary_outflow_m3, boundary_outflow_m3, rtol=1e-9)


class TestFlatTerrain:
    def test_matches_pinned_regression_values(self) -> None:
        dem = flat_dem(SHAPE, elevation_m=10.0)
        rainfall = np.array([20.0, 20.0])
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=360,
            simulated_duration_s=21600.0,
            final_depth_sum=0.13000796785663038,
            final_depth_max=0.004001844255845361,
            rainfall_input_m3=5183.999999999999,
            infiltration_loss_m3=723.1430671921262,
            boundary_outflow_m3=4343.849761736907,
        )


class TestSingleHill:
    def test_matches_pinned_regression_values(self) -> None:
        dem = hill_dem(SHAPE, base_elevation_m=10.0, peak_height_m=3.0)
        rainfall = np.array([25.0, 25.0])
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=360,
            simulated_duration_s=21600.0,
            final_depth_sum=0.0,
            final_depth_max=0.0,
            rainfall_input_m3=6480.0,
            infiltration_loss_m3=403.69823387914215,
            boundary_outflow_m3=6076.301766120857,
        )


class TestSingleDepression:
    def test_matches_pinned_regression_values(self) -> None:
        dem = depression_dem(SHAPE, base_elevation_m=10.0, depth_m=3.0)
        rainfall = np.array([25.0, 25.0])
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=373,
            simulated_duration_s=21600.0,
            final_depth_sum=6.556618775951694,
            final_depth_max=0.9623371784427692,
            rainfall_input_m3=6491.708995879367,
            infiltration_loss_m3=427.59635970734365,
            boundary_outflow_m3=163.15573781550543,
        )


class TestBuildingBarrier:
    def test_matches_pinned_regression_values(self) -> None:
        dem = flat_dem(SHAPE, elevation_m=10.0)
        mask = building_barrier_mask(SHAPE)
        rainfall = np.array([25.0, 25.0])
        result = run_simulation(**_inputs(dem.data, rainfall, building_mask=mask))

        _assert_matches_pinned(
            result,
            step_count=360,
            simulated_duration_s=21600.0,
            final_depth_sum=0.112929106191242,
            final_depth_max=0.0039559974880369764,
            rainfall_input_m3=5940.0,
            infiltration_loss_m3=661.9218188560887,
            boundary_outflow_m3=5176.441985571786,
        )

    def test_building_cells_stay_dry(self) -> None:
        dem = flat_dem(SHAPE, elevation_m=10.0)
        mask = building_barrier_mask(SHAPE)
        rainfall = np.array([25.0, 25.0])
        result = run_simulation(**_inputs(dem.data, rainfall, building_mask=mask))

        assert np.all(result.final_state.water_depth_m[mask] == 0.0)


class TestConstantRainfall:
    def test_matches_pinned_regression_values(self) -> None:
        dem = flat_dem(SHAPE, elevation_m=10.0)
        rainfall = np.full(4, 15.0)
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=480,
            simulated_duration_s=28800.0,
            final_depth_sum=0.1211783457893006,
            final_depth_max=0.004022793812050434,
            rainfall_input_m3=7776.000000000002,
            infiltration_loss_m3=974.9525839694796,
            boundary_outflow_m3=6691.986904820162,
        )


class TestZeroRainfall:
    def test_matches_pinned_regression_values(self) -> None:
        dem = hill_dem(SHAPE)
        rainfall = np.zeros(1)
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=300,
            simulated_duration_s=18000.0,
            final_depth_sum=0.0,
            final_depth_max=0.0,
            rainfall_input_m3=0.0,
            infiltration_loss_m3=0.0,
            boundary_outflow_m3=0.0,
        )


class TestHighRainfall:
    def test_matches_pinned_regression_values(self) -> None:
        dem = flat_dem(SHAPE, elevation_m=10.0)
        rainfall = np.full(2, 100.0)
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=360,
            simulated_duration_s=21600.0,
            final_depth_sum=0.22244227909752612,
            final_depth_max=0.005106998412532693,
            rainfall_input_m3=25920.0,
            infiltration_loss_m3=760.6244643427382,
            boundary_outflow_m3=24959.177484469474,
        )


class TestLargeTimestep:
    def test_matches_pinned_regression_values(self) -> None:
        dem = hill_dem(SHAPE, peak_height_m=3.0)
        rainfall = np.array([30.0, 20.0])
        params = SolverParameters(time_maxdt_s=60.0, time_mindt_s=0.1)
        result = run_simulation(**_inputs(dem.data, rainfall), solver_parameters=params)

        _assert_matches_pinned(
            result,
            step_count=360,
            simulated_duration_s=21600.0,
            final_depth_sum=0.0,
            final_depth_max=0.0,
            rainfall_input_m3=6480.0,
            infiltration_loss_m3=398.1250373387776,
            boundary_outflow_m3=6081.874962661224,
        )


class TestSmallTimestep:
    def test_matches_pinned_regression_values(self) -> None:
        dem = hill_dem(SHAPE, peak_height_m=3.0)
        rainfall = np.array([30.0, 20.0])
        params = SolverParameters(time_maxdt_s=1.0, time_mindt_s=0.05)
        result = run_simulation(**_inputs(dem.data, rainfall), solver_parameters=params)

        _assert_matches_pinned(
            result,
            step_count=21600,
            simulated_duration_s=21600.0,
            final_depth_sum=0.0,
            final_depth_max=0.0,
            rainfall_input_m3=6480.0,
            infiltration_loss_m3=417.80396618913886,
            boundary_outflow_m3=6062.196033810916,
        )

    def test_small_timestep_produces_many_more_steps_than_large_timestep(self) -> None:
        # A direct, explicit cross-check between the two timestep
        # regression scenarios above: forcing a small time_maxdt_s must
        # produce meaningfully more steps for the identical scenario,
        # not just a different final answer.
        dem = hill_dem(SHAPE, peak_height_m=3.0)
        rainfall = np.array([30.0, 20.0])
        large_result = run_simulation(
            **_inputs(dem.data, rainfall),
            solver_parameters=SolverParameters(time_maxdt_s=60.0, time_mindt_s=0.1),
        )
        small_result = run_simulation(
            **_inputs(dem.data, rainfall),
            solver_parameters=SolverParameters(time_maxdt_s=1.0, time_mindt_s=0.05),
        )
        assert small_result.step_count > large_result.step_count


class TestLongSimulation:
    def test_matches_pinned_regression_values(self) -> None:
        dem = hill_dem(SHAPE, peak_height_m=2.0)
        rainfall = np.full(6, 10.0)
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=600,
            simulated_duration_s=36000.0,
            final_depth_sum=0.0,
            final_depth_max=0.0,
            rainfall_input_m3=7775.999999999999,
            infiltration_loss_m3=915.808329569784,
            boundary_outflow_m3=6860.191670430218,
        )


class TestVeryShallowWater:
    def test_matches_pinned_regression_values(self) -> None:
        dem = flat_dem(SHAPE, elevation_m=10.0)
        rainfall = np.array([2.0])
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=300,
            simulated_duration_s=18000.0,
            final_depth_sum=0.0,
            final_depth_max=0.0,
            rainfall_input_m3=259.20000000000005,
            infiltration_loss_m3=258.5478157963275,
            boundary_outflow_m3=0.6521842036725517,
        )


class TestDeepWater:
    def test_matches_pinned_regression_values(self) -> None:
        dem = depression_dem(SHAPE, base_elevation_m=10.0, depth_m=5.0)
        rainfall = np.full(4, 60.0)
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=575,
            simulated_duration_s=28800.0,
            final_depth_sum=32.9174995474626,
            final_depth_max=2.8522789139305376,
            rainfall_input_m3=31125.0153275869,
            infiltration_loss_m3=715.2147511415145,
            boundary_outflow_m3=784.0509837286631,
        )

    def test_depth_stays_below_the_depression_basin_depth(self) -> None:
        # A physically-sensible sanity bound alongside the exact
        # regression pin: water cannot pool deeper than the basin itself
        # is deep relative to its rim.
        dem = depression_dem(SHAPE, base_elevation_m=10.0, depth_m=5.0)
        rainfall = np.full(4, 60.0)
        result = run_simulation(**_inputs(dem.data, rainfall))

        assert result.final_state.water_depth_m.max() < 5.0


class TestEdgeDischarge:
    def test_matches_pinned_regression_values(self) -> None:
        dem = sloped_dem(SHAPE, high_elevation_m=20.0, low_elevation_m=0.0)
        rainfall = np.full(3, 40.0)
        result = run_simulation(**_inputs(dem.data, rainfall))

        _assert_matches_pinned(
            result,
            step_count=471,
            simulated_duration_s=25200.0,
            final_depth_sum=0.0,
            final_depth_max=0.0,
            rainfall_input_m3=15605.857896117013,
            infiltration_loss_m3=547.8549134213671,
            boundary_outflow_m3=15058.002982695647,
        )

    def test_boundary_outflow_dominates_the_mass_budget(self) -> None:
        # The defining physical property of this scenario: with a single,
        # unambiguous downhill direction and no closed basin, boundary
        # outflow -- not infiltration -- must be where nearly all the
        # rainfall ends up.
        dem = sloped_dem(SHAPE, high_elevation_m=20.0, low_elevation_m=0.0)
        rainfall = np.full(3, 40.0)
        result = run_simulation(**_inputs(dem.data, rainfall))

        assert result.mass_ledger.boundary_outflow_m3 > result.mass_ledger.infiltration_loss_m3
