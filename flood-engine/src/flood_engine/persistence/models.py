"""persistence.models: plain dataclasses mirroring the persisted row shapes.

Not an ORM -- see `repository.py`'s module docstring for why (raw
``psycopg``, matching Step 3's already-frozen dependency decision, not
SQLAlchemy). These types exist only to give SQL query results a typed
shape; they own no query logic, no session management, no lazy loading,
no relationship traversal.
"""

from dataclasses import dataclass
from datetime import datetime

from flood_engine.jobs.models import JobStatus, RunId


@dataclass(frozen=True, slots=True)
class SimulationRunRow:
    """One row of ``flood_simulation_run``.

    Attributes:
        id: The run's identifier.
        scenario_id: Opaque reference to the scenario this run executes.
            No ``flood_scenario`` table exists yet (SDS Section 5) --
            see the plan record's Step 17 resolution for why this stays
            a plain, unvalidated string rather than a real foreign key
            (the schema column is ``TEXT``, not ``UUID`` -- an earlier
            version assumed UUID format nothing frozen actually
            specifies, caught by a real constraint failure in
            integration testing).
        status: One of the five frozen ``JobStatus`` values.
        elevation_path, building_mask_path, manning_n_path,
            infiltration_loss_path, rainfall_rates_path: File references
            to already-prepared arrays (``.npy``), matching
            :class:`~flood_engine.jobs.models.ClaimedJob`'s own fields
            exactly. Written by a not-yet-built upstream layer -- this
            repository only reads them.
        solver_parameters_json, timestepping_parameters_json: Optional
            JSON-encoded overrides, or ``None`` to use
            :func:`~flood_engine.simulation.controller.run`'s own
            defaults.
        worker_id: Diagnostic only -- which worker process claimed this
            run (e.g. hostname/PID), never read or branched on by any
            repository logic.
        attempt_count: Incremented to 1 on claim. Never incremented
            further -- Step 16's frozen architecture explicitly excludes
            retry behavior, so no code path here ever re-claims a
            terminal row. Present for schema completeness/future use,
            not wired to any retry logic that does not exist.
        created_at, started_at, completed_at, cancelled_at: Lifecycle
            timestamps, one per relevant transition.
        error_message: Populated on ``failed`` (covers both execution
            exceptions and timeout-driven abandonment).
        updated_at: Bumped on every transition.
        aoi_west, aoi_south, aoi_east, aoi_north: The run's AOI bounding
            box in EPSG:4326, for map display only (Step 20) -- ``None``
            for runs that did not supply one (e.g. synthetic test
            arrays with no real geography). Never read by any
            computation in this codebase.
    """

    id: RunId
    scenario_id: str
    status: JobStatus
    elevation_path: str
    building_mask_path: str
    manning_n_path: str
    infiltration_loss_path: str
    rainfall_rates_path: str
    solver_parameters_json: str | None
    timestepping_parameters_json: str | None
    worker_id: str | None
    attempt_count: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    error_message: str | None
    updated_at: datetime
    aoi_west: float | None
    aoi_south: float | None
    aoi_east: float | None
    aoi_north: float | None


@dataclass(frozen=True, slots=True)
class SimulationOutputRow:
    """One row of ``flood_simulation_output``.

    Attributes:
        run_id: The completed run this output belongs to.
        max_depth_location, arrival_time_location,
            duration_above_threshold_location: File references (``.npy``),
            per the plan record's Step 17 resolution -- **not yet real
            georeferenced rasters**. No CRS/transform is available
            anywhere in the pipeline up to this point (see
            `flood_engine.output.generator`'s own module docstring);
            this is a documented placeholder, not a finished raster
            product.
        mass_ledger_json: JSON-encoded
            :class:`~flood_engine.core.state.MassLedger`.
        step_count, simulated_duration_s: Plain scalars, mirroring
            :class:`~flood_engine.output.generator.FloodOutputSummary`
            exactly.
        created_at: When this output was persisted.
    """

    run_id: RunId
    max_depth_location: str
    arrival_time_location: str
    duration_above_threshold_location: str
    mass_ledger_json: str
    step_count: int
    simulated_duration_s: float
    created_at: datetime


__all__ = ["SimulationOutputRow", "SimulationRunRow"]
