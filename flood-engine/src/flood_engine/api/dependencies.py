"""api.dependencies: FastAPI dependency injection for the Step 19 job-lifecycle routes.

Builds a real, schema-ready :class:`~flood_engine.persistence.repository.PostgresJobRepository`
from deployment configuration, the same construction sequence
``jobs.worker._build_repository()`` already uses (config -> pool ->
``ensure_schema`` -> repository) -- deliberately reimplemented here
rather than imported from that module: ``jobs.worker`` is the standalone
*worker process* entrypoint, a separate OS process from this API service
(frozen architecture Decision 2, ``jobs/worker.py``'s own docstring);
importing a private (underscore-prefixed), process-specific helper
across that boundary would create exactly the kind of implicit coupling
the frozen one-directional dependency rule is meant to prevent (``api``
depends on ``persistence``/``config``, never on ``jobs.worker``
specifically).

Cached at module scope (built once, on first request, reused for the
life of the process) -- opening a new connection pool per request would
defeat the entire purpose of a pool.
"""

from functools import lru_cache

from psycopg_pool import ConnectionPool

from flood_engine.config import DatabaseConfig, load_config
from flood_engine.persistence.repository import PostgresJobRepository
from flood_engine.persistence.schema import ensure_schema


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
        A repository backed by a real, open, schema-ready connection pool.
    """
    config = load_config()
    pool = ConnectionPool(
        conninfo=_build_conninfo(config.database),
        min_size=config.database.postgres_pool_min_size,
        max_size=config.database.postgres_pool_max_size,
        open=True,
    )
    with pool.connection() as conn:
        ensure_schema(conn)
        conn.commit()
    return PostgresJobRepository(pool, output_storage_dir=config.storage.flood_output_storage_dir)


__all__ = ["get_repository"]
