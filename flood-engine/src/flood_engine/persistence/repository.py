"""persistence.repository: PostgresJobRepository, the concrete Step 16 JobRepository.

**Raw psycopg3, not an ORM.** Per the plan record's frozen Step 17
resolution: Step 3 already froze this project's PostgreSQL dependency as
``psycopg[binary,pool]`` (confirmed installed), not SQLAlchemy (not
installed, not declared anywhere). ``DatabaseConfig``'s own already-frozen
``postgres_pool_min_size``/``postgres_pool_max_size`` field names match
``psycopg_pool.ConnectionPool``'s constructor parameters exactly -- direct
evidence that config was written with psycopg3's native pool in mind.
Introducing an ORM now would redesign that decision, which this step's
own "Frozen Inputs" forbid.

**Structural typing, not inheritance**: :class:`PostgresJobRepository`
never imports or subclasses
:class:`~flood_engine.jobs.repository.JobRepository` -- it simply has the
same five method signatures, which is the entire mechanism the frozen
Protocol's dependency inversion relies on. ``worker.py`` is not modified
by this file existing.

**Safe concurrent claiming**: a naive "count running rows, then claim if
below the limit" has a real race under READ COMMITTED isolation -- two
concurrent claims can each see the count as still-below-limit before
either commits, together exceeding ``max_concurrent_runs``. Resolved with
a Postgres advisory transaction lock
(``pg_advisory_xact_lock``, released automatically at commit/rollback)
serializing the whole claim decision across every worker, combined with
``SELECT ... FOR UPDATE SKIP LOCKED`` so two concurrent claims never pick
the same pending row. Both are standard parts of PostgreSQL's own
transactional toolkit -- not a distributed lock, not Redis, not
LISTEN/NOTIFY, matching the frozen architecture's "rely on PostgreSQL
transactional semantics" instruction exactly.

**Legal-transition enforcement**: every ``mark_*`` method updates with an
explicit ``WHERE status = '<expected-precondition>'`` clause and checks
the affected row count -- zero rows affected means the precondition
wasn't met, raising :class:`IllegalTransitionError` rather than silently
proceeding. Same safety property as the Node backend's own
``simulation_run`` update-guard trigger, enforced here in the repository
layer instead (see ``schema.py``'s own docstring for why no trigger was
added).
"""

import json
import uuid
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import psycopg
from psycopg_pool import ConnectionPool
from rasterio.crs import CRS
from rasterio.transform import Affine

from flood_engine.config import DatabaseConfig, StorageConfig
from flood_engine.core.solver.wca2d import SolverParameters
from flood_engine.core.timestepping import TimesteppingParameters
from flood_engine.jobs.models import ClaimedJob, JobStatus, RunId
from flood_engine.logging_config import LogSubsystem, get_logger
from flood_engine.output.generator import FloodOutputSummary
from flood_engine.output.geotiff import write_flood_output_geotiffs
from flood_engine.persistence.models import SimulationOutputRow, SimulationRunRow
from flood_engine.persistence.serialization import (
    read_array,
    read_output_summary,
    serialize_mass_ledger,
    write_output_arrays,
)

logger = get_logger(LogSubsystem.DATABASE, "job_repository")

_CLAIM_ADVISORY_LOCK_KEY = 87_234_501
"""Arbitrary, fixed constant -- any two ``pg_advisory_xact_lock`` calls with the

same key across any number of sessions serialize against each other. This
one key exists purely to make "check running-count, then claim" atomic
system-wide; it is not shared with any other purpose.
"""


class PersistenceError(Exception):
    """Raised when a database operation fails. Always chains the original psycopg error.

    Per this step's own "do not swallow SQL errors" requirement -- the
    underlying exception is preserved via ``raise ... from exc``, never
    discarded.
    """


class IllegalTransitionError(PersistenceError):
    """Raised when a state-transition's precondition was not met (zero rows updated)."""


