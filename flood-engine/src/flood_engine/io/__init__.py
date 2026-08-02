"""Infrastructure: raster and vector I/O.

Thin wrappers around ``rasterio`` (DEM/land-cover/summary-raster reads and
writes) and ``geopandas``/``shapely`` (OSM building/road/facility vector
reads). This is the only package permitted to open a raster or vector file
directly. Consumers (``flood_engine.preprocessing``) receive validated
:class:`~flood_engine.io.raster_loader.RasterDataset` objects or
GeoDataFrames, never a raw file handle or a bare array.

Deliberately **no re-exports here** (e.g. no ``from flood_engine.io.raster_loader
import RasterDataset, load_raster``), even though that would be more
convenient at call sites (``from flood_engine.io import load_raster``
instead of ``from flood_engine.io.raster_loader import load_raster``).
Python always executes a package's ``__init__.py`` before any of its
submodules -- if this file imported ``raster_loader`` (which imports
``rasterio``), then anything reaching ``flood_engine.io.proj_env``
through this package (as ``tests/conftest.py`` does, to fix a real PROJ/GDAL
environment conflict *before* rasterio is ever imported -- see
``proj_env``'s module docstring) would trigger that same rasterio import
as a side effect of the package initialization, before the fix could run.
This was a real bug, found by running the test suite, not a hypothetical
-- the ergonomics loss is the correct trade against that.
"""
