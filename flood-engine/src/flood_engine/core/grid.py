"""Frozen constants from the Numerical Model Specification's "Grid" section.

Single source of truth for the model grid's target coordinate system and
resolution -- both frozen by the NMS, neither a deployment setting
(``flood_engine.config``) nor a per-scenario input
(``flood_engine.scenario``). Changing either is a scientific decision
requiring the same review as any other NMS change, never a routine code
edit.

Deliberately expressed as a plain EPSG integer code, **not** a
``rasterio.crs.CRS`` object: ``flood_engine.core`` must never import
rasterio (the architecture rule stated in ``core/__init__.py`` and
reconfirmed by the Step 6 architecture audit). Consumers that need an
actual CRS object -- e.g. ``flood_engine.preprocessing``, which is allowed
to import rasterio -- construct one from this code themselves
(``CRS.from_epsg(MODEL_GRID_EPSG_CODE)``).

Deliberately minimal: only the two constants Step 7 (DEM preprocessing)
actually needs. The NMS's Grid section also covers the AOI, which is
**not** represented here -- the NMS itself treats AOI determination as an
unresolved task item ("must be checked against DEM-derived flow
direction... not assumed solved by reusing the old box"), not a frozen
fact, so there is nothing to encode yet.
"""

from typing import Final

MODEL_GRID_EPSG_CODE: Final[int] = 32643
"""UTM Zone 43N -- the model grid's CRS (NMS "Grid": "WGS84 degrees are not usable here")."""

MODEL_GRID_RESOLUTION_M: Final[float] = 30.0
"""Target model grid resolution in meters (NMS "Grid").

Matches SRTM's native ~30m (1 arc-second) posting -- the DEM this
project actually ingests (source code ``srtm_dem``, via GEE and
OpenTopography). An earlier version of this comment said "Copernicus
GLO-30"; no Copernicus GLO-30 data has ever been ingested by this
project, so that was corrected to match the real ingested source, not
the other way around.
"""
