"""api.dependencies: FastAPI dependency injection for the Step 19 job-lifecycle routes.

Builds a real :class:`~flood_engine.persistence.repository.PostgresJobRepository`
from deployment configuration. Schema creation is not performed here --
``flood_simulation_run``/``flood_simulation_output`` are created once by
``db/migrations/0016_flood_simulation_tables.sql`` (run as superuser at DB
init), not by the runtime app role (see that migration's own header).

Cached at module scope (built once, on first request, reused for the
life of the process) -- opening a new connection pool per request would
defeat the entire purpose of a pool.
"""

from functools import lru_cache

from psycopg_pool import ConnectionPool

from flood_engine.config import DatabaseConfig, load_config
from flood_engine.persistence.repository import PostgresJobRepository


def _build_conninfo(database_config: DatabaseConfig) -> str:
    """Build a psycopg conninfo string from deployment configuration.

    Deliberately not imported from ``persistence.repository`` (private,
    module-internal there) or ``jobs.worker`` (process-specific, see this
    module's own docstring) -- the same small, self-contained duplication
    ``jobs.worker._build_conninfo`` already established as this
    codebase's own pattern for this exact situation.

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


@lru_cache(maxsize=1)
def get_repository() -> PostgresJobRepository:
    """Build (once) and return the process-wide repository instance.

    FastAPI resolves a route's ``Depends(get_repository)`` by calling
    this function -- ``lru_cache`` gives the exact "build once, share for
    the life of the process" semantics a connection pool needs, without
    introducing a global mutable variable or app-startup-event wiring.

    Returns:
        A repository backed by a real, open connection pool.
    """
    config = load_config()
    pool = ConnectionPool(
        conninfo=_build_conninfo(config.database),
        min_size=config.database.postgres_pool_min_size,
        max_size=config.database.postgres_pool_max_size,
        open=True,
    )
    return PostgresJobRepository(pool, output_storage_dir=config.storage.flood_output_storage_dir)


@lru_cache(maxsize=1)
def get_db_pool() -> ConnectionPool:
    """Build (once) and return a process-wide raw connection pool.

    For routes that read tables outside the job-queue's own schema (e.g.
    ``meteorological_observation``) and have no use for
    :class:`~flood_engine.persistence.repository.PostgresJobRepository`'s
    job-lifecycle methods.
    """
    config = load_config()
    return ConnectionPool(
        conninfo=_build_conninfo(config.database),
        min_size=config.database.postgres_pool_min_size,
        max_size=config.database.postgres_pool_max_size,
        open=True,
    )


__all__ = ["get_db_pool", "get_repository"]
