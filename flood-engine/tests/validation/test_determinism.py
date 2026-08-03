"""Step 18, Part F: determinism -- identical inputs produce identical outputs, verified by hash.

Distinct from Part C's ``TestRepeatability`` (which compares arrays
directly): this hashes every output raster
(``FloodOutputSummary.max_depth_m``/``arrival_time_min``/
``duration_above_threshold_min``) with SHA-256 and compares digests, the
literal "hash every output raster... verify hashes match" the prompt
asks for -- a stronger, bitwise-exact form of comparison than
``np.testing.assert_array_equal`` alone communicates, and the natural
mechanism a real persistence/caching layer would use to detect a changed
result without re-comparing full arrays.
"""

import hashlib
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
from flood_engine.output.generator import FloodOutputSummary, generate_summary
from flood_engine.simulation.controller import run as run_simulation
from tests.factories import building_barrier_mask, depression_dem, hill_dem, no_buildings

SHAPE = (10, 10)


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
        "elevation_m": np.array(elevation_m),
        "building_mask": np.array(mask),
        "manning_n": manning_n,
        "infiltration_loss_mm_per_hr": infiltration,
        "rainfall_rates_mm_per_hr": np.array(rainfall),
    }


def _hash_array(array: NDArray[np.float64]) -> str:
    """SHA-256 over the raw bytes of an array's exact values, including NaN bit patterns."""
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def _hash_summary(summary: FloodOutputSummary) -> tuple[str, str, str]:
    return (
        _hash_array(summary.max_depth_m),
        _hash_array(summary.arrival_time_min),
        _hash_array(summary.duration_above_threshold_min),
    )


class TestOutputRasterHashesMatchAcrossRepeatedRuns:
    def test_hill_scenario_hashes_match(self) -> None:
        dem = hill_dem(SHAPE, base_elevation_m=10.0, peak_height_m=3.0)
        rainfall = np.array([25.0, 25.0])

        summary_a = generate_summary(run_simulation(**_inputs(dem.data, rainfall)))
        summary_b = generate_summary(run_simulation(**_inputs(dem.data, rainfall)))

        assert _hash_summary(summary_a) == _hash_summary(summary_b)

    def test_depression_scenario_hashes_match(self) -> None:
        dem = depression_dem(SHAPE, base_elevation_m=10.0, depth_m=3.0)
        rainfall = np.array([40.0, 40.0])

        summary_a = generate_summary(run_simulation(**_inputs(dem.data, rainfall)))
        summary_b = generate_summary(run_simulation(**_inputs(dem.data, rainfall)))

        assert _hash_summary(summary_a) == _hash_summary(summary_b)

    def test_building_barrier_scenario_hashes_match(self) -> None:
        dem = hill_dem(SHAPE, peak_height_m=2.0)
        mask = building_barrier_mask(SHAPE)
        rainfall = np.array([30.0, 20.0])

        summary_a = generate_summary(
            run_simulation(**_inputs(dem.data, rainfall, building_mask=mask))
        )
        summary_b = generate_summary(
            run_simulation(**_inputs(dem.data, rainfall, building_mask=mask))
        )

        assert _hash_summary(summary_a) == _hash_summary(summary_b)

    def test_hashes_match_across_three_repeated_runs_not_just_two(self) -> None:
        # Two matching runs could coincidentally share a subtle ordering
        # bug that happens to cancel out; a third run against the same
        # inputs makes that far less plausible.
        dem = depression_dem(SHAPE, depth_m=2.0)
        rainfall = np.array([30.0])

        hashes = {
            _hash_summary(generate_summary(run_simulation(**_inputs(dem.data, rainfall))))
            for _ in range(3)
        }

        assert len(hashes) == 1

    def test_full_ledger_and_state_hash_matches_too(self) -> None:
        # Beyond the three summary rasters specifically: the underlying
        # final water-depth field itself must also hash identically.
        dem = hill_dem(SHAPE, peak_height_m=2.5)
        rainfall = np.array([20.0, 15.0])

        result_a = run_simulation(**_inputs(dem.data, rainfall))
        result_b = run_simulation(**_inputs(dem.data, rainfall))

        assert _hash_array(result_a.final_state.water_depth_m) == _hash_array(
            result_b.final_state.water_depth_m
        )


class TestHashesActuallyDistinguishDifferentOutputs:
    """A hash that matches everything regardless of content would make the tests above vacuous."""

    def test_different_rainfall_produces_a_different_hash(self) -> None:
        dem = hill_dem(SHAPE, peak_height_m=3.0)

        summary_a = generate_summary(
            run_simulation(**_inputs(dem.data, np.array([20.0, 20.0])))
        )
        summary_b = generate_summary(
            run_simulation(**_inputs(dem.data, np.array([45.0, 45.0])))
        )

        assert _hash_summary(summary_a) != _hash_summary(summary_b)

    def test_different_terrain_produces_a_different_hash(self) -> None:
        rainfall = np.array([25.0, 25.0])
        hill = hill_dem(SHAPE, peak_height_m=3.0)
        depression = depression_dem(SHAPE, depth_m=3.0)

        summary_hill = generate_summary(run_simulation(**_inputs(hill.data, rainfall)))
        summary_depression = generate_summary(
            run_simulation(**_inputs(depression.data, rainfall))
        )

        assert _hash_summary(summary_hill) != _hash_summary(summary_depression)

    def test_a_single_differing_cell_changes_the_hash(self) -> None:
        # The hash must be sensitive to the array's exact bit content,
        # not just its shape or a coarse summary statistic.
        depth_a = np.zeros((5, 5))
        depth_b = np.zeros((5, 5))
        depth_b[2, 2] = 1e-9

        assert _hash_array(depth_a) != _hash_array(depth_b)
