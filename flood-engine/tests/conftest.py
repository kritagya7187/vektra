"""Shared pytest configuration for the flood-engine test suite.

Calls ``ensure_compatible_proj_data()`` before any test module imports
rasterio/pyproj/geopandas and performs a CRS operation -- see
``flood_engine.io.proj_env``'s module docstring for the real environment
conflict this works around. conftest.py is imported by pytest before test
collection begins, which is early enough for this to take effect.
"""

from flood_engine.io.proj_env import ensure_compatible_proj_data

ensure_compatible_proj_data()
