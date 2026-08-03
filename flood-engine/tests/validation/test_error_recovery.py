"""Step 18, Part G: error recovery.

Verifies graceful handling of invalid DEM/land cover/buildings, missing
rainfall, an unavailable database, a worker crash, a simulation
exception, persistence rollback, and job recovery after restart -- and
that no partial output survives any of these failures. Every mechanism
exercised here already exists in the frozen Steps 1-17/persistence
layers (this Part validates them, per the prompt's own framing, it does
not invent new error handling); the one exception is
``pipeline.PipelineError`` (Step 18's own addition, already covered in
``tests/integration/test_pipeline.py`` -- not repeated here).

Classes requiring a real database are skipped, not failed, when one is
unreachable -- same convention as ``test_end_to_end.py``.
"""

import os
import threading
import time
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import geopandas as gpd
import numpy as np
import psycopg
import pytest
from psycopg_pool import ConnectionPool
from psycopg_pool.errors import PoolTimeout
from pydantic import SecretStr
from rasterio.crs import CRS
from shapely.geometry import Point

from flood_engine.config import DatabaseConfig
from flood_engine.core.solver.infiltration import (
    IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR,
    PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
)
from flood_engine.core.solver.roughness import (
    BARE_SPARSE_VEGETATION,
    BUILDING_MANNING_N_PLACEHOLDER,
    MANNING_N_BY_LANDCOVER_CLASS,
)
from flood_engine.core.timestepping import TimesteppingError
from flood_engine.inputs.rainfall import RainfallForcingError, load_rainfall_forcing
from flood_engine.io.raster_loader import RasterDataset, RasterValidationError
from flood_engine.jobs.models import JobStatus
from flood_engine.jobs.repository import JobRepository
from flood_engine.jobs.worker import execute_job, run_worker, sweep_stuck_jobs
from flood_engine.persistence.repository import PostgresJobRepository, read_completed_output
from flood_engine.persistence.schema import ensure_schema
from flood_engine.persistence.serialization import write_array
from flood_engine.pipeline import build_simulation_inputs
from flood_engine.preprocessing.building_rasterization import rasterize_buildings
from flood_engine.preprocessing.dem_preprocessing import preprocess_dem
from flood_engine.simulation.controller import SimulationControllerError
from flood_engine.simulation.controller import run as run_simulation
from tests.factories import MODEL_CRS, model_transform, no_buildings

SHAPE = (8, 8)


class TestInvalidDemHandling:
    def test_dem_missing_nodata_raises_clearly(self) -> None:
        # A different source CRS than the model grid's is required to
        # force preprocess_dem() past its own no-op ("already in model
        # CRS") shortcut and into the reprojection path where the
        # missing-nodata guard actually lives.
        data = np.full(SHAPE, 5.0, dtype=np.float32)
        dem = RasterDataset(
            data=data, crs=CRS.from_epsg(4326), transform=model_transform(), nodata=None
        )

        with pytest.raises(RasterValidationError, match="nodata"):
            preprocess_dem(dem)

    def test_dem_with_non_finite_values_is_caught_by_mass_conservation_not_silently_accepted(
        self,
    ) -> None:
        # The frozen solver does not itself validate elevation for
        # NaN/inf -- this documents what actually happens instead: a NaN
        # elevation cell corrupts the run enough that the run-level mass-
        # conservation check (frozen, simulation.controller.run's own
        # safety net) catches it and raises SimulationControllerError,
        # rather than silently returning a wrong-but-plausible answer.
        # Real, observed behavior -- not assumed.
        elevation = np.full(SHAPE, 5.0, dtype=np.float64)
        elevation[3, 3] = np.nan
        mask = no_buildings(SHAPE)
        pervious_n = MANNING_N_BY_LANDCOVER_CLASS[BARE_SPARSE_VEGETATION]
        manning_n = np.where(mask, BUILDING_MANNING_N_PLACEHOLDER, pervious_n)
        infiltration = np.where(
            mask, IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR, PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR
        )

        with pytest.raises(SimulationControllerError, match="mass conservation"):
            run_simulation(
                elevation_m=elevation,
                building_mask=mask,
                manning_n=manning_n,
                infiltration_loss_mm_per_hr=infiltration,
                rainfall_rates_mm_per_hr=np.array([10.0]),
            )


