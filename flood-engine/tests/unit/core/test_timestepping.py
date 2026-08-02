"""Unit tests for flood_engine.core.timestepping.

Pure NumPy, no I/O. Tests only the public contract (:func:`run_simulation`,
:class:`TimesteppingParameters`) -- consistent with this project's existing
convention (see ``test_wca2d.py``) of never importing underscore-prefixed
helpers directly, even when a behaviour (like rainfall interpolation) is
implemented in one.

**A real physical fact this file's test design has to account for**: a flat
elevation grid does NOT keep the solver's diagnostic velocity at zero once
any cell is wet. The open-boundary convention (``H_boundary = z_center``,
see ``core/solver/wca2d.py``) substitutes an off-grid neighbor's water
level with the *central cell's own elevation*, not its own water level --
so any positive depth at a domain edge is itself an artificial downhill
gradient, independent of terrain slope. A flat *and dry* domain has zero
velocity forever (nothing is wet, so nothing flows); a flat domain that
becomes wet does not, because boundary-adjacent cells immediately start
draining. Tests below use two domain shapes accordingly: a plain flat
domain where the state stays dry the whole run (deterministic for any
number of steps), and an "isolated interior cell" domain (every cell is a
building except the center) where the sole open cell has no real or
off-grid neighbors at all -- deterministic even when wet, since it can
never send or receive flow regardless of depth.
"""

import numpy as np
import pytest

from flood_engine.core.solver.wca2d import DomainInputs, SolverParameters
from flood_engine.core.state import SolverState
from flood_engine.core.timestepping import (
    TimesteppingError,
    TimesteppingParameters,
    run_simulation,
)


def _flat_domain(shape: tuple[int, int] = (3, 3)) -> DomainInputs:
    return DomainInputs(
        elevation_m=np.full(shape, 5.0),
        building_mask=np.zeros(shape, dtype=bool),
        manning_n=np.full(shape, 0.03),
    )


