"""Guards against a real, observed PROJ/GDAL environment conflict.

On at least one development machine, a system-wide ``PROJ_LIB``
environment variable (set by a local PostgreSQL/PostGIS installation)
points GDAL/PROJ at a ``proj.db`` version incompatible with the one
rasterio's own wheel bundles and expects. Every CRS operation
(``CRS.from_epsg(...)``, comparing two CRS objects, opening a
georeferenced raster) then fails with a cryptic
``rasterio.errors.CRSError`` / ``CPLE_AppDefinedError`` whose message
("DATABASE.LAYOUT.VERSION.MINOR ... contains ... a number >= 6 is
expected") gives no indication it is an environment conflict rather than
a code bug.

This is an environment conflict, not a flood-engine bug, and is
deliberately **not** "fixed" by editing the machine's global/persistent
environment variables -- that would affect other software on the same
machine (e.g. the real ``psql``/PostGIS tools, which need their own real
``proj.db``, not rasterio's). Instead, :func:`ensure_compatible_proj_data`
overrides ``PROJ_DATA`` for *this process only*.

**Load-bearing correctness detail, found only by actually running this,
not assumed**: ``import rasterio`` itself -- via GDAL driver
auto-registration -- eagerly initializes a PROJ context from whatever
``PROJ_DATA``/``PROJ_LIB`` is in the environment *at import time*, not
lazily on first CRS operation as first assumed. Setting the environment
variable via ``os.environ[...]`` *after* ``import rasterio`` has already
run is too late -- the wrong value is already baked into PROJ's internal
state for the rest of the process. This module therefore locates
rasterio's bundled ``proj_data`` directory via
:func:`importlib.util.find_spec`, which resolves a module's file location
**without executing its `__init__.py`** -- rasterio is never imported by
this module at all, so the environment variable is guaranteed correct
before rasterio (or anything that imports it, such as
``flood_engine.io.raster_loader``) is imported for the first time
anywhere in the process.
"""

import importlib.util
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def ensure_compatible_proj_data() -> None:
    """Point ``PROJ_DATA`` at rasterio's own bundled PROJ database, for this process only.

    Must be called once, as early as possible in any process that will
    use rasterio/pyproj/geopandas -- and, critically, *before rasterio has
    been imported by anything else in the process* (see the module
    docstring's correctness note). ``tests/conftest.py`` calls this at
    collection time, before any test module can import rasterio; the real
    service entrypoint (Step 15) must call it as the very first line of
    its startup, before any other import.

    A no-op (with a warning) if rasterio's package cannot be located, or
    its bundled ``proj_data`` directory is missing -- e.g. rasterio is not
    installed yet, or a packaging change in a future rasterio version --
    in which case whatever ``PROJ_DATA``/``PROJ_LIB`` the environment
    already provides is left alone rather than raising: this is a
    defensive workaround, not a hard requirement of the package.
    """
    spec = importlib.util.find_spec("rasterio")
    if spec is None or spec.origin is None:
        logger.warning(
            "rasterio could not be located (is it installed?) -- leaving "
            "PROJ_DATA/PROJ_LIB as already set in the environment."
        )
        return

    bundled_proj_data = Path(spec.origin).parent / "proj_data"
    if not bundled_proj_data.is_dir():
        logger.warning(
            "rasterio's bundled proj_data directory was not found at %s -- "
            "leaving PROJ_DATA/PROJ_LIB as already set in the environment. "
            "If CRS operations fail with a PROJ database version error, this is why.",
            bundled_proj_data,
        )
        return

    os.environ["PROJ_DATA"] = str(bundled_proj_data)
