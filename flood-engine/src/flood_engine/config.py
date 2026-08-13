"""Deployment/operational configuration for flood-engine.

Every setting in this module governs *how this service is deployed and
operated* -- connection strings, storage paths, resource limits, log
verbosity, network binding. Nothing here may express a scientific modeling
assumption, and this module must never be imported by ``flood_engine.core``.

Explicitly, and by design, this module does **not** contain: Manning's
roughness coefficients, SCS Curve Number infiltration values, the WCA2D
adaptive-timestep/stability parameters, the building-footprint
rasterization threshold, or any other quantity fixed by the Numerical
Model Specification (NMS). Those are frozen scientific constants that live
in the ``flood_engine.core`` modules that implement them (per the NMS:
roughness in ``core.solver.roughness``, infiltration in
``core.solver.infiltration``, timestep/stability in
``core.timestepping`` -- none built yet; Steps 11-12) and are versioned
through code review like any other NMS change, never through a mutable
``.env`` file. Per-scenario inputs (rainfall forcing, DEM/land-cover
modifications) are a third, distinct category again: neither deployment
configuration nor frozen constants, but explicit, auditable fields on the
persisted ``flood_scenario`` record (SDS Section 5), scoped to one run.

This three-way split -- deployment config (here) / frozen NMS constants
(``core``) / per-scenario inputs (``flood_scenario`` rows) -- is what
prevents someone from accidentally changing scientific assumptions by
editing an environment variable.
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class DatabaseConfig(BaseSettings):
    """PostgreSQL/PostGIS connection settings.

    Field names and defaults deliberately mirror the existing VEKTRA Node
    backend's own ``POSTGRES_*`` environment variables (see the
    repository's root ``docker-compose.yml``) rather than introducing a
    flood-engine-specific naming scheme: this service reads and writes the
    *same* PostGIS database as the Node backend (the SDS Section 7 tables
    live alongside the existing schema, not in a second database), so one
    shared ``.env`` configures both services.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    postgres_host: str
    postgres_port: int = 5432
    postgres_db: str
    postgres_user: str
    postgres_password: SecretStr
    # Pool sizing has no Node-backend equivalent (the Node pg client pools
    # differently) -- these two are new, flood-engine-specific settings.
    postgres_pool_min_size: int = 1
    postgres_pool_max_size: int = 10


class RasterConfig(BaseSettings):
    """Location of the *input* static rasters (DEM, land cover).

    ``storage_dir`` reuses the exact meaning and default container path of
    the Node backend's existing ``RASTER_STORAGE_DIR`` (see
    ``docker-compose.yml``) -- flood-engine reads the same already-ingested
    SRTM DEM and ESA WorldCover rasters the existing GEE
    ingestion pipeline wrote there; it does not maintain a second copy.
    The exact sub-path/filename convention within this directory is
    defined when raster loading utilities are implemented (Step 6), not
    here.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    raster_storage_dir: Path = Field(default=Path("/app/raster-storage"))


class StorageConfig(BaseSettings):
    """Location and retention policy for *output* simulation artifacts.

    Kept separate from :class:`RasterConfig` because output retention is
    an explicit, real cost tradeoff already flagged in SDS Section 7: full
    per-timestep grids are storage-heavy at real cell-count x
    timestep-count x run-count and are "only retained for a
    deliberately-flagged subset of runs, not every scenario by default" --
    ``retain_full_timesteps`` is that deployment-level toggle. The summary
    rasters (max depth, arrival time, duration) every run produces are
    unaffected by this flag; they are always written.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    flood_output_storage_dir: Path = Field(default=Path("/app/flood-output"))
    flood_output_retain_full_timesteps: bool = False


