"""Unit tests for flood_engine.core.solver.wca2d.

Pure NumPy, no I/O -- exercises the solver in isolation per this
project's own established testability goal for core/. Several tests here
are the direct validation strategy from the Step 11 design review
(mass conservation, downhill-only flow, building obstruction, boundary
outflow, zero-state, negative-depth prevention) plus a regression test
for a real bug (building neighbors silently treated as an open boundary)
caught and fixed during this module's own pre-implementation prototyping.

``apply_infiltration``/``infiltration_period_s`` exist to match the real
WCA2D reference's infiltration cadence (applied periodically, not every
substep) -- found during the post-Step-11 Numerical Fidelity Audit. Most
tests here pass ``apply_infiltration=True`` to preserve the exact
semantics they were written against before that flag existed;
``TestInfiltrationCadence`` exercises the flag/period behaviour itself.
"""

import numpy as np
import pytest

from flood_engine.core.grid import MODEL_GRID_RESOLUTION_M
from flood_engine.core.solver.wca2d import (
    DomainInputs,
    SolverParameters,
    WCA2DError,
    step,
)
from flood_engine.core.state import SolverState

CELL_AREA_M2 = MODEL_GRID_RESOLUTION_M * MODEL_GRID_RESOLUTION_M


def _domain(elevation: np.ndarray, *, building_mask: np.ndarray | None = None) -> DomainInputs:
    shape = elevation.shape
    return DomainInputs(
        elevation_m=elevation,
        building_mask=building_mask if building_mask is not None else np.zeros(shape, dtype=bool),
        manning_n=np.full(shape, 0.03),
    )


def _zero_infiltration(shape: tuple[int, int]) -> np.ndarray:
    return np.zeros(shape)


class TestDomainInputsValidation:
    def test_rejects_shape_mismatch(self) -> None:
        with pytest.raises(WCA2DError, match="building_mask"):
            DomainInputs(
                elevation_m=np.zeros((3, 3)),
                building_mask=np.zeros((2, 2), dtype=bool),
                manning_n=np.full((3, 3), 0.03),
            )

    def test_rejects_non_positive_manning_n(self) -> None:
        with pytest.raises(WCA2DError, match="manning_n"):
            DomainInputs(
                elevation_m=np.zeros((2, 2)),
                building_mask=np.zeros((2, 2), dtype=bool),
                manning_n=np.array([[0.03, 0.0], [0.03, 0.03]]),
            )

    def test_rejects_permeability_shape_mismatch(self) -> None:
        with pytest.raises(WCA2DError, match="permeability"):
            DomainInputs(
                elevation_m=np.zeros((3, 3)),
                building_mask=np.zeros((3, 3), dtype=bool),
                manning_n=np.full((3, 3), 0.03),
                permeability=np.ones((2, 2)),
            )

    def test_resolved_permeability_defaults_to_ones(self) -> None:
        domain = _domain(np.zeros((3, 3)))

        np.testing.assert_array_equal(domain.resolved_permeability(), np.ones((3, 3)))

    def test_resolved_permeability_uses_supplied_array(self) -> None:
        domain = DomainInputs(
            elevation_m=np.zeros((2, 2)),
            building_mask=np.zeros((2, 2), dtype=bool),
            manning_n=np.full((2, 2), 0.03),
            permeability=np.full((2, 2), 0.5),
        )

        np.testing.assert_array_equal(domain.resolved_permeability(), np.full((2, 2), 0.5))


class TestSolverParametersValidation:
    def test_defaults_match_frozen_specification(self) -> None:
        params = SolverParameters()

        assert params.tol_delwl_m == 0.001
        assert params.ignore_wd_m == 0.001
        assert params.alpha == 0.5
        assert params.time_mindt_s == 0.1
        assert params.time_maxdt_s == 60.0

    def test_rejects_non_positive_alpha(self) -> None:
        with pytest.raises(WCA2DError, match="alpha"):
            SolverParameters(alpha=0.0)

    def test_rejects_mindt_greater_than_maxdt(self) -> None:
        with pytest.raises(WCA2DError, match="time_mindt_s"):
            SolverParameters(time_mindt_s=100.0, time_maxdt_s=1.0)