def _isolated_interior_domain(shape: tuple[int, int] = (3, 3)) -> DomainInputs:
    """Every cell is a building except the center -- the center has no real

    or off-grid neighbors it can exchange flow with, so its diagnostic
    velocity is exactly zero regardless of its own depth. Used wherever a
    test needs several *wet* steps with a fully predictable timestep.
    """
    building_mask = np.ones(shape, dtype=bool)
    building_mask[shape[0] // 2, shape[1] // 2] = False
    return DomainInputs(
        elevation_m=np.full(shape, 5.0),
        building_mask=building_mask,
        manning_n=np.full(shape, 0.03),
    )


def _dry_state(shape: tuple[int, int] = (3, 3)) -> SolverState:
    return SolverState(water_depth_m=np.zeros(shape))


class TestTimesteppingParametersValidation:
    def test_default_matches_frozen_specification(self) -> None:
        params = TimesteppingParameters()

        assert params.infiltration_interval_s == 60.0

    def test_rejects_non_positive_infiltration_interval(self) -> None:
        with pytest.raises(TimesteppingError, match="infiltration_interval_s"):
            TimesteppingParameters(infiltration_interval_s=0.0)


class TestRunSimulationInputValidation:
    def test_rejects_empty_rainfall_array(self) -> None:
        with pytest.raises(TimesteppingError, match="rainfall_rates_mm_per_hr"):
            run_simulation(
                initial_state=_dry_state(),
                domain=_flat_domain(),
                rainfall_rates_mm_per_hr=np.array([]),
                infiltration_loss_mm_per_hr=np.zeros((3, 3)),
            )

    def test_rejects_non_positive_total_duration_override(self) -> None:
        with pytest.raises(TimesteppingError, match="total_duration_s"):
            run_simulation(
                initial_state=_dry_state(),
                domain=_flat_domain(),
                rainfall_rates_mm_per_hr=np.array([0.0]),
                infiltration_loss_mm_per_hr=np.zeros((3, 3)),
                total_duration_s=0.0,
            )


class TestStoppingCriteria:
    def test_default_duration_is_forcing_duration_plus_recession_tail(self) -> None:
        # One hourly bucket -> 3600s forcing duration; +4h recession tail = 18000s.
        # time_maxdt_s=1800 with a flat (zero-velocity) domain keeps dt pinned
        # at 1800s every step, giving an exact, predictable step count.
        params = SolverParameters(time_maxdt_s=1800.0)

        records = run_simulation(
            initial_state=_dry_state(),
            domain=_flat_domain(),
            rainfall_rates_mm_per_hr=np.array([0.0]),
            infiltration_loss_mm_per_hr=np.zeros((3, 3)),
            solver_parameters=params,
        )

        assert len(records) == 10  # 18000s / 1800s
        assert records[-1].elapsed_s == pytest.approx(18000.0)

    def test_total_duration_override_is_respected(self) -> None:
        records = run_simulation(
            initial_state=_dry_state(),
            domain=_flat_domain(),
            rainfall_rates_mm_per_hr=np.array([0.0]),
            infiltration_loss_mm_per_hr=np.zeros((3, 3)),
            total_duration_s=250.0,
        )

        assert records[-1].elapsed_s == pytest.approx(250.0)

    def test_final_step_is_clamped_and_never_overshoots(self) -> None:
        # Default dt bootstrap is time_maxdt_s=60.0; 250s is not a multiple
        # of 60, so the final step must be clamped to the 10s remainder.
        records = run_simulation(
            initial_state=_dry_state(),
            domain=_flat_domain(),
            rainfall_rates_mm_per_hr=np.array([0.0]),
            infiltration_loss_mm_per_hr=np.zeros((3, 3)),
            total_duration_s=250.0,
        )

        elapsed = [0.0, *[r.elapsed_s for r in records]]
        dt_used = [b - a for a, b in zip(elapsed, elapsed[1:], strict=False)]

        assert dt_used[:-1] == [pytest.approx(60.0)] * (len(dt_used) - 1)
        assert dt_used[-1] == pytest.approx(10.0)
        assert records[-1].elapsed_s == pytest.approx(250.0)

    def test_initial_dt_s_override_controls_the_first_step(self) -> None:
        records = run_simulation(
            initial_state=_dry_state(),
            domain=_flat_domain(),
            rainfall_rates_mm_per_hr=np.array([0.0]),
            infiltration_loss_mm_per_hr=np.zeros((3, 3)),
            total_duration_s=1000.0,
            initial_dt_s=25.0,
        )

        assert records[0].elapsed_s == pytest.approx(25.0)


class TestInfiltrationCadence:
    def test_infiltration_applies_only_once_the_interval_has_elapsed(self) -> None:
        # The isolated-interior domain keeps velocity at exactly zero
        # regardless of depth, so dt is pinned to time_maxdt_s=60 for every
        # step (not just while dry) -- interval=150s means the accumulated
        # time crosses the threshold on the 3rd step (60+60+60=180 >= 150),
        # not every step.
        domain = _isolated_interior_domain()
        infiltration = np.full((3, 3), 36.0)  # mm/hr, small relative to depth=1.0

        records = run_simulation(
            initial_state=SolverState(water_depth_m=np.full((3, 3), 1.0)),
            domain=domain,
            rainfall_rates_mm_per_hr=np.array([0.0]),
            infiltration_loss_mm_per_hr=infiltration,
            timestepping_parameters=TimesteppingParameters(infiltration_interval_s=150.0),
            total_duration_s=300.0,
        )

        infiltration_applied = [r.result.mass_ledger.infiltration_loss_m3 > 0.0 for r in records]

        assert infiltration_applied == [False, False, True, False, False]

    def test_infiltration_period_reflects_accumulated_elapsed_time(self) -> None:
        # Same setup as above: infiltration on step 3 should be scaled by
        # the accumulated 180s, not the single 60s substep -- confirmed by
        # comparing against a direct expectation from the removal formula
        # (min(depth, rate/1000 * period/3600)), not merely "> 0".
        domain = _isolated_interior_domain()
        infiltration = np.full((3, 3), 36.0)  # mm/hr

        records = run_simulation(
            initial_state=SolverState(water_depth_m=np.full((3, 3), 1.0)),
            domain=domain,
            rainfall_rates_mm_per_hr=np.array([0.0]),
            infiltration_loss_mm_per_hr=infiltration,
            timestepping_parameters=TimesteppingParameters(infiltration_interval_s=150.0),
            total_duration_s=300.0,
        )

        cell_area_m2 = 30.0 * 30.0
        expected_removed_depth = (36.0 / 1000.0) * (180.0 / 3600.0)
        expected_infiltration_m3 = expected_removed_depth * cell_area_m2 * 1  # sole open cell

        assert records[2].result.mass_ledger.infiltration_loss_m3 == pytest.approx(
            expected_infiltration_m3
        )

    def test_partial_accrual_at_run_end_is_not_applied(self) -> None:
        # interval=1000s, but the whole run is only 180s -- infiltration
        # should never fire, and nothing should be silently applied at the
        # end either.
        domain = _isolated_interior_domain()
        infiltration = np.full((3, 3), 36.0)

        records = run_simulation(
            initial_state=SolverState(water_depth_m=np.full((3, 3), 1.0)),
            domain=domain,
            rainfall_rates_mm_per_hr=np.array([0.0]),
            infiltration_loss_mm_per_hr=infiltration,
            timestepping_parameters=TimesteppingParameters(infiltration_interval_s=1000.0),
            total_duration_s=180.0,
        )

        assert all(r.result.mass_ledger.infiltration_loss_m3 == 0.0 for r in records)


class TestRainfallSubstepMapping:
    def test_rate_is_piecewise_constant_across_hours_then_zero_in_the_recession_tail(
        self,
    ) -> None:
        # rates=[100, 500] mm/hr; time_maxdt_s=3600 pins each step to exactly
        # one hour PROVIDED velocity stays zero across all three steps, which
        # requires the isolated-interior domain (a plain flat domain would
        # start draining through the open boundary as soon as it gets wet --
        # see the module docstring). Landings: t=0 (first hour's rate, held
        # constant for the whole hour), t=3600 (second hour's rate, held
        # constant), and t=7200 (past the 7200s covered duration -- forced
        # to zero, the recession tail).
        params = SolverParameters(time_maxdt_s=3600.0)
        cell_area_m2 = 30.0 * 30.0
        cell_count = 1  # isolated-interior domain: only the center cell is open

        records = run_simulation(
            initial_state=_dry_state(),
            domain=_isolated_interior_domain(),
            rainfall_rates_mm_per_hr=np.array([100.0, 500.0]),
            infiltration_loss_mm_per_hr=np.zeros((3, 3)),
            solver_parameters=params,
            total_duration_s=10800.0,  # exactly 3 steps of 3600s
        )

        assert len(records) == 3
        expected_depths_m = [
            (100.0 / 1000.0) * (3600.0 / 3600.0),  # t=0, first hour's rate
            (500.0 / 1000.0) * (3600.0 / 3600.0),  # t=3600, second hour's rate
            0.0,  # t=7200, past covered duration -- recession tail
        ]
        for record, expected_depth_m in zip(records, expected_depths_m, strict=True):
            expected_m3 = expected_depth_m * cell_area_m2 * cell_count
            assert record.result.mass_ledger.rainfall_input_m3 == pytest.approx(expected_m3)

    def test_rate_switches_discontinuously_not_gradually_at_an_hour_boundary(self) -> None:
        # rates=[0, 3600]; a step landing exactly at t=1800 (halfway through
        # the first hour) must still see the FIRST hour's rate (0 mm/hr) --
        # piecewise-constant, not a midpoint blend of the two hours. This is
        # the direct behavioural contrast with the reverted linear-
        # interpolation design, which would have produced 1800 mm/hr here.
        params = SolverParameters(time_maxdt_s=1800.0)

        records = run_simulation(
            initial_state=_dry_state(),
            domain=_flat_domain(),
            rainfall_rates_mm_per_hr=np.array([0.0, 3600.0]),
            infiltration_loss_mm_per_hr=np.zeros((3, 3)),
            solver_parameters=params,
            total_duration_s=3600.0,  # exactly 2 steps of 1800s
        )

        assert len(records) == 2
        # Step 0 (t=0..1800): first hour's rate (0 mm/hr) -> no rainfall.
        assert records[0].result.mass_ledger.rainfall_input_m3 == pytest.approx(0.0)
        # Step 1 (t=1800..3600): STILL the first hour's rate (0 mm/hr) --
        # the lookup at t=1800 is still within hour 0, not the second hour.
        assert records[1].result.mass_ledger.rainfall_input_m3 == pytest.approx(0.0)

    def test_per_hour_rainfall_volume_is_conserved_exactly(self) -> None:
        """The property this scheme exists to guarantee -- a permanent regression test.

        A numerical-fidelity review found that an earlier linear-
        interpolation design violated this by over 100% in a single
        interval for a realistic rate sequence (verified both
        algebraically and empirically before reverting to
        piecewise-constant). This test is the permanent guardrail against
        that regressing: for every whole hour fully covered by the run,
        the total rainfall volume applied across all substeps landing in
        that hour must equal ``rate * 3600s`` exactly (to floating-point
        precision), regardless of how many substeps of what size the
        adaptive solver used to cover it.

        ``time_maxdt_s=900`` divides 3600 evenly (4 substeps/hour) so no
        substep straddles an hour boundary -- exactness is unconditional
        here. A substep that *does* straddle a boundary uses its start
        hour's rate for its own full duration (matching the reference's
        own per-call rate lookup), which is a separate, much smaller,
        bounded residual documented directly on ``_rainfall_rate_at``
        (at most one substep's duration misattributed per crossing) --
        not exercised by this test, which isolates the property that was
        actually found broken.
        """
        rates = np.array([10.0, 40.0, 5.0, 20.0])
        domain = _isolated_interior_domain()
        cell_area_m2 = 30.0 * 30.0

        params = SolverParameters(time_maxdt_s=900.0)

        records = run_simulation(
            initial_state=_dry_state(),
            domain=domain,
            rainfall_rates_mm_per_hr=rates,
            infiltration_loss_mm_per_hr=np.zeros((3, 3)),
            solver_parameters=params,
            total_duration_s=float(len(rates) * 3600),
        )

        elapsed = [0.0, *[r.elapsed_s for r in records]]
        starts = elapsed[:-1]
        volume_by_hour = np.zeros(len(rates))
        for start, record in zip(starts, records, strict=True):
            hour_index = int(start // 3600.0)
            volume_by_hour[hour_index] += record.result.mass_ledger.rainfall_input_m3

        expected_volume_by_hour = rates / 1000.0 * cell_area_m2  # mm/hr over 1hr -> m -> m3
        np.testing.assert_allclose(volume_by_hour, expected_volume_by_hour, rtol=1e-9)


class TestDeterminism:
    def test_identical_inputs_produce_identical_output(self) -> None:
        kwargs = dict(
            initial_state=SolverState(water_depth_m=np.full((3, 3), 0.2)),
            domain=_flat_domain(),
            rainfall_rates_mm_per_hr=np.array([10.0, 5.0]),
            infiltration_loss_mm_per_hr=np.full((3, 3), 2.0),
            total_duration_s=300.0,
        )

        records_a = run_simulation(**kwargs)
        records_b = run_simulation(**kwargs)

        assert len(records_a) == len(records_b)
        for record_a, record_b in zip(records_a, records_b, strict=True):
            assert record_a.elapsed_s == record_b.elapsed_s
            np.testing.assert_array_equal(
                record_a.result.state.water_depth_m, record_b.result.state.water_depth_m
            )


class TestStateProgression:
    def test_state_carries_forward_between_steps(self) -> None:
        # A steep single-peak domain (already exercised in isolation by
        # test_wca2d.py) redistributes water each step -- confirms this
        # module actually feeds each step's output back in as the next
        # step's input, rather than re-using the initial state.
        elevation = np.array([[0.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 0.0]])
        domain = DomainInputs(
            elevation_m=elevation,
            building_mask=np.zeros((3, 3), dtype=bool),
            manning_n=np.full((3, 3), 0.03),
        )
        depth = np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]])

        records = run_simulation(
            initial_state=SolverState(water_depth_m=depth),
            domain=domain,
            rainfall_rates_mm_per_hr=np.array([0.0]),
            infiltration_loss_mm_per_hr=np.zeros((3, 3)),
            total_duration_s=120.0,
        )

        depths = [depth[1, 1], *[r.result.state.water_depth_m[1, 1] for r in records]]
        # The peak cell must keep decreasing (or hold, once it runs dry) --
        # never jump back up to the initial value, which is what a bug that
        # discarded intermediate state and always started from t=0 again
        # would produce.
        pairs = zip(depths, depths[1:], strict=False)
        assert all(later <= earlier + 1e-12 for earlier, later in pairs)
