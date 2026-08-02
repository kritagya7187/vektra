"""Unit tests for flood_engine.persistence.repository -- the DB-independent pieces only.

Real, DB-backed behavior (claiming, concurrency, transactions, rollback,
worker end-to-end) is covered in
``tests/integration/test_postgres_job_repository.py`` -- mocking
psycopg's context-manager-heavy transaction API convincingly would be
more complex and less trustworthy than exercising the real thing against
a disposable test database, per this project's own established
preference for real verification over elaborate mocking wherever
feasible (see e.g. Step 17's own resolution to use a real Postgres
container rather than hand-mock psycopg).
"""

from pydantic import SecretStr

from flood_engine.config import DatabaseConfig
from flood_engine.persistence.repository import (
    IllegalTransitionError,
    PersistenceError,
    _build_conninfo,
)


class TestBuildConninfo:
    def test_includes_every_connection_field(self) -> None:
        config = DatabaseConfig(
            postgres_host="dbhost",
            postgres_port=5433,
            postgres_db="flood_engine",
            postgres_user="flood_user",
            postgres_password=SecretStr("s3cret"),
        )

        conninfo = _build_conninfo(config)

        assert "host=dbhost" in conninfo
        assert "port=5433" in conninfo
        assert "dbname=flood_engine" in conninfo
        assert "user=flood_user" in conninfo
        assert "password=s3cret" in conninfo

    def test_uses_the_real_secret_value_not_its_repr(self) -> None:
        # SecretStr's own repr/str deliberately masks the value
        # ("**********") -- a real regression here would silently break
        # every connection attempt, so this is checked explicitly.
        config = DatabaseConfig(
            postgres_host="localhost",
            postgres_port=5432,
            postgres_db="db",
            postgres_user="user",
            postgres_password=SecretStr("my-real-password"),
        )

        conninfo = _build_conninfo(config)

        assert "my-real-password" in conninfo
        assert "**********" not in conninfo


class TestErrorHierarchy:
    def test_illegal_transition_error_is_a_persistence_error(self) -> None:
        assert issubclass(IllegalTransitionError, PersistenceError)

    def test_persistence_error_chains_the_original_exception(self) -> None:
        original = ValueError("connection refused")
        try:
            try:
                raise original
            except ValueError as exc:
                raise PersistenceError("wrapped") from exc
        except PersistenceError as wrapped:
            assert wrapped.__cause__ is original