class TestStepInputValidation:
    def test_rejects_non_positive_dt(self) -> None:
        state = SolverState(water_depth_m=np.zeros((3, 3)))
        domain = _domain(np.zeros((3, 3)))

        with pytest.raises(WCA2DError, match="dt_s"):
            step(
                state,
                domain,
                0.0,
                _zero_infiltration((3, 3)),
                dt_s=0.0,
                apply_infiltration=True,
            )

    def test_rejects_non_finite_dt(self) -> None:
        state = SolverState(water_depth_m=np.zeros((3, 3)))
        domain = _domain(np.zeros((3, 3)))

        with pytest.raises(WCA2DError, match="dt_s"):
            step(
                state,
                domain,
                0.0,
                _zero_infiltration((3, 3)),
                dt_s=float("nan"),
                apply_infiltration=True,
            )

    def test_rejects_negative_rainfall(self) -> None:
        state = SolverState(water_depth_m=np.zeros((3, 3)))
        domain = _domain(np.zeros((3, 3)))

        with pytest.raises(WCA2DError, match="rainfall"):
            step(
                state,
                domain,
                -1.0,
                _zero_infiltration((3, 3)),
                dt_s=1.0,
                apply_infiltration=True,
            )

    def test_rejects_infiltration_shape_mismatch(self) -> None:
        state = SolverState(water_depth_m=np.zeros((3, 3)))
        domain = _domain(np.zeros((3, 3)))

        with pytest.raises(WCA2DError, match="infiltration"):
            step(
                state,
                domain,
                0.0,
                np.zeros((2, 2)),
                dt_s=1.0,
                apply_infiltration=True,
            )

    def test_rejects_non_positive_infiltration_period(self) -> None:
        state = SolverState(water_depth_m=np.zeros((3, 3)))
        domain = _domain(np.zeros((3, 3)))

        with pytest.raises(WCA2DError, match="infiltration_period_s"):
            step(
                state,
                domain,
                0.0,
                _zero_infiltration((3, 3)),
                dt_s=1.0,
                apply_infiltration=True,
                infiltration_period_s=0.0,
            )


