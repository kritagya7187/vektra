"""Unit tests for flood_engine.api.schemas.simulation.

Pure Pydantic/NumPy, no I/O, no HTTP. Verifies these are faithful,
lossless mirrors of the domain types they wrap (field values, NaN->null
conversion) plus the immutability discipline the rest of this codebase
applies to every domain object.
"""

import math

import numpy as np
import pytest
from pydantic import ValidationError

from flood_engine.api.schemas.simulation import FloodOutputSummarySchema, MassLedgerSchema
from flood_engine.core.state import MassLedger
from flood_engine.output.generator import FloodOutputSummary


class TestMassLedgerSchema:
    def test_from_domain_mirrors_every_field(self) -> None:
        ledger = MassLedger(
            rainfall_input_m3=10.0, infiltration_loss_m3=2.5, boundary_outflow_m3=1.0
        )

        schema = MassLedgerSchema.from_domain(ledger)

        assert schema.rainfall_input_m3 == 10.0
        assert schema.infiltration_loss_m3 == 2.5
        assert schema.boundary_outflow_m3 == 1.0

    def test_is_frozen(self) -> None:
        schema = MassLedgerSchema(
            rainfall_input_m3=1.0, infiltration_loss_m3=0.0, boundary_outflow_m3=0.0
        )

        with pytest.raises(ValidationError):
            schema.rainfall_input_m3 = 999.0


class TestFloodOutputSummarySchema:
    def _summary(self) -> FloodOutputSummary:
        return FloodOutputSummary(
            max_depth_m=np.array([[0.1, 0.2], [0.3, 0.0]]),
            arrival_time_min=np.array([[1.0, np.nan], [2.0, np.nan]]),
            duration_above_threshold_min=np.array([[5.0, 0.0], [10.0, 0.0]]),
            mass_ledger=MassLedger(
                rainfall_input_m3=100.0, infiltration_loss_m3=20.0, boundary_outflow_m3=5.0
            ),
            step_count=3,
            simulated_duration_s=180.0,
        )

    def test_from_domain_mirrors_scalar_and_nested_fields(self) -> None:
        summary = self._summary()

        schema = FloodOutputSummarySchema.from_domain(summary)

        assert schema.max_depth_m == [[0.1, 0.2], [0.3, 0.0]]
        assert schema.duration_above_threshold_min == [[5.0, 0.0], [10.0, 0.0]]
        assert schema.step_count == 3
        assert schema.simulated_duration_s == 180.0
        assert schema.mass_ledger.rainfall_input_m3 == 100.0
        assert schema.mass_ledger.infiltration_loss_m3 == 20.0
        assert schema.mass_ledger.boundary_outflow_m3 == 5.0

    def test_nan_arrival_time_becomes_none_not_left_as_nan(self) -> None:
        summary = self._summary()

        schema = FloodOutputSummarySchema.from_domain(summary)

        assert schema.arrival_time_min == [[1.0, None], [2.0, None]]
        # A raw NaN would break json.dumps() strictness / round-trip
        # through a real HTTP response body -- confirm none survived.
        flat = [value for row in schema.arrival_time_min for value in row]
        assert not any(value is not None and math.isnan(value) for value in flat)

    def test_serializes_to_json_without_error(self) -> None:
        # The whole point of the NaN->None conversion: this must not raise,
        # unlike a raw NaN would under strict JSON serialization.
        schema = FloodOutputSummarySchema.from_domain(self._summary())

        serialized = schema.model_dump_json()

        assert "NaN" not in serialized
        assert "null" in serialized

    def test_is_frozen(self) -> None:
        schema = FloodOutputSummarySchema.from_domain(self._summary())

        with pytest.raises(ValidationError):
            schema.step_count = 999
