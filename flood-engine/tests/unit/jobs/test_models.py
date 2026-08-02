"""Unit tests for flood_engine.jobs.models."""

import numpy as np
import pytest

from flood_engine.jobs.models import ClaimedJob, JobStatus


class TestJobStatus:
    def test_is_exactly_the_five_frozen_states(self) -> None:
        assert {member.value for member in JobStatus} == {
            "pending",
            "running",
            "completed",
            "failed",
            "cancelled",
        }

    def test_members_compare_equal_to_their_string_value(self) -> None:
        # StrEnum -- persistence layers can compare/store these as plain
        # strings without an explicit .value access.
        assert JobStatus.PENDING == "pending"
        assert JobStatus.RUNNING == "running"
        assert JobStatus.COMPLETED == "completed"
        assert JobStatus.FAILED == "failed"
        assert JobStatus.CANCELLED == "cancelled"


class TestClaimedJob:
    def test_valid_construction_and_field_access(self) -> None:
        shape = (2, 2)
        job = ClaimedJob(
            run_id="run-1",
            elevation_m=np.full(shape, 5.0),
            building_mask=np.zeros(shape, dtype=bool),
            manning_n=np.full(shape, 0.03),
            infiltration_loss_mm_per_hr=np.zeros(shape),
            rainfall_rates_mm_per_hr=np.array([0.0]),
        )

        assert job.run_id == "run-1"
        assert job.solver_parameters is None
        assert job.timestepping_parameters is None
        np.testing.assert_array_equal(job.elevation_m, np.full(shape, 5.0))

    def test_reassigning_attribute_raises(self) -> None:
        shape = (1, 1)
        job = ClaimedJob(
            run_id="run-1",
            elevation_m=np.full(shape, 5.0),
            building_mask=np.zeros(shape, dtype=bool),
            manning_n=np.full(shape, 0.03),
            infiltration_loss_mm_per_hr=np.zeros(shape),
            rainfall_rates_mm_per_hr=np.array([0.0]),
        )

        with pytest.raises(AttributeError):
            job.run_id = "run-2"  # type: ignore[misc]