class TestMassConservation:
    """The NMS's own frozen requirement, directly testable in isolation."""

    def test_conserves_mass_on_a_slope_with_boundary_outflow(self) -> None:
        elevation = np.array(
            [[5.0, 4.0, 3.0], [5.0, 4.0, 3.0], [5.0, 4.0, 3.0]]
        )
        depth = np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]])
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        initial_storage = float((depth * CELL_AREA_M2).sum())
        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=2.0,
            apply_infiltration=True,
        )
        final_storage = float((result.state.water_depth_m * CELL_AREA_M2).sum())

        assert final_storage == pytest.approx(
            initial_storage
            - result.mass_ledger.boundary_outflow_m3
            + result.mass_ledger.rainfall_input_m3
            - result.mass_ledger.infiltration_loss_m3,
            abs=1e-9,
        )

    def test_conserves_mass_with_rainfall_and_infiltration(self) -> None:
        elevation = np.full((3, 3), 2.0)
        depth = np.full((3, 3), 0.5)  # flat, so no redistribution -- isolates rainfall/infiltration
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)
        infiltration = np.full((3, 3), 3600.0)  # mm/hr, deliberately large to test capping too

        initial_storage = float((depth * CELL_AREA_M2).sum())
        result = step(
            state,
            domain,
            rainfall_rate_mm_per_hr=10.0,
            infiltration_loss_mm_per_hr=infiltration,
            dt_s=60.0,
            apply_infiltration=True,
        )
        final_storage = float((result.state.water_depth_m * CELL_AREA_M2).sum())

        assert final_storage == pytest.approx(
            initial_storage
            + result.mass_ledger.rainfall_input_m3
            - result.mass_ledger.infiltration_loss_m3
            - result.mass_ledger.boundary_outflow_m3,
            abs=1e-9,
        )

    def test_ledger_identity_holds_to_machine_precision_across_randomized_scenarios(self) -> None:
        """The global mass-balance identity, verified as its own regression test.

        Not merely "mass conserved" in a couple of hand-picked scenarios --
        ``ΔStorage = Rainfall - Infiltration - BoundaryOutflow`` exactly,
        across 500 randomized grids/depths/masks/rates/timesteps, with
        ``apply_infiltration``/``infiltration_period_s`` also randomized so
        the identity is verified under the reference infiltration cadence
        too, not just the always-applied case. Measured empirically before
        writing this assertion: worst observed relative error was ~5e-16
        (float64 epsilon), so the tolerance below is a real, evidenced
        bound, not a habitual loose one.
        """
        rng = np.random.default_rng(seed=42)
        worst_relative_error = 0.0

        for _ in range(500):
            size = int(rng.integers(3, 8))
            elevation = rng.uniform(0.0, 10.0, size=(size, size))
            depth = rng.uniform(0.0, 2.0, size=(size, size))
            building_mask = rng.random((size, size)) < 0.1
            manning_n = rng.uniform(0.01, 0.15, size=(size, size))
            rainfall = float(rng.uniform(0.0, 50.0))
            infiltration = rng.uniform(0.0, 20.0, size=(size, size))
            dt = float(rng.uniform(0.1, 120.0))
            apply_infiltration = bool(rng.random() < 0.7)
            infiltration_period_s = (
                float(rng.uniform(0.1, 300.0))
                if apply_infiltration and rng.random() < 0.5
                else None
            )

            state = SolverState(water_depth_m=depth)
            domain = DomainInputs(
                elevation_m=elevation, building_mask=building_mask, manning_n=manning_n
            )

            initial_storage = float((depth * CELL_AREA_M2).sum())
            result = step(
                state,
                domain,
                rainfall,
                infiltration,
                dt_s=dt,
                apply_infiltration=apply_infiltration,
                infiltration_period_s=infiltration_period_s,
            )
            final_storage = float((result.state.water_depth_m * CELL_AREA_M2).sum())

            expected_final = (
                initial_storage
                + result.mass_ledger.rainfall_input_m3
                - result.mass_ledger.infiltration_loss_m3
                - result.mass_ledger.boundary_outflow_m3
            )
            relative_error = abs(final_storage - expected_final) / max(abs(final_storage), 1e-12)
            worst_relative_error = max(worst_relative_error, relative_error)

        assert worst_relative_error < 1e-12, (
            f"Ledger identity relative error {worst_relative_error:.3e} exceeds the "
            "machine-precision bound expected from float64 arithmetic."
        )


class TestFlowDirection:
    def test_water_flows_outward_from_a_peak_symmetrically(self) -> None:
        elevation = np.array([[0.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 0.0]])
        depth = np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]])
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=2.0,
            apply_infiltration=True,
        )
        h = result.state.water_depth_m

        assert h[1, 1] < depth[1, 1]
        assert h[0, 1] == pytest.approx(h[2, 1])
        assert h[1, 0] == pytest.approx(h[1, 2])
        assert h[0, 1] == pytest.approx(h[1, 0])

    def test_water_never_flows_uphill(self) -> None:
        elevation = np.array([[0.0, 5.0], [5.0, 5.0]])
        depth = np.array([[1.0, 0.0], [0.0, 0.0]])  # only the LOW cell has water
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((2, 2)),
            dt_s=2.0,
            apply_infiltration=True,
        )

        # The low cell is surrounded by higher ground -- nothing to flow
        # toward, so its depth (minus any open-boundary loss) must not
        # increase, and neighbours (all higher) must gain nothing.
        assert result.state.water_depth_m[0, 1] == 0.0
        assert result.state.water_depth_m[1, 0] == 0.0
        assert result.state.water_depth_m[1, 1] == 0.0


