"""Unit tests for flood_engine.io.proj_env.

conftest.py already calls ensure_compatible_proj_data() once at collection
time (a real, deliberate side effect -- see its own docstring), so these
tests verify it is safe to call again and does the right thing, not that
it "first" fixes a broken environment.
"""

import importlib.util
import logging
import os
from pathlib import Path

import pytest
import rasterio

from flood_engine.io.proj_env import ensure_compatible_proj_data


class TestEnsureCompatibleProjData:
    def test_sets_proj_data_to_rasterios_bundled_directory(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("PROJ_DATA", raising=False)

        ensure_compatible_proj_data()

        expected = Path(rasterio.__file__).parent / "proj_data"
        assert os.environ["PROJ_DATA"] == str(expected)

    def test_is_idempotent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("PROJ_DATA", raising=False)

        ensure_compatible_proj_data()
        first_value = os.environ["PROJ_DATA"]
        ensure_compatible_proj_data()
        second_value = os.environ["PROJ_DATA"]

        assert first_value == second_value

    def test_overrides_a_conflicting_ambient_proj_lib(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Reproduces the real conflict this module exists to work around:
        # a stray PROJ_LIB from another installation must not win.
        conflicting_path = r"C:\Program Files\PostgreSQL\18\share\contrib\postgis-3.6\proj"
        monkeypatch.setenv("PROJ_DATA", conflicting_path)

        ensure_compatible_proj_data()

        assert "rasterio" in os.environ["PROJ_DATA"]

    def test_logs_a_warning_and_does_not_raise_when_rasterio_cannot_be_located(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)  # noqa: ARG005

        with caplog.at_level(logging.WARNING, logger="flood_engine.io.proj_env"):
            ensure_compatible_proj_data()  # must not raise

        assert "could not be located" in caplog.text

    def test_logs_a_warning_and_does_not_raise_when_bundled_dir_is_missing(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        monkeypatch.setattr(Path, "is_dir", lambda self: False)  # noqa: ARG005

        with caplog.at_level(logging.WARNING, logger="flood_engine.io.proj_env"):
            ensure_compatible_proj_data()  # must not raise

        assert "was not found" in caplog.text

    def test_real_crs_comparison_works_after_being_applied(self) -> None:
        # End-to-end proof, not just an environment-variable string check:
        # the actual failure mode observed on the development machine was
        # CRS.from_epsg() raising CRSError. This must now succeed.
        from rasterio.crs import CRS

        ensure_compatible_proj_data()

        utm_43n = CRS.from_epsg(32643)
        wgs84 = CRS.from_epsg(4326)

        assert utm_43n == CRS.from_epsg(32643)
        assert utm_43n != wgs84