def _build_conninfo(database_config: DatabaseConfig) -> str:
    """Build a psycopg conninfo string from deployment configuration.

    A pure function, factored out of :meth:`PostgresJobRepository.from_config`
    so its construction logic (field order, secret handling) is
    unit-testable without opening a real connection.

    Args:
        database_config: Connection settings.

    Returns:
        A space-separated ``key=value`` conninfo string.
    """
    return (
        f"host={database_config.postgres_host} "
        f"port={database_config.postgres_port} "
        f"dbname={database_config.postgres_db} "
        f"user={database_config.postgres_user} "
        f"password={database_config.postgres_password.get_secret_value()}"
    )


class PostgresJobRepository:
    """The concrete, PostgreSQL-backed :class:`~flood_engine.jobs.repository.JobRepository`."""

    def __init__(self, pool: ConnectionPool, *, output_storage_dir: Path) -> None:
        """Construct a repository around an already-open connection pool.

        Args:
            pool: An open :class:`psycopg_pool.ConnectionPool`.
            output_storage_dir: Where completed runs' summary arrays are
                written (``StorageConfig.flood_output_storage_dir``).
        """
        self._pool = pool
        self._output_storage_dir = output_storage_dir

    @classmethod
    def from_config(
        cls, database_config: DatabaseConfig, storage_config: StorageConfig
    ) -> PostgresJobRepository:
        """Build a repository with a freshly-opened pool from deployment configuration.

        Args:
            database_config: Connection settings.
            storage_config: Output-array storage location.
        """
        pool = ConnectionPool(
            conninfo=_build_conninfo(database_config),
            min_size=database_config.postgres_pool_min_size,
            max_size=database_config.postgres_pool_max_size,
            open=True,
        )
        return cls(pool, output_storage_dir=storage_config.flood_output_storage_dir)

    def close(self) -> None:
        """Close the underlying connection pool. Call once, at process shutdown."""
        self._pool.close()

    def enqueue(
        self,
        *,
        scenario_id: str,
        elevation_path: str,
        building_mask_path: str,
        manning_n_path: str,
        infiltration_loss_path: str,
        rainfall_rates_path: str,
        solver_parameters: SolverParameters | None = None,
        timestepping_parameters: TimesteppingParameters | None = None,
        aoi_bounds_wgs84: tuple[float, float, float, float] | None = None,
        elevation_transform: tuple[float, float, float, float, float, float] | None = None,
        elevation_crs_epsg: int | None = None,
    ) -> RunId:
        """Insert a new ``pending`` run. Not part of the frozen JobRepository Protocol.

        A practical necessity for constructing runs at all -- the
        not-yet-built upstream layer that prepares scenario arrays and
        the future API endpoint (SDS Section 8, still unimplemented per
        Step 15) will eventually call something shaped like this. Never
        called by ``worker.py``, which only ever consumes pending rows,
        never creates them.

        Args:
            scenario_id: Opaque reference to the scenario this run
                executes (see :class:`~flood_engine.persistence.models.SimulationRunRow`'s
                own docstring for why this isn't a real foreign key yet).
            elevation_path: File reference to an already-prepared array.
            building_mask_path: File reference to an already-prepared array.
            manning_n_path: File reference to an already-prepared array.
            infiltration_loss_path: File reference to an already-prepared array.
            rainfall_rates_path: File reference to an already-prepared array.
            solver_parameters: Optional override, same meaning as in
                :func:`~flood_engine.simulation.controller.run`.
            timestepping_parameters: Optional override, same meaning as
                in :func:`~flood_engine.simulation.controller.run`.
            aoi_bounds_wgs84: Optional ``(west, south, east, north)`` in
                EPSG:4326, for map display only (Step 20). Never read by
                any computation -- pure metadata, stored and echoed back
                verbatim.
            elevation_transform: Optional affine transform (GDAL 6-tuple)
                for ``elevation_path``'s grid. When supplied together
                with ``elevation_crs_epsg``, the completed run's output
                is also written as real georeferenced GeoTIFFs.
            elevation_crs_epsg: Optional EPSG code matching
                ``elevation_transform``.

        Returns:
            The newly-created run's id.

        Raises:
            PersistenceError: if the insert fails.
        """
        run_id = str(uuid.uuid4())
        solver_json = json.dumps(asdict(solver_parameters)) if solver_parameters else None
        timestepping_json = (
            json.dumps(asdict(timestepping_parameters)) if timestepping_parameters else None
        )
        aoi_west, aoi_south, aoi_east, aoi_north = (
            aoi_bounds_wgs84 if aoi_bounds_wgs84 is not None else (None, None, None, None)
        )
        elevation_transform_json = (
            json.dumps(list(elevation_transform)) if elevation_transform is not None else None
        )
        try:
            with self._pool.connection() as conn, conn.transaction():
                conn.execute(
                    """
                    INSERT INTO flood_simulation_run
                        (id, scenario_id, status, elevation_path, building_mask_path,
                         manning_n_path, infiltration_loss_path, rainfall_rates_path,
                         solver_parameters_json, timestepping_parameters_json,
                         aoi_west, aoi_south, aoi_east, aoi_north,
                         elevation_transform_json, elevation_crs_epsg)
                    VALUES (%s, %s, 'pending', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_id,
                        scenario_id,
                        elevation_path,
                        building_mask_path,
                        manning_n_path,
                        infiltration_loss_path,
                        rainfall_rates_path,
                        solver_json,
                        timestepping_json,
                        aoi_west,
                        aoi_south,
                        aoi_east,
                        aoi_north,
                        elevation_transform_json,
                        elevation_crs_epsg,
                    ),
                )
        except psycopg.Error as exc:
            logger.exception("Failed to enqueue run", extra={"scenario_id": scenario_id})
            raise PersistenceError(f"Failed to enqueue run for scenario {scenario_id}") from exc

        logger.info("simulation.enqueued", extra={"run_id": run_id, "scenario_id": scenario_id})
        return run_id

    def claim_next_pending(self, *, max_concurrent_runs: int) -> ClaimedJob | None:
        """See :meth:`flood_engine.jobs.repository.JobRepository.claim_next_pending`."""
        try:
            with self._pool.connection() as conn, conn.transaction():
                conn.execute(
                    "SELECT pg_advisory_xact_lock(%s)", (_CLAIM_ADVISORY_LOCK_KEY,)
                )

                running_count_row = conn.execute(
                    "SELECT count(*) FROM flood_simulation_run WHERE status = 'running'"
                ).fetchone()
                running_count = running_count_row[0] if running_count_row else 0
                if running_count >= max_concurrent_runs:
                    return None

                pending_row = conn.execute(
                    """
                    SELECT id, elevation_path, building_mask_path, manning_n_path,
                           infiltration_loss_path, rainfall_rates_path,
                           solver_parameters_json, timestepping_parameters_json,
                           elevation_transform_json, elevation_crs_epsg
                    FROM flood_simulation_run
                    WHERE status = 'pending'
                    ORDER BY created_at
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                    """
                ).fetchone()
                if pending_row is None:
                    return None

                (
                    run_id,
                    elevation_path,
                    building_mask_path,
                    manning_n_path,
                    infiltration_loss_path,
                    rainfall_rates_path,
                    solver_json,
                    timestepping_json,
                    elevation_transform_json,
                    elevation_crs_epsg,
                ) = pending_row

                conn.execute(
                    """
                    UPDATE flood_simulation_run
                    SET status = 'running', started_at = now(),
                        attempt_count = attempt_count + 1, updated_at = now()
                    WHERE id = %s AND status = 'pending'
                    """,
                    (run_id,),
                )
        except psycopg.Error as exc:
            logger.exception("Failed to claim next pending run")
            raise PersistenceError("Failed to claim next pending run") from exc

        job = ClaimedJob(
            run_id=str(run_id),
            elevation_m=read_array(Path(elevation_path)),
            building_mask=read_array(Path(building_mask_path)).astype(np.bool_),
            manning_n=read_array(Path(manning_n_path)),
            infiltration_loss_mm_per_hr=read_array(Path(infiltration_loss_path)),
            rainfall_rates_mm_per_hr=read_array(Path(rainfall_rates_path)),
            solver_parameters=SolverParameters(**json.loads(solver_json))
            if solver_json
            else None,
            timestepping_parameters=TimesteppingParameters(**json.loads(timestepping_json))
            if timestepping_json
            else None,
            elevation_transform=tuple(json.loads(elevation_transform_json))
            if elevation_transform_json
            else None,
            elevation_crs_epsg=elevation_crs_epsg,
        )
        logger.info("simulation.claimed", extra={"run_id": job.run_id})
        return job

    def mark_completed(
        self,
        run_id: RunId,
        summary: FloodOutputSummary,
        *,
        elevation_transform: tuple[float, float, float, float, float, float] | None = None,
        elevation_crs_epsg: int | None = None,
    ) -> None:
        """See :meth:`flood_engine.jobs.repository.JobRepository.mark_completed`.

        Writes the three output arrays to disk (outside any DB
        transaction -- a filesystem write cannot itself be transactional
        with PostgreSQL), then updates the run's status and inserts its
        output row together in one transaction: either both succeed, or
        neither does, satisfying this step's own "never leave
        inconsistent intermediate state" requirement for the *database*.
        A DB failure after the array write leaves an orphaned ``.npy``
        file on disk -- a known, accepted limitation (see the Step 17
        freeze audit), not a database consistency violation.

        When ``elevation_transform``/``elevation_crs_epsg`` are both
        given, also writes real georeferenced GeoTIFFs alongside the
        ``.npy`` arrays and records their paths. When either is missing,
        the GeoTIFF columns stay ``NULL`` -- an honest "not
        georeferenced" signal, never a fabricated CRS.
        """
        locations = write_output_arrays(
            summary, base_dir=self._output_storage_dir, run_id=run_id
        )
        ledger_json = serialize_mass_ledger(summary.mass_ledger)

        geotiff_paths: dict[str, Path] = {}
        if elevation_transform is not None and elevation_crs_epsg is not None:
            geotiff_paths = write_flood_output_geotiffs(
                summary,
                transform=Affine(*elevation_transform),
                crs=CRS.from_epsg(elevation_crs_epsg),
                out_dir=self._output_storage_dir / run_id / "geotiff",
            )

        try:
            with self._pool.connection() as conn, conn.transaction():
                result = conn.execute(
                    """
                    UPDATE flood_simulation_run
                    SET status = 'completed', completed_at = now(), updated_at = now()
                    WHERE id = %s AND status = 'running'
                    """,
                    (run_id,),
                )
                if result.rowcount == 0:
                    raise IllegalTransitionError(
                        f"Run {run_id} is not running; cannot mark completed."
                    )

                conn.execute(
                    """
                    INSERT INTO flood_simulation_output
                        (run_id, max_depth_location, arrival_time_location,
                         duration_above_threshold_location, mass_ledger_json,
                         step_count, simulated_duration_s, max_depth_geotiff_path,
                         arrival_time_geotiff_path, duration_geotiff_path)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_id,
                        locations["max_depth"],
                        locations["arrival_time"],
                        locations["duration_above_threshold"],
                        ledger_json,
                        summary.step_count,
                        summary.simulated_duration_s,
                        str(geotiff_paths["max_depth_m"]) if geotiff_paths else None,
                        str(geotiff_paths["arrival_time_min"]) if geotiff_paths else None,
                        str(geotiff_paths["duration_above_threshold_min"])
                        if geotiff_paths
                        else None,
                    ),
                )
        except IllegalTransitionError:
            raise
        except psycopg.Error as exc:
            logger.exception("Failed to mark run completed", extra={"run_id": run_id})
            raise PersistenceError(f"Failed to mark run {run_id} completed") from exc

        logger.info("simulation.completed", extra={"run_id": run_id})

    def mark_failed(self, run_id: RunId, *, error_message: str) -> None:
        """See :meth:`flood_engine.jobs.repository.JobRepository.mark_failed`."""
        try:
            with self._pool.connection() as conn, conn.transaction():
                result = conn.execute(
                    """
                    UPDATE flood_simulation_run
                    SET status = 'failed', completed_at = now(),
                        error_message = %s, updated_at = now()
                    WHERE id = %s AND status = 'running'
                    """,
                    (error_message, run_id),
                )
                if result.rowcount == 0:
                    raise IllegalTransitionError(
                        f"Run {run_id} is not running; cannot mark failed."
                    )
        except IllegalTransitionError:
            raise
        except psycopg.Error as exc:
            logger.exception("Failed to mark run failed", extra={"run_id": run_id})
            raise PersistenceError(f"Failed to mark run {run_id} failed") from exc

        logger.error(
            "simulation.failed", extra={"run_id": run_id, "error_message": error_message}
        )

    def mark_cancelled(self, run_id: RunId) -> None:
        """See :meth:`flood_engine.jobs.repository.JobRepository.mark_cancelled`."""
        try:
            with self._pool.connection() as conn, conn.transaction():
                result = conn.execute(
                    """
                    UPDATE flood_simulation_run
                    SET status = 'cancelled', cancelled_at = now(), updated_at = now()
                    WHERE id = %s AND status = 'pending'
                    """,
                    (run_id,),
                )
                if result.rowcount == 0:
                    raise IllegalTransitionError(
                        f"Run {run_id} is not pending; cannot cancel."
                    )
        except IllegalTransitionError:
            raise
        except psycopg.Error as exc:
            logger.exception("Failed to cancel run", extra={"run_id": run_id})
            raise PersistenceError(f"Failed to cancel run {run_id}") from exc

        logger.info("simulation.cancelled", extra={"run_id": run_id})

    def find_stuck_running(self, *, older_than: timedelta) -> list[RunId]:
        """See :meth:`flood_engine.jobs.repository.JobRepository.find_stuck_running`."""
        threshold = datetime.now(UTC) - older_than
        try:
            with self._pool.connection() as conn:
                rows = conn.execute(
                    "SELECT id FROM flood_simulation_run WHERE status = 'running' "
                    "AND started_at < %s",
                    (threshold,),
                ).fetchall()
        except psycopg.Error as exc:
            logger.exception("Failed to query stuck running runs")
            raise PersistenceError("Failed to query stuck running runs") from exc

        run_ids = [str(row[0]) for row in rows]
        if run_ids:
            logger.info("simulation.stuck_jobs_found", extra={"run_ids": run_ids})
        return run_ids