class TestBuildingObstruction:
    """Regression tests for a real bug found and fixed during pre-implementation prototyping."""

    def test_building_cell_never_gains_depth(self) -> None:
        elevation = np.array([[2.0, 2.0, 2.0], [2.0, 1.0, 0.0], [2.0, 2.0, 2.0]])
        depth = np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]])
        building_mask = np.array(
            [[False, False, False], [False, False, True], [False, False, False]]
        )
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation, building_mask=building_mask)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=2.0,
            apply_infiltration=True,
        )

        assert result.state.water_depth_m[1, 2] == 0.0

    def test_a_building_neighbor_is_excluded_not_substituted_with_open_boundary(self) -> None:
        # The exact scenario that exposed the real bug: the only
        # lower neighbour is a building. Correct behaviour is that the
        # central cell's depth is UNCHANGED (all real neighbours are
        # higher, the only lower direction is excluded, not treated as
        # a drain) -- the buggy version leaked water toward the building
        # direction by substituting it with an open-boundary value.
        elevation = np.array([[2.0, 2.0, 2.0], [2.0, 1.0, 0.0], [2.0, 2.0, 2.0]])
        depth = np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]])
        building_mask = np.array(
            [[False, False, False], [False, False, True], [False, False, False]]
        )
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation, building_mask=building_mask)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=2.0,
            apply_infiltration=True,
        )

        assert result.state.water_depth_m[1, 1] == pytest.approx(1.0)

    def test_building_cell_never_sends_depth(self) -> None:
        elevation = np.full((3, 3), 5.0)
        elevation[1, 1] = 10.0  # a building sitting on high ground with water
        depth = np.zeros((3, 3))
        depth[1, 1] = 2.0
        building_mask = np.zeros((3, 3), dtype=bool)
        building_mask[1, 1] = True
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation, building_mask=building_mask)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=2.0,
            apply_infiltration=True,
        )

        # Buildings are excluded from being a "wet"/computable source
        # cell entirely -- neighbours must gain nothing from it.
        assert result.state.water_depth_m[0, 1] == 0.0
        assert result.state.water_depth_m[1, 0] == 0.0


class TestBoundaryOutflow:
    def test_edge_cell_loses_volume_to_boundary_ledger(self) -> None:
        elevation = np.full((3, 3), 5.0)
        elevation[0, 0] = 10.0  # a corner cell, high, with water -- open on 2 sides
        depth = np.zeros((3, 3))
        depth[0, 0] = 1.0
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=2.0,
            apply_infiltration=True,
        )

        assert result.mass_ledger.boundary_outflow_m3 > 0.0


class TestZeroState:
    def test_dry_flat_domain_produces_exactly_zero_change(self) -> None:
        elevation = np.full((3, 3), 5.0)
        depth = np.zeros((3, 3))
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=2.0,
            apply_infiltration=True,
        )

        np.testing.assert_array_equal(result.state.water_depth_m, depth)
        assert result.mass_ledger.boundary_outflow_m3 == 0.0
        assert result.mass_ledger.rainfall_input_m3 == 0.0


class TestNegativeDepthPrevention:
    @pytest.mark.parametrize("dt_s", [0.1, 1.0, 10.0, 100.0, 1000.0])
    def test_no_negative_depth_across_a_wide_range_of_timesteps(self, dt_s: float) -> None:
        elevation = np.array([[0.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 0.0]])
        depth = np.array([[0.0, 0.0, 0.0], [0.0, 0.05, 0.0], [0.0, 0.0, 0.0]])
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=dt_s,
            apply_infiltration=True,
        )

        assert (result.state.water_depth_m >= 0.0).all()


