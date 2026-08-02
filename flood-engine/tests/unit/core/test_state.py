"""Unit tests for flood_engine.core.state."""

import numpy as np
import pytest

from flood_engine.core.state import MassLedger, SolverState, SolverStateError


class TestSolverState:
    def test_valid_construction(self) -> None:
        state = SolverState(water_depth_m=np.array([[0.0, 1.0], [2.0, 0.5]]))

        assert state.height == 2
        assert state.width == 2

    def test_rejects_non_2d_array(self) -> None:
        with pytest.raises(SolverStateError, match="2D"):
            SolverState(water_depth_m=np.zeros((2, 2, 2)))

    def test_rejects_non_finite_values(self) -> None:
        with pytest.raises(SolverStateError, match="non-finite"):
            SolverState(water_depth_m=np.array([[0.0, np.nan]]))

    def test_rejects_negative_depth(self) -> None:
        with pytest.raises(SolverStateError, match="negative"):
            SolverState(water_depth_m=np.array([[0.0, -0.1]]))

    def test_zero_depth_is_valid(self) -> None:
        state = SolverState(water_depth_m=np.zeros((3, 3)))

        assert state.water_depth_m.sum() == 0.0

    def test_backing_array_is_read_only(self) -> None:
        state = SolverState(water_depth_m=np.array([[0.0, 1.0]]))

        with pytest.raises(ValueError, match="read-only"):
            state.water_depth_m[0, 0] = 5.0

    def test_reassigning_attribute_raises(self) -> None:
        state = SolverState(water_depth_m=np.array([[0.0]]))

        with pytest.raises(AttributeError):
            state.water_depth_m = np.array([[1.0]])  # type: ignore[misc]


class TestMassLedger:
    """Moved here from ``core.solver.wca2d`` at the Step 14 freeze review --

    a neutral home so ``simulation.controller``/``output.generator`` (and
    future persistence/API/validation/visualization layers) don't acquire
    an unnecessary dependency on the solver module just for this data
    type. A pure relocation: fields and semantics unchanged, so this test
    class simply confirms the type still behaves as every prior module's
    tests already exercised it doing (construction, field access,
    immutability) now that it's defined here instead.
    """

    def test_valid_construction_and_field_access(self) -> None:
        ledger = MassLedger(
            rainfall_input_m3=10.0, infiltration_loss_m3=2.0, boundary_outflow_m3=1.5
        )

        assert ledger.rainfall_input_m3 == 10.0
        assert ledger.infiltration_loss_m3 == 2.0
        assert ledger.boundary_outflow_m3 == 1.5

    def test_reassigning_attribute_raises(self) -> None:
        ledger = MassLedger(
            rainfall_input_m3=10.0, infiltration_loss_m3=2.0, boundary_outflow_m3=1.5
        )

        with pytest.raises(AttributeError):
            ledger.rainfall_input_m3 = 999.0  # type: ignore[misc]