def read_completed_output(
    conn: psycopg.Connection, run_id: RunId
) -> FloodOutputSummary | None:
    """Reload a completed run's output summary from persistence.

    Not part of the frozen JobRepository Protocol (the worker never
    reads output back) -- a read path a future API/output-retrieval layer
    (SDS Section 8's ``GET .../summary-rasters``, still unimplemented)
    will need.

    Args:
        conn: An open connection.
        run_id: The completed run to reload.

    Returns:
        The reconstructed summary, or ``None`` if no output row exists
        for this run.
    """
    row = conn.execute(
        """
        SELECT max_depth_location, arrival_time_location,
               duration_above_threshold_location, mass_ledger_json,
               step_count, simulated_duration_s
        FROM flood_simulation_output
        WHERE run_id = %s
        """,
        (run_id,),
    ).fetchone()
    if row is None:
        return None
    (
        max_depth_location,
        arrival_time_location,
        duration_above_threshold_location,
        mass_ledger_json,
        step_count,
        simulated_duration_s,
    ) = row
    return read_output_summary(
        max_depth_location=max_depth_location,
        arrival_time_location=arrival_time_location,
        duration_above_threshold_location=duration_above_threshold_location,
        mass_ledger_json=mass_ledger_json,
        step_count=step_count,
        simulated_duration_s=simulated_duration_s,
    )