class SimulationExecutionConfig(BaseSettings):
    """Operational limits on running simulations -- never scientific parameters.

    Every field here bounds *resource usage and job scheduling*: how many
    runs may execute concurrently, how long a run is allowed to take
    before it is considered stuck, how often a queue consumer polls for
    new work. None of these change what a simulation computes. Rainfall
    intensity, Manning's n, infiltration method, timestep -- none of that
    belongs here; see the module docstring for where it actually lives.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    max_concurrent_runs: int = 2
    run_timeout_seconds: int = 3600
    job_poll_interval_seconds: float = 5.0


class LoggingConfig(BaseSettings):
    """Log verbosity, matching the Node backend's existing ``LOG_LEVEL`` variable.

    ``log_level`` is restricted to a ``Literal`` of the five real Python
    logging level names rather than a bare ``str`` -- a typo'd value now
    fails fast at config-load time (Step 4's own validation-error handling)
    instead of surfacing later inside ``logging.Logger.setLevel()`` when
    ``flood_engine.logging_config.configure_logging`` (Step 5) consumes it.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    log_level: Literal["debug", "info", "warning", "error", "critical"] = "info"


class APIConfig(BaseSettings):
    """FastAPI network binding.

    No CORS setting here, unlike the Node backend's
    ``CORS_ALLOWED_ORIGINS``: this API is called by the Node backend over
    the internal Docker network (the same "backend orchestrates an
    external specialized capability" shape already used for Google Earth
    Engine), not directly by a browser -- there is no cross-origin request
    to permit.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    host: str = "0.0.0.0"
    port: int = 8001


@dataclass(frozen=True, slots=True)
class AppConfig:
    """Composition root for every deployment configuration domain.

    Frozen, like every sub-config it holds: ``config.database = ...`` and
    ``config.database.postgres_host = ...`` both raise rather than silently
    mutate live configuration after startup. Deliberately a plain
    dataclass, not itself a ``BaseSettings`` subclass -- each domain above
    loads its own environment variables independently, and this object is
    assembled once at startup by :func:`load_config`. Consumers should
    depend on the specific sub-config they need (e.g. a repository takes
    :class:`DatabaseConfig`, not :class:`AppConfig`) so unit tests can
    construct only what they need without populating an entire
    environment.

    Attributes:
        database: PostgreSQL/PostGIS connection settings.
        raster: Input DEM/land-cover raster location.
        storage: Output simulation-artifact location and retention policy.
        simulation: Operational execution limits (never scientific parameters).
        logging: Log verbosity.
        api: FastAPI network binding.
    """

    database: DatabaseConfig
    raster: RasterConfig
    storage: StorageConfig
    simulation: SimulationExecutionConfig
    logging: LoggingConfig
    api: APIConfig


def load_config() -> AppConfig:
    """Load and validate every deployment configuration domain from the environment.

    Returns:
        A fully-populated :class:`AppConfig`.

    Raises:
        pydantic.ValidationError: if a required variable (e.g.
            ``POSTGRES_HOST``, ``POSTGRES_DB``, ``POSTGRES_USER``,
            ``POSTGRES_PASSWORD``) is missing or fails validation. The
            error is logged before being re-raised so a startup failure is
            diagnosable from logs alone, without being swallowed.
    """
    try:
        config = AppConfig(
            database=DatabaseConfig(),  # type: ignore[call-arg]
            raster=RasterConfig(),
            storage=StorageConfig(),
            simulation=SimulationExecutionConfig(),
            logging=LoggingConfig(),
            api=APIConfig(),
        )
    except Exception:
        logger.exception("Failed to load flood-engine configuration from environment")
        raise

    logger.info(
        "flood-engine configuration loaded: db=%s:%s/%s api=%s:%s log_level=%s "
        "raster_storage_dir=%s output_storage_dir=%s",
        config.database.postgres_host,
        config.database.postgres_port,
        config.database.postgres_db,
        config.api.host,
        config.api.port,
        config.logging.log_level,
        config.raster.raster_storage_dir,
        config.storage.flood_output_storage_dir,
    )
    return config