class TestInvalidLandcoverHandling:
    def test_unmapped_landcover_class_raises_clearly_not_a_silent_default(self) -> None:
        from flood_engine.core.solver.roughness import RoughnessError, roughness_grid

        codes = np.full(SHAPE, 253, dtype=np.uint16)  # not a real WorldCover class

        with pytest.raises(RoughnessError, match=r"\[253\]"):
            roughness_grid(codes)

    def test_landcover_missing_nodata_raises_clearly(self) -> None:
        from flood_engine.preprocessing.landcover_preprocessing import preprocess_landcover

        model_grid = RasterDataset(
            data=np.full((4, 4), 10.0, dtype=np.float32),
            crs=CRS.from_epsg(4326),
            transform=model_transform(),
            nodata=-9999.0,
        )
        landcover = RasterDataset(
            data=np.full((8, 8), BARE_SPARSE_VEGETATION, dtype=np.uint8),
            crs=CRS.from_epsg(4326),
            transform=model_transform(resolution_m=15.0),
            nodata=None,
        )

        with pytest.raises(RasterValidationError, match="nodata"):
            preprocess_landcover(landcover, model_grid)


class TestInvalidBuildingsHandling:
    def test_empty_buildings_geodataframe_raises_clearly(self) -> None:
        model_grid = RasterDataset(
            data=np.full(SHAPE, 10.0, dtype=np.float32),
            crs=MODEL_CRS,
            transform=model_transform(),
            nodata=-9999.0,
        )
        empty_buildings = gpd.GeoDataFrame({"id": []}, geometry=[], crs=MODEL_CRS)

        with pytest.raises(RasterValidationError, match="empty"):
            rasterize_buildings(empty_buildings, model_grid)

    def test_buildings_with_mismatched_crs_raise_clearly(self) -> None:
        model_grid = RasterDataset(
            data=np.full(SHAPE, 10.0, dtype=np.float32),
            crs=MODEL_CRS,
            transform=model_transform(),
            nodata=-9999.0,
        )
        wrong_crs_buildings = gpd.GeoDataFrame(
            {"id": [0]}, geometry=[Point(72.8, 19.0).buffer(0.0001)], crs=CRS.from_epsg(4326)
        )

        with pytest.raises(RasterValidationError, match="CRS"):
            rasterize_buildings(wrong_crs_buildings, model_grid)

    def test_pipeline_propagates_building_validation_errors_unwrapped(self) -> None:
        from tests.factories import constant_rainfall, flat_dem, uniform_landcover

        dem = flat_dem(SHAPE)
        landcover = uniform_landcover(SHAPE)
        empty_buildings = gpd.GeoDataFrame({"id": []}, geometry=[], crs=MODEL_CRS)
        rainfall = constant_rainfall(rate_mm_per_hr=10.0, hours=1)

        with pytest.raises(RasterValidationError, match="empty"):
            build_simulation_inputs(
                dem=dem, landcover=landcover, buildings=empty_buildings, rainfall=rainfall
            )


class TestMissingRainfallHandling:
    def test_empty_rainfall_records_raise_clearly(self) -> None:
        with pytest.raises(RainfallForcingError, match="empty"):
            load_rainfall_forcing([], unit="mm/hr")

    def test_empty_rainfall_array_to_the_controller_raises_clearly(self) -> None:
        mask = no_buildings(SHAPE)
        pervious_n = MANNING_N_BY_LANDCOVER_CLASS[BARE_SPARSE_VEGETATION]
        manning_n = np.where(mask, BUILDING_MANNING_N_PLACEHOLDER, pervious_n)
        infiltration = np.where(
            mask, IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR, PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR
        )

        with pytest.raises(TimesteppingError):
            run_simulation(
                elevation_m=np.full(SHAPE, 10.0),
                building_mask=mask,
                manning_n=manning_n,
                infiltration_loss_mm_per_hr=infiltration,
                rainfall_rates_mm_per_hr=np.array([]),
            )


