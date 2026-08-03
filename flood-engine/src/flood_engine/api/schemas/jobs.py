"""api.schemas.jobs: request/response schemas for the Step 19 job-lifecycle endpoints.

Companion to ``api.schemas.simulation`` (the output-side mirrors, Step 15)
-- this module covers the request side that module's own docstring
explicitly deferred: *"Its shape would need to answer questions this
layer cannot answer yet -- does a client submit raw elevation/rainfall
arrays inline, or a reference to an already-persisted scenario (SDS
Section 5)? -- which depend on Step 17 (persistence)."* Step 17 now
exists, and its answer is concrete:
:meth:`~flood_engine.persistence.repository.PostgresJobRepository.enqueue`
takes a scenario id plus five already-prepared array *file paths* --
this module mirrors exactly that shape, field for field, not an
invented alternative (SDS Section 5's ``flood_scenario`` object, which
would accept raw arrays or modifications, still does not exist --
``flood_engine.scenario`` remains a stub; building it is its own future
step, not something this module works around).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.core.timestepping import TimesteppingParameters
from flood_engine.jobs.models import JobStatus
from flood_engine.persistence.models import SimulationRunRow


class SolverParametersOverride(BaseModel):
    """Optional overrides for the five frozen WCA2D numerical parameters.

    Field-for-field mirror of :class:`~flood_engine.core.solver.wca2d.SolverParameters`.
    Omitted fields fall back to that class's own frozen defaults -- this
    schema does not restate or alter them, only exposes the same
    already-frozen override mechanism ``simulation.controller.run`` has
    always accepted.
    """

    model_config = ConfigDict(frozen=True)

    tol_delwl_m: float | None = None
    ignore_wd_m: float | None = None
    alpha: float | None = None
    time_mindt_s: float | None = None
    time_maxdt_s: float | None = None

    def to_domain(self) -> SolverParameters:
        """Build a domain :class:`SolverParameters`, using its own defaults for omitted fields."""
        defaults = SolverParameters()
        return SolverParameters(
            tol_delwl_m=self.tol_delwl_m if self.tol_delwl_m is not None else defaults.tol_delwl_m,
            ignore_wd_m=self.ignore_wd_m if self.ignore_wd_m is not None else defaults.ignore_wd_m,
            alpha=self.alpha if self.alpha is not None else defaults.alpha,
            time_mindt_s=self.time_mindt_s
            if self.time_mindt_s is not None
            else defaults.time_mindt_s,
            time_maxdt_s=self.time_maxdt_s
            if self.time_maxdt_s is not None
            else defaults.time_maxdt_s,
        )


class TimesteppingParametersOverride(BaseModel):
    """Optional override for the one frozen timestepping parameter.

    Field-for-field mirror of :class:`~flood_engine.core.timestepping.TimesteppingParameters`.
    """

    model_config = ConfigDict(frozen=True)

    infiltration_interval_s: float | None = None

    def to_domain(self) -> TimesteppingParameters:
        """Build a domain :class:`TimesteppingParameters`, using its own default if omitted."""
        defaults = TimesteppingParameters()
        return TimesteppingParameters(
            infiltration_interval_s=self.infiltration_interval_s
            if self.infiltration_interval_s is not None
            else defaults.infiltration_interval_s
        )


class SubmitSimulationRequest(BaseModel):
    """The request body for ``POST /api/v1/simulations``.

    Every field mirrors :meth:`~flood_engine.persistence.repository.PostgresJobRepository.enqueue`'s
    own keyword arguments exactly -- this schema performs no
    reinterpretation of what a "simulation run" is, it only gives that
    already-frozen method's parameters an HTTP-request shape. The five
    ``*_path`` fields reference already-prepared ``.npy`` arrays (real
    files on the shared storage volume both this service and its caller
    can reach) -- consistent with this being an internal service called
    by the Node backend (per the frozen "backend orchestrates an
    external specialized capability" pattern), not a public upload API.
    """

    model_config = ConfigDict(frozen=True)

    scenario_id: str
    elevation_path: str
    building_mask_path: str
    manning_n_path: str
    infiltration_loss_path: str
    rainfall_rates_path: str
    solver_parameters: SolverParametersOverride | None = None
    timestepping_parameters: TimesteppingParametersOverride | None = None
    aoi_bounds_wgs84: tuple[float, float, float, float] | None = None
    """``(west, south, east, north)`` in EPSG:4326 -- Step 20 map-display metadata only.
    Never read by the solver or any computation; stored and echoed back verbatim.
    """


class SubmitSimulationResponse(BaseModel):
    """The response body for a successful ``POST /api/v1/simulations``."""

    model_config = ConfigDict(frozen=True)

    run_id: str
    status: JobStatus


class SimulationRunStatusResponse(BaseModel):
    """The response body for ``GET /api/v1/simulations/{run_id}``.

    Field-for-field mirror of :class:`~flood_engine.persistence.models.SimulationRunRow`,
    minus the five internal array-path fields (implementation detail no
    HTTP caller needs -- a download is its own dedicated endpoint) and
    ``worker_id``/``attempt_count`` (operational diagnostics, not part
    of the job-lifecycle contract Step 19 defines).
    """

    model_config = ConfigDict(frozen=True)

    run_id: str
    scenario_id: str
    status: JobStatus
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    error_message: str | None
    aoi_bounds_wgs84: tuple[float, float, float, float] | None = None
    """``(west, south, east, north)`` in EPSG:4326, or ``None`` if this run was
    submitted without one (Step 20 map-display metadata only).
    """

    @classmethod
    def from_domain(cls, row: SimulationRunRow) -> SimulationRunStatusResponse:
        """Build a schema instance from the domain row -- no computation, only translation."""
        aoi_bounds_wgs84 = (
            (row.aoi_west, row.aoi_south, row.aoi_east, row.aoi_north)
            if row.aoi_west is not None
            and row.aoi_south is not None
            and row.aoi_east is not None
            and row.aoi_north is not None
            else None
        )
        return cls(
            run_id=row.id,
            scenario_id=row.scenario_id,
            status=row.status,
            created_at=row.created_at,
            started_at=row.started_at,
            completed_at=row.completed_at,
            cancelled_at=row.cancelled_at,
            error_message=row.error_message,
            aoi_bounds_wgs84=aoi_bounds_wgs84,
        )


__all__ = [
    "SimulationRunStatusResponse",
    "SolverParametersOverride",
    "SubmitSimulationRequest",
    "SubmitSimulationResponse",
    "TimesteppingParametersOverride",
]