class TestAdaptiveTimestepProposal:
    def test_proposed_dt_is_within_configured_bounds(self) -> None:
        elevation = np.array([[0.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 0.0]])
        depth = np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]])
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)
        params = SolverParameters(time_mindt_s=0.5, time_maxdt_s=10.0)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=1.0,
            apply_infiltration=True,
            parameters=params,
        )

        assert 0.5 <= result.next_dt_proposed_s <= 10.0

    def test_zero_velocity_proposes_the_maximum_timestep(self) -> None:
        elevation = np.full((3, 3), 5.0)
        depth = np.zeros((3, 3))
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)
        params = SolverParameters(time_maxdt_s=42.0)

        result = step(
            state,
            domain,
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=1.0,
            apply_infiltration=True,
            parameters=params,
        )

        assert result.next_dt_proposed_s == 42.0

    def test_higher_velocity_proposes_a_smaller_timestep(self) -> None:
        gentle = np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]])
        steep = np.array([[0.0, 0.0, 0.0], [0.0, 20.0, 0.0], [0.0, 0.0, 0.0]])
        depth = np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]])
        state = SolverState(water_depth_m=depth)

        gentle_result = step(
            state,
            _domain(gentle),
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=0.5,
            apply_infiltration=True,
        )
        steep_result = step(
            state,
            _domain(steep),
            0.0,
            _zero_infiltration((3, 3)),
            dt_s=0.5,
            apply_infiltration=True,
        )

        assert steep_result.next_dt_proposed_s <= gentle_result.next_dt_proposed_s


class TestRainfallAndInfiltration:
    def test_rainfall_increases_depth_on_a_flat_dry_domain(self) -> None:
        elevation = np.full((2, 2), 5.0)
        state = SolverState(water_depth_m=np.zeros((2, 2)))
        domain = _domain(elevation)

        result = step(
            state,
            domain,
            rainfall_rate_mm_per_hr=36.0,
            infiltration_loss_mm_per_hr=_zero_infiltration((2, 2)),
            dt_s=3600.0,
            apply_infiltration=True,
        )

        # 36 mm/hr for exactly one hour -> 0.036 m added, uniformly, no
        # redistribution on a flat domain.
        np.testing.assert_allclose(result.state.water_depth_m, 0.036)

    def test_infiltration_never_drives_depth_negative(self) -> None:
        elevation = np.full((2, 2), 5.0)
        state = SolverState(water_depth_m=np.full((2, 2), 0.01))
        domain = _domain(elevation)
        infiltration = np.full((2, 2), 3600.0)  # a deliberately huge rate

        result = step(
            state,
            domain,
            rainfall_rate_mm_per_hr=0.0,
            infiltration_loss_mm_per_hr=infiltration,
            dt_s=3600.0,
            apply_infiltration=True,
        )

        assert (result.state.water_depth_m >= 0.0).all()

    def test_rainfall_and_infiltration_do_not_apply_to_building_cells(self) -> None:
        elevation = np.full((2, 2), 5.0)
        building_mask = np.array([[True, False], [False, False]])
        state = SolverState(water_depth_m=np.zeros((2, 2)))
        domain = _domain(elevation, building_mask=building_mask)

        result = step(
            state,
            domain,
            rainfall_rate_mm_per_hr=100.0,
            infiltration_loss_mm_per_hr=_zero_infiltration((2, 2)),
            dt_s=3600.0,
            apply_infiltration=True,
        )

        assert result.state.water_depth_m[0, 0] == 0.0
        assert result.state.water_depth_m[0, 1] > 0.0