class TestDatabaseUnavailable:
    def test_connecting_to_an_unreachable_database_fails_within_a_bounded_time_not_a_hang(
        self,
    ) -> None:
        config = DatabaseConfig(
            postgres_host="192.0.2.1",  # TEST-NET-1 (RFC 5737): guaranteed unroutable, never live
            postgres_port=5432,
            postgres_db="unreachable",
            postgres_user="nobody",
            postgres_password=SecretStr("irrelevant"),
        )
        conninfo = (
            f"host={config.postgres_host} port={config.postgres_port} "
            f"dbname={config.postgres_db} user={config.postgres_user} "
            f"password={config.postgres_password.get_secret_value()} connect_timeout=2"
        )

        start = time.monotonic()
        with pytest.raises((PoolTimeout, psycopg.OperationalError)):
            # open=True alone starts connecting in the background without
            # blocking or raising (ConnectionPool.open()'s own documented
            # default, wait=False) -- wait(timeout=...) is what actually
            # bounds how long this test waits before surfacing the real
            # unreachable-host failure.
            with ConnectionPool(conninfo=conninfo, min_size=1, max_size=1, open=True) as test_pool:
                test_pool.wait(timeout=5.0)
        elapsed = time.monotonic() - start

        assert elapsed < 15.0, "database-unavailable should fail fast, not hang"


TEST_DB_HOST = os.environ.get("FLOOD_ENGINE_TEST_DB_HOST", "localhost")
TEST_DB_PORT = int(os.environ.get("FLOOD_ENGINE_TEST_DB_PORT", "55432"))
TEST_DB_NAME = os.environ.get("FLOOD_ENGINE_TEST_DB_NAME", "flood_engine_test")
TEST_DB_USER = os.environ.get("FLOOD_ENGINE_TEST_DB_USER", "postgres")
TEST_DB_PASSWORD = os.environ.get("FLOOD_ENGINE_TEST_DB_PASSWORD", "test_password")


def _test_db_reachable() -> bool:
    try:
        conn = psycopg.connect(
            host=TEST_DB_HOST,
            port=TEST_DB_PORT,
            dbname=TEST_DB_NAME,
            user=TEST_DB_USER,
            password=TEST_DB_PASSWORD,
            connect_timeout=2,
        )
        conn.close()
    except psycopg.OperationalError:
        return False
    return True


pytestmark_db = pytest.mark.skipif(
    not _test_db_reachable(),
    reason=(
        "No reachable test PostgreSQL instance -- see test_postgres_job_repository.py's "
        "own docstring for how to start one."
    ),
)


@pytest.fixture
def pool() -> Iterator[ConnectionPool]:
    conninfo = (
        f"host={TEST_DB_HOST} port={TEST_DB_PORT} dbname={TEST_DB_NAME} "
        f"user={TEST_DB_USER} password={TEST_DB_PASSWORD}"
    )
    connection_pool = ConnectionPool(conninfo=conninfo, min_size=1, max_size=5, open=True)
    with connection_pool.connection() as conn:
        ensure_schema(conn)
        conn.execute("TRUNCATE flood_simulation_output, flood_simulation_run")
        conn.commit()
    yield connection_pool
    connection_pool.close()


@pytest.fixture
def repository(pool: ConnectionPool, tmp_path: Path) -> PostgresJobRepository:
    return PostgresJobRepository(pool, output_storage_dir=tmp_path / "output")


def _enqueue_broken_run(
    repository: PostgresJobRepository, *, tmp_path: Path, scenario_id: str
) -> str:
    """Enqueues a run whose arrays have a mismatched shape -- guaranteed to raise WCA2DError."""
    array_dir = tmp_path / "broken"
    array_dir.mkdir(exist_ok=True)
    elevation_path = array_dir / "elevation.npy"
    building_mask_path = array_dir / "building_mask.npy"
    manning_n_path = array_dir / "manning_n.npy"
    infiltration_path = array_dir / "infiltration.npy"
    rainfall_path = array_dir / "rainfall.npy"

    write_array(np.full(SHAPE, 10.0), elevation_path)
    write_array(np.zeros(SHAPE), building_mask_path)
    # Deliberately the wrong shape -- DomainInputs.__post_init__ raises
    # WCA2DError for exactly this, a real, reachable failure mode.
    write_array(np.full((4, 4), 0.03), manning_n_path)
    write_array(np.zeros(SHAPE), infiltration_path)
    write_array(np.array([10.0]), rainfall_path)

    return repository.enqueue(
        scenario_id=scenario_id,
        elevation_path=str(elevation_path),
        building_mask_path=str(building_mask_path),
        manning_n_path=str(manning_n_path),
        infiltration_loss_path=str(infiltration_path),
        rainfall_rates_path=str(rainfall_path),
    )