def read_run(conn: psycopg.Connection, run_id: RunId) -> SimulationRunRow | None:
    """Read one run's full status row, unmaterialized (no array loading).

    Not part of the frozen JobRepository Protocol (the worker only ever
    claims/mutates rows, never queries one by id for its own sake) -- the
    same class of read path :func:`read_completed_output` already
    documents as "a future API/output-retrieval layer... will need",
    added here for Step 19's job-status endpoint specifically.

    Args:
        conn: An open connection.
        run_id: The run to look up.

    Returns:
        The row as-persisted, or ``None`` if no run exists with this id.
    """
    row = conn.execute(
        """
        SELECT id, scenario_id, status, elevation_path, building_mask_path,
               manning_n_path, infiltration_loss_path, rainfall_rates_path,
               solver_parameters_json, timestepping_parameters_json, worker_id,
               attempt_count, created_at, started_at, completed_at, cancelled_at,
               error_message, updated_at, aoi_west, aoi_south, aoi_east, aoi_north,
               elevation_transform_json, elevation_crs_epsg
        FROM flood_simulation_run
        WHERE id = %s
        """,
        (run_id,),
    ).fetchone()
    if row is None:
        return None
    return SimulationRunRow(
        id=str(row[0]),
        scenario_id=row[1],
        status=JobStatus(row[2]),
        elevation_path=row[3],
        building_mask_path=row[4],
        manning_n_path=row[5],
        infiltration_loss_path=row[6],
        rainfall_rates_path=row[7],
        solver_parameters_json=row[8],
        timestepping_parameters_json=row[9],
        worker_id=row[10],
        attempt_count=row[11],
        created_at=row[12],
        started_at=row[13],
        completed_at=row[14],
        cancelled_at=row[15],
        error_message=row[16],
        updated_at=row[17],
        aoi_west=row[18],
        aoi_south=row[19],
        aoi_east=row[20],
        aoi_north=row[21],
        elevation_transform_json=row[22],
        elevation_crs_epsg=row[23],
    )


