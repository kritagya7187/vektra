"""Unit tests for flood_engine.persistence.models."""

from datetime import UTC, datetime

import pytest

from flood_engine.jobs.models import JobStatus
from flood_engine.persistence.models import SimulationOutputRow, SimulationRunRow


class TestSimulationRunRow:
    def test_valid_construction_and_field_access(self) -> None:
        now = datetime.now(UTC)
        row = SimulationRunRow(
            id="run-1",
            scenario_id="scenario-1",
            status=JobStatus.PENDING,
            elevation_path="/data/elevation.npy",
            building_mask_path="/data/mask.npy",
            manning_n_path="/data/manning.npy",
            infiltration_loss_path="/data/infiltration.npy",
            rainfall_rates_path="/data/rainfall.npy",
            solver_parameters_json=None,
            timestepping_parameters_json=None,
            worker_id=None,
            attempt_count=0,
            created_at=now,
            started_at=None,
            completed_at=None,
            cancelled_at=None,
            error_message=None,
            updated_at=now,
            aoi_west=None,
            aoi_south=None,
            aoi_east=None,
            aoi_north=None,
            elevation_transform_json=None,
            elevation_crs_epsg=None,
        )

        assert row.id == "run-1"
        assert row.status is JobStatus.PENDING
        assert row.attempt_count == 0

    def test_reassigning_attribute_raises(self) -> None:
        now = datetime.now(UTC)
        row = SimulationRunRow(
            id="run-1",
            scenario_id="scenario-1",
            status=JobStatus.PENDING,
            elevation_path="/data/elevation.npy",
            building_mask_path="/data/mask.npy",
            manning_n_path="/data/manning.npy",
            infiltration_loss_path="/data/infiltration.npy",
            rainfall_rates_path="/data/rainfall.npy",
            solver_parameters_json=None,
            timestepping_parameters_json=None,
            worker_id=None,
            attempt_count=0,
            created_at=now,
            started_at=None,
            completed_at=None,
            cancelled_at=None,
            error_message=None,
            updated_at=now,
            aoi_west=None,
            aoi_south=None,
            aoi_east=None,
            aoi_north=None,
            elevation_transform_json=None,
            elevation_crs_epsg=None,
        )

        with pytest.raises(AttributeError):
            row.status = JobStatus.RUNNING  # type: ignore[misc]


class TestSimulationOutputRow:
    def test_valid_construction_and_field_access(self) -> None:
        now = datetime.now(UTC)
        row = SimulationOutputRow(
            run_id="run-1",
            max_depth_location="/out/max_depth.npy",
            arrival_time_location="/out/arrival_time.npy",
            duration_above_threshold_location="/out/duration.npy",
            mass_ledger_json='{"rainfall_input_m3": 1.0}',
            step_count=5,
            simulated_duration_s=120.0,
            max_depth_geotiff_path=None,
            arrival_time_geotiff_path=None,
            duration_geotiff_path=None,
            created_at=now,
        )

        assert row.run_id == "run-1"
        assert row.step_count == 5
        assert row.simulated_duration_s == 120.0

    def test_reassigning_attribute_raises(self) -> None:
        now = datetime.now(UTC)
        row = SimulationOutputRow(
            run_id="run-1",
            max_depth_location="/out/max_depth.npy",
            arrival_time_location="/out/arrival_time.npy",
            duration_above_threshold_location="/out/duration.npy",
            mass_ledger_json="{}",
            step_count=1,
            simulated_duration_s=1.0,
            max_depth_geotiff_path=None,
            arrival_time_geotiff_path=None,
            duration_geotiff_path=None,
            created_at=now,
        )

        with pytest.raises(AttributeError):
            row.step_count = 999  # type: ignore[misc]