@pytestmark_db
class TestSimulationExceptionRecovery:
    def test_a_broken_job_is_marked_failed_not_completed(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id = _enqueue_broken_run(repository, tmp_path=tmp_path, scenario_id="err-broken-shape")
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None

        execute_job(job, repository)

        with repository._pool.connection() as conn:
            row = conn.execute(
                "SELECT status, error_message FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()
        assert row is not None
        assert row[0] == JobStatus.FAILED.value
        assert row[1] is not None and len(row[1]) > 0

    def test_no_partial_output_row_exists_after_a_failure(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id = _enqueue_broken_run(repository, tmp_path=tmp_path, scenario_id="err-no-partial")
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None

        execute_job(job, repository)

        with repository._pool.connection() as conn:
            output_row = conn.execute(
                "SELECT run_id FROM flood_simulation_output WHERE run_id = %s", (run_id,)
            ).fetchone()
            assert output_row is None
            assert read_completed_output(conn, run_id) is None

    def test_worker_loop_survives_a_broken_job_and_keeps_polling(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        broken_run_id = _enqueue_broken_run(
            repository, tmp_path=tmp_path, scenario_id="err-worker-survives"
        )
        stop_signal = threading.Event()

        def _stop_once_terminal() -> None:
            deadline = time.monotonic() + 20.0
            while time.monotonic() < deadline:
                with repository._pool.connection() as conn:
                    row = conn.execute(
                        "SELECT status FROM flood_simulation_run WHERE id = %s", (broken_run_id,)
                    ).fetchone()
                terminal_statuses = (JobStatus.COMPLETED.value, JobStatus.FAILED.value)
                if row is not None and row[0] in terminal_statuses:
                    break
                time.sleep(0.05)
            stop_signal.set()

        watcher = threading.Thread(target=_stop_once_terminal, daemon=True)
        watcher.start()
        from flood_engine.config import SimulationExecutionConfig

        run_worker(
            repository,
            execution_config=SimulationExecutionConfig(job_poll_interval_seconds=0.05),
            shutdown=stop_signal,
        )
        watcher.join(timeout=5.0)

        with repository._pool.connection() as conn:
            row = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (broken_run_id,)
            ).fetchone()
        assert row is not None
        assert row[0] == JobStatus.FAILED.value


@pytestmark_db
class TestWorkerCrashRecovery:
    def test_a_fake_repository_that_raises_on_mark_completed_does_not_kill_the_worker_loop(
        self,
    ) -> None:
        # A real, minimal "worker crash during write-back" simulation --
        # the repository itself is fine, but the specific write-back call
        # fails once, exactly the scenario run_worker's own outer
        # try/except exists to survive (frozen Step 16 behavior,
        # validated here rather than re-implemented).
        class _CrashingRepository:
            def __init__(self) -> None:
                self.claimed = False

            def claim_next_pending(self, *, max_concurrent_runs: int) -> object | None:
                if self.claimed:
                    return None
                self.claimed = True
                from flood_engine.jobs.models import ClaimedJob

                shape = (3, 3)
                return ClaimedJob(
                    run_id="crash-test",
                    elevation_m=np.full(shape, 10.0),
                    building_mask=no_buildings(shape),
                    manning_n=np.full(shape, 0.03),
                    infiltration_loss_mm_per_hr=np.zeros(shape),
                    rainfall_rates_mm_per_hr=np.array([5.0]),
                )

            def mark_completed(self, run_id: object, summary: object) -> None:
                raise RuntimeError("simulated crash writing back results")

            def mark_failed(self, run_id: object, *, error_message: str) -> None:
                pass

            def mark_cancelled(self, run_id: object) -> None:
                pass

            def find_stuck_running(self, *, older_than: timedelta) -> list[object]:
                return []

        repository: JobRepository = _CrashingRepository()  # type: ignore[assignment]
        stop_signal = threading.Event()

        def _stop_soon() -> None:
            time.sleep(0.5)
            stop_signal.set()

        threading.Thread(target=_stop_soon, daemon=True).start()

        from flood_engine.config import SimulationExecutionConfig

        # Must not raise -- the worker loop survives the crash.
        run_worker(
            repository,
            execution_config=SimulationExecutionConfig(job_poll_interval_seconds=0.05),
            shutdown=stop_signal,
        )


@pytestmark_db
class TestPersistenceRollback:
    def test_duplicate_primary_key_violation_rolls_back_both_statements(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        from flood_engine.core.state import MassLedger
        from flood_engine.output.generator import FloodOutputSummary
        from flood_engine.persistence.repository import PersistenceError

        run_id = _enqueue_broken_run(repository, tmp_path=tmp_path, scenario_id="err-rollback")
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None

        summary = FloodOutputSummary(
            max_depth_m=np.zeros(SHAPE),
            arrival_time_min=np.full(SHAPE, np.nan),
            duration_above_threshold_min=np.zeros(SHAPE),
            mass_ledger=MassLedger(
                rainfall_input_m3=0.0, infiltration_loss_m3=0.0, boundary_outflow_m3=0.0
            ),
            step_count=1,
            simulated_duration_s=60.0,
        )
        # First completion: succeeds normally.
        repository.mark_completed(job.run_id, summary)

        with repository._pool.connection() as conn:
            status_after_first = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()
        assert status_after_first is not None
        assert status_after_first[0] == JobStatus.COMPLETED.value

        # A second mark_completed for the same run_id: the output table's
        # primary key (run_id) makes this a real constraint violation --
        # confirms the failed second write does not corrupt the row the
        # first, successful write already committed.
        with pytest.raises(PersistenceError):
            repository.mark_completed(job.run_id, summary)

        with repository._pool.connection() as conn:
            status_after_second = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()
            output_count = conn.execute(
                "SELECT count(*) FROM flood_simulation_output WHERE run_id = %s", (run_id,)
            ).fetchone()
        assert status_after_second is not None
        assert status_after_second[0] == JobStatus.COMPLETED.value
        assert output_count is not None
        assert output_count[0] == 1


@pytestmark_db
class TestJobRecoveryAfterRestart:
    def test_a_stuck_running_job_is_reclaimed_as_failed_by_sweep(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        # Simulates a worker process that crashed mid-run: a job claimed
        # (status='running') but never marked completed/failed because
        # the process that claimed it no longer exists. sweep_stuck_jobs
        # is exactly the "job recovery after restart" mechanism -- a
        # freshly (re)started worker calls it every poll cycle.
        run_id = _enqueue_broken_run(
            repository, tmp_path=tmp_path, scenario_id="err-stuck-recovery"
        )
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None
        assert job.run_id == run_id
        # Deliberately never call execute_job/mark_completed/mark_failed
        # -- this run is now abandoned in 'running', exactly like a crash.

        sweep_stuck_jobs(repository, run_timeout=timedelta(seconds=0))

        with repository._pool.connection() as conn:
            row = conn.execute(
                "SELECT status, error_message FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()
        assert row is not None
        assert row[0] == JobStatus.FAILED.value
        assert row[1] is not None and "timeout" in row[1].lower()

    def test_a_run_still_within_its_timeout_is_left_running_by_sweep(
        self, repository: PostgresJobRepository, tmp_path: Path
    ) -> None:
        run_id = _enqueue_broken_run(
            repository, tmp_path=tmp_path, scenario_id="err-not-yet-stuck"
        )
        job = repository.claim_next_pending(max_concurrent_runs=1)
        assert job is not None

        sweep_stuck_jobs(repository, run_timeout=timedelta(hours=1))

        with repository._pool.connection() as conn:
            row = conn.execute(
                "SELECT status FROM flood_simulation_run WHERE id = %s", (run_id,)
            ).fetchone()
        assert row is not None
        assert row[0] == JobStatus.RUNNING.value