def read_output_locations(conn: psycopg.Connection, run_id: RunId) -> SimulationOutputRow | None:
    """Read one completed run's output *file locations* only, without loading the arrays.

    Distinct from :func:`read_completed_output`: a file-download endpoint
    (Step 19) needs the raw ``.npy`` path to stream, not the materialized
    :class:`~flood_engine.output.generator.FloodOutputSummary` array
    contents -- loading the full arrays just to discard them in favor of
    the path that produced them would be wasted work for that specific
    caller.

    Args:
        conn: An open connection.
        run_id: The completed run to look up.

    Returns:
        The row as-persisted, or ``None`` if no output row exists for
        this run.
    """
    row = conn.execute(
        """
        SELECT run_id, max_depth_location, arrival_time_location,
               duration_above_threshold_location, mass_ledger_json,
               step_count, simulated_duration_s, max_depth_geotiff_path,
               arrival_time_geotiff_path, duration_geotiff_path, created_at
        FROM flood_simulation_output
        WHERE run_id = %s
        """,
        (run_id,),
    ).fetchone()
    if row is None:
        return None
    return SimulationOutputRow(
        run_id=str(row[0]),
        max_depth_location=row[1],
        arrival_time_location=row[2],
        duration_above_threshold_location=row[3],
        mass_ledger_json=row[4],
        step_count=row[5],
        simulated_duration_s=row[6],
        max_depth_geotiff_path=row[7],
        arrival_time_geotiff_path=row[8],
        duration_geotiff_path=row[9],
        created_at=row[10],
    )


__all__ = [
    "IllegalTransitionError",
    "PersistenceError",
    "PostgresJobRepository",
    "read_completed_output",
    "read_output_locations",
    "read_run",
]
