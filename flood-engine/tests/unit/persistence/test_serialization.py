"""Unit tests for flood_engine.persistence.serialization.

Pure Python + filesystem (``tmp_path``) -- no PostgreSQL. Verifies exact
round-trips: what goes in via a ``serialize_*``/``write_*`` function comes
back byte-for-byte (or value-for-value) equal via the matching
``deserialize_*``/``read_*`` function.
"""

from pathlib import Path

import numpy as np

from flood_engine.core.state import MassLedger
from flood_engine.output.generator import FloodOutputSummary
from flood_engine.persistence.serialization import (
    deserialize_mass_ledger,
    output_array_paths,
    read_array,
    read_output_summary,
    serialize_mass_ledger,
    write_array,
    write_output_arrays,
)


class TestMassLedgerSerialization:
    def test_round_trips_exactly(self) -> None:
        ledger = MassLedger(
            rainfall_input_m3=123.456, infiltration_loss_m3=7.89, boundary_outflow_m3=0.001
        )

        payload = serialize_mass_ledger(ledger)
        restored = deserialize_mass_ledger(payload)

        assert restored == ledger

    def test_serialized_form_is_valid_json(self) -> None:
        ledger = MassLedger(
            rainfall_input_m3=1.0, infiltration_loss_m3=2.0, boundary_outflow_m3=3.0
        )

        payload = serialize_mass_ledger(ledger)

        assert '"rainfall_input_m3": 1.0' in payload


class TestArraySerialization:
    def test_round_trips_exactly(self, tmp_path: Path) -> None:
        array = np.array([[1.0, 2.0], [np.nan, 4.0]])
        path = tmp_path / "array.npy"

        write_array(array, path)
        restored = read_array(path)

        np.testing.assert_array_equal(restored, array)

    def test_creates_parent_directories(self, tmp_path: Path) -> None:
        array = np.zeros((2, 2))
        path = tmp_path / "nested" / "dir" / "array.npy"

        write_array(array, path)

        assert path.exists()
        np.testing.assert_array_equal(read_array(path), array)


class TestOutputArrayPaths:
    def test_returns_three_distinct_npy_paths_under_a_per_run_subdirectory(
        self, tmp_path: Path
    ) -> None:
        paths = output_array_paths(tmp_path, "run-1")

        assert set(paths.keys()) == {"max_depth", "arrival_time", "duration_above_threshold"}
        assert len({str(p) for p in paths.values()}) == 3
        assert all(p.parent == tmp_path / "run-1" for p in paths.values())
        assert all(p.suffix == ".npy" for p in paths.values())


class TestOutputSummaryRoundTrip:
    def test_write_then_read_reproduces_the_summary_exactly(self, tmp_path: Path) -> None:
        summary = FloodOutputSummary(
            max_depth_m=np.array([[0.1, 0.2], [0.3, 0.4]]),
            arrival_time_min=np.array([[1.0, np.nan], [2.0, np.nan]]),
            duration_above_threshold_min=np.array([[5.0, 0.0], [10.0, 0.0]]),
            mass_ledger=MassLedger(
                rainfall_input_m3=100.0, infiltration_loss_m3=20.0, boundary_outflow_m3=5.0
            ),
            step_count=3,
            simulated_duration_s=180.0,
        )

        locations = write_output_arrays(summary, base_dir=tmp_path, run_id="run-1")
        ledger_json = serialize_mass_ledger(summary.mass_ledger)
        restored = read_output_summary(
            max_depth_location=locations["max_depth"],
            arrival_time_location=locations["arrival_time"],
            duration_above_threshold_location=locations["duration_above_threshold"],
            mass_ledger_json=ledger_json,
            step_count=summary.step_count,
            simulated_duration_s=summary.simulated_duration_s,
        )

        np.testing.assert_array_equal(restored.max_depth_m, summary.max_depth_m)
        np.testing.assert_array_equal(
            restored.arrival_time_min, summary.arrival_time_min
        )  # NaN-aware equality
        np.testing.assert_array_equal(
            restored.duration_above_threshold_min, summary.duration_above_threshold_min
        )
        assert restored.mass_ledger == summary.mass_ledger
        assert restored.step_count == summary.step_count
        assert restored.simulated_duration_s == summary.simulated_duration_s

    def test_written_locations_are_distinct_files_on_disk(self, tmp_path: Path) -> None:
        summary = FloodOutputSummary(
            max_depth_m=np.zeros((2, 2)),
            arrival_time_min=np.full((2, 2), np.nan),
            duration_above_threshold_min=np.zeros((2, 2)),
            mass_ledger=MassLedger(
                rainfall_input_m3=0.0, infiltration_loss_m3=0.0, boundary_outflow_m3=0.0
            ),
            step_count=1,
            simulated_duration_s=1.0,
        )

        locations = write_output_arrays(summary, base_dir=tmp_path, run_id="run-2")

        for location in locations.values():
            assert Path(location).exists()
