"""Unit tests for flood_engine.config.

Covers: required-field validation, defaults, the password-secrecy
guarantee, and full AppConfig composition via load_config(). No database,
filesystem, or running service is touched -- pydantic-settings reads only
environment variables (and a possibly-absent .env, which is safely skipped
when missing).
"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from flood_engine.config import (
    APIConfig,
    AppConfig,
    DatabaseConfig,
    LoggingConfig,
    RasterConfig,
    SimulationExecutionConfig,
    StorageConfig,
    load_config,
)

REQUIRED_DATABASE_ENV = {
    "POSTGRES_HOST": "db",
    "POSTGRES_DB": "vektra",
    "POSTGRES_USER": "vektra_backend_api",
    "POSTGRES_PASSWORD": "test-password",
}


def _set_required_database_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in REQUIRED_DATABASE_ENV.items():
        monkeypatch.setenv(key, value)


class TestDatabaseConfig:
    """DatabaseConfig must require exactly the fields with no safe default."""

    def test_raises_when_required_fields_are_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for key in REQUIRED_DATABASE_ENV:
            monkeypatch.delenv(key, raising=False)

        with pytest.raises(ValidationError):
            DatabaseConfig()  # type: ignore[call-arg]

    def test_loads_from_environment(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _set_required_database_env(monkeypatch)

        config = DatabaseConfig()  # type: ignore[call-arg]

        assert config.postgres_host == "db"
        assert config.postgres_port == 5432  # default, not set above
        assert config.postgres_db == "vektra"
        assert config.postgres_user == "vektra_backend_api"

    def test_password_is_never_exposed_in_repr_or_str(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _set_required_database_env(monkeypatch)

        config = DatabaseConfig()  # type: ignore[call-arg]

        assert "test-password" not in repr(config)
        assert "test-password" not in str(config.postgres_password)
        assert config.postgres_password.get_secret_value() == "test-password"

    def test_pool_sizes_have_sane_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _set_required_database_env(monkeypatch)

        config = DatabaseConfig()  # type: ignore[call-arg]

        assert config.postgres_pool_min_size == 1
        assert config.postgres_pool_max_size == 10


class TestRasterConfig:
    """RasterConfig has no required fields -- must be usable with zero env vars set."""

    def test_default_storage_dir_matches_node_backend_container_path(self) -> None:
        config = RasterConfig()

        assert config.raster_storage_dir == Path("/app/raster-storage")

    def test_overridable_via_environment_using_node_backends_exact_variable_name(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Must be RASTER_STORAGE_DIR, not a flood-engine-specific name --
        # this is the same variable the Node backend already sets in
        # docker-compose.yml, so one value configures both services.
        monkeypatch.setenv("RASTER_STORAGE_DIR", "/custom/raster-path")

        config = RasterConfig()

        assert config.raster_storage_dir == Path("/custom/raster-path")


class TestStorageConfig:
    """Output storage location and the retention-policy toggle from SDS Section 7."""

    def test_defaults(self) -> None:
        config = StorageConfig()

        assert config.flood_output_storage_dir == Path("/app/flood-output")
        assert config.flood_output_retain_full_timesteps is False

    def test_retention_toggle_overridable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("FLOOD_OUTPUT_RETAIN_FULL_TIMESTEPS", "true")

        config = StorageConfig()

        assert config.flood_output_retain_full_timesteps is True


class TestSimulationExecutionConfig:
    """Operational limits only.

    This test suite is itself a check that no scientific field sneaks in.
    """

    def test_defaults(self) -> None:
        config = SimulationExecutionConfig()

        assert config.max_concurrent_runs == 2
        assert config.run_timeout_seconds == 3600
        assert config.job_poll_interval_seconds == 5.0

    def test_contains_no_scientific_parameter_names(self) -> None:
        forbidden_substrings = ("manning", "roughness", "infiltration", "curve_number", "timestep")
        field_names = set(SimulationExecutionConfig.model_fields)

        for forbidden in forbidden_substrings:
            assert not any(forbidden in name for name in field_names), (
                f"SimulationExecutionConfig must never hold a scientific parameter "
                f"(found something matching {forbidden!r}) -- see config.py's module "
                f"docstring for where NMS constants belong instead."
            )


class TestLoggingConfig:
    def test_default_log_level_matches_node_backend_default(self) -> None:
        config = LoggingConfig()

        assert config.log_level == "info"


class TestAPIConfig:
    def test_defaults(self) -> None:
        config = APIConfig()

        assert config.host == "0.0.0.0"  # noqa: S104 -- intentional: container bind address
        assert config.port == 8001

    def test_has_no_cors_field(self) -> None:
        # Deliberate absence, per the class docstring: flood-engine is
        # called by the Node backend over the internal network, not
        # directly by a browser.
        assert "cors_allowed_origins" not in APIConfig.model_fields


class TestLoadConfig:
    """load_config() composes every domain into one AppConfig."""

    def test_composes_all_domains(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _set_required_database_env(monkeypatch)

        config = load_config()

        assert isinstance(config, AppConfig)
        assert config.database.postgres_host == "db"
        assert config.raster.raster_storage_dir == Path("/app/raster-storage")
        assert config.storage.flood_output_retain_full_timesteps is False
        assert config.simulation.max_concurrent_runs == 2
        assert config.logging.log_level == "info"
        assert config.api.port == 8001

    def test_config_is_immutable_after_startup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _set_required_database_env(monkeypatch)
        config = load_config()

        # Reassigning a sub-config on the composition root must fail --
        # AppConfig is a frozen dataclass.
        with pytest.raises(AttributeError):
            config.database = DatabaseConfig()  # type: ignore[misc,call-arg]

        # Mutating a field on a sub-config must also fail -- each domain is
        # a frozen pydantic model, not just the container around them.
        with pytest.raises(ValidationError):
            config.database.postgres_host = "attacker-controlled-host"

        with pytest.raises(ValidationError):
            config.api.port = 9999

    def test_raises_and_logs_when_database_env_missing(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        for key in REQUIRED_DATABASE_ENV:
            monkeypatch.delenv(key, raising=False)

        with pytest.raises(ValidationError):
            load_config()

        assert "Failed to load flood-engine configuration" in caplog.text