class TestInfiltrationCadence:
    """Covers the ``apply_infiltration``/``infiltration_period_s`` cadence fix.

    Added after the Numerical Fidelity Audit found VEKTRA was applying
    infiltration every adaptive substep, whereas the real reference
    (``CADDIES2D.cpp``) applies it only periodically, using a rate
    pre-scaled by the period duration rather than the fine substep ``dt``.
    The controller (future ``core.timestepping``) decides *when*
    infiltration applies; the solver still performs the numerical removal.
    """

    def test_apply_infiltration_false_skips_infiltration_entirely(self) -> None:
        # 3x3, flat, checked at the CENTER cell only: the center has all 4
        # real neighbours (no off-grid substitution), so on a flat domain
        # it experiences zero redistribution -- isolating infiltration's
        # effect cleanly. (An edge/corner cell would also see boundary
        # outflow from the open-boundary convention even when flat, since
        # delwl = h > tol_delwl against the substituted boundary level --
        # that would confound this test with redistribution, not infiltration.)
        elevation = np.full((3, 3), 5.0)
        depth = np.full((3, 3), 1.0)
        infiltration = np.full((3, 3), 3600.0)  # deliberately huge rate
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        result = step(
            state,
            domain,
            0.0,
            infiltration,
            dt_s=10.0,
            apply_infiltration=False,
        )

        assert result.state.water_depth_m[1, 1] == depth[1, 1]
        assert result.mass_ledger.infiltration_loss_m3 == 0.0

    def test_infiltration_period_s_scales_removed_depth_not_dt_s(self) -> None:
        elevation = np.full((3, 3), 5.0)
        depth = np.full((3, 3), 1.0)  # flat, plenty of depth -- avoids the depth cap
        infiltration = np.full((3, 3), 360.0)  # mm/hr
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        short_period = step(
            state,
            domain,
            0.0,
            infiltration,
            dt_s=10.0,
            apply_infiltration=True,
            infiltration_period_s=10.0,
        )
        long_period = step(
            state,
            domain,
            0.0,
            infiltration,
            dt_s=10.0,
            apply_infiltration=True,
            infiltration_period_s=100.0,
        )

        short_removed = float(depth[1, 1] - short_period.state.water_depth_m[1, 1])
        long_removed = float(depth[1, 1] - long_period.state.water_depth_m[1, 1])
        assert short_removed > 0.0
        assert long_removed == pytest.approx(short_removed * 10.0, rel=1e-9)

    def test_infiltration_period_defaults_to_dt_s_when_not_specified(self) -> None:
        elevation = np.full((2, 2), 5.0)
        depth = np.full((2, 2), 1.0)
        infiltration = np.full((2, 2), 360.0)
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        implicit = step(
            state,
            domain,
            0.0,
            infiltration,
            dt_s=10.0,
            apply_infiltration=True,
        )
        explicit = step(
            state,
            domain,
            0.0,
            infiltration,
            dt_s=10.0,
            apply_infiltration=True,
            infiltration_period_s=10.0,
        )

        np.testing.assert_array_equal(
            implicit.state.water_depth_m, explicit.state.water_depth_m
        )
        assert implicit.mass_ledger.infiltration_loss_m3 == pytest.approx(
            explicit.mass_ledger.infiltration_loss_m3
        )


class TestDeterminism:
    def test_identical_inputs_produce_identical_output(self) -> None:
        elevation = np.array([[3.0, 2.0, 1.0], [3.0, 2.0, 1.0], [3.0, 2.0, 1.0]])
        depth = np.array([[0.0, 0.5, 0.0], [0.0, 0.5, 0.0], [0.0, 0.5, 0.0]])
        state = SolverState(water_depth_m=depth)
        domain = _domain(elevation)

        result_a = step(
            state,
            domain,
            5.0,
            _zero_infiltration((3, 3)),
            dt_s=1.5,
            apply_infiltration=True,
        )
        result_b = step(
            state,
            domain,
            5.0,
            _zero_infiltration((3, 3)),
            dt_s=1.5,
            apply_infiltration=True,
        )

        np.testing.assert_array_equal(result_a.state.water_depth_m, result_b.state.water_depth_m)
        assert result_a.next_dt_proposed_s == result_b.next_dt_proposed_s
