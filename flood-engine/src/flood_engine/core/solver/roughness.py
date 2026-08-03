"""core.solver.roughness: NMS "Roughness - Manning's n per land-cover class".

Implements the land-cover -> Manning's-*n* crosswalk table frozen in the
Numerical Model Specification. Consumes ESA WorldCover v100/v200 class
codes (the same codes ``preprocessing.landcover_preprocessing.preprocess_landcover``
produces, untouched) and returns the ``manning_n`` grid
``core.solver.wca2d.DomainInputs`` requires -- this is the module Step 1's
own layout assigned that responsibility to, built here for the first time
(Steps 1-17 documented it but never implemented it; see the Step 18
architecture-verification finding this module resolves).

Pure NumPy only, matching every other ``core`` module's "no rasterio, no
I/O" constraint -- the caller is responsible for having already produced
the plain class-code array (``RasterDataset.data``), this module attaches
no meaning to *how* that array was produced.

Point values below are the midpoint of the NMS's own frozen "typical
range" table, cited against Chow, V.T., *Open-Channel Hydraulics*
(McGraw-Hill, 1959) -- the exact source the NMS's own text names as the
one to check against "at implementation time before being hardcoded".
Picking a single point value from a published range is disclosed
engineering judgment, not an invented number (the same class of decision
already made and documented for ``SolverParameters.alpha``,
``time_mindt_s``/``time_maxdt_s`` in the Step 10.5/11A Numerical Parameter
Specification).
"""

from typing import Final

import numpy as np
from numpy.typing import NDArray

# Real ESA WorldCover v100/v200 class codes (confirmed against this
# project's own existing usage in
# tests/integration/test_landcover_preprocessing.py and the backend
# ingestion pipeline) -- not invented here.
TREE_COVER: Final[int] = 10
SHRUBLAND: Final[int] = 20
GRASSLAND: Final[int] = 30
CROPLAND: Final[int] = 40
BUILT_UP: Final[int] = 50
BARE_SPARSE_VEGETATION: Final[int] = 60
SNOW_AND_ICE: Final[int] = 70
PERMANENT_WATER_BODIES: Final[int] = 80
HERBACEOUS_WETLAND: Final[int] = 90
MANGROVES: Final[int] = 95
MOSS_AND_LICHEN: Final[int] = 100

# NMS "Roughness" table, frozen ranges -> point value chosen as each
# range's midpoint (rounded to the same precision the NMS table itself
# uses):
#   Built-up / paved:            0.013-0.020 -> 0.016
#   Bare soil:                   0.020-0.030 -> 0.025
#   Grassland / short vegetation: 0.030-0.050 -> 0.040
#   Cropland:                    0.035-0.045 -> 0.040
#   Tree cover / shrubland:      0.080-0.160 -> 0.120
#   Open water:                  0.020-0.035 -> 0.028
MANNING_N_BY_LANDCOVER_CLASS: Final[dict[int, float]] = {
    TREE_COVER: 0.120,
    SHRUBLAND: 0.120,
    GRASSLAND: 0.040,
    CROPLAND: 0.040,
    BUILT_UP: 0.016,
    BARE_SPARSE_VEGETATION: 0.025,
    PERMANENT_WATER_BODIES: 0.028,
}
"""The frozen NMS table does not address snow/ice, herbaceous wetland,
mangroves, or moss/lichen -- all real ESA WorldCover classes, but not
physically plausible for the Mumbai AOI this project targets, and not
covered by any range in the NMS's own "Roughness" section. Deliberately
absent rather than guessed at; :func:`roughness_grid` raises on any class
code not in this table rather than silently defaulting, matching this
project's standing rule against fabricating values (the same discipline
already applied to ``isHeightEstimated`` and the building multi-cell
max-depth convention)."""

BUILDING_MANNING_N_PLACEHOLDER: Final[float] = MANNING_N_BY_LANDCOVER_CLASS[BUILT_UP]
"""``DomainInputs.__post_init__`` requires ``manning_n`` to be strictly
positive *everywhere*, including building cells -- even though
``core.solver.wca2d.step()`` masks building cells out of every
roughness-driven computation entirely (``mask = ~domain.building_mask``,
confirmed by reading the solver directly). This value is therefore
provably inert wherever ``building_mask`` is ``True``: it exists only to
satisfy that validation, not because it affects any real computation.
Reuses the built-up/paved value on the physical grounds that a building
footprint's own surface is built-up/paved, not because the number itself
matters."""


class RoughnessError(Exception):
    """Raised when a land-cover grid cannot be converted to a valid Manning's-n grid."""


def roughness_grid(
    landcover_class_codes: NDArray[np.integer],
    *,
    building_mask: NDArray[np.bool_] | None = None,
) -> NDArray[np.float64]:
    """Map a land-cover class-code grid to a Manning's-*n* roughness grid.

    Args:
        landcover_class_codes: ESA WorldCover class codes, one per model
            cell, as produced by
            :func:`~flood_engine.preprocessing.landcover_preprocessing.preprocess_landcover`
            (``RasterDataset.data``, untouched).
        building_mask: Where ``True``, the cell is a building footprint
            (per :func:`~flood_engine.preprocessing.building_rasterization.rasterize_buildings`).
            When supplied, building cells are assigned
            :data:`BUILDING_MANNING_N_PLACEHOLDER` regardless of their
            underlying land-cover class code -- a real building footprint
            commonly reports a plausible-but-irrelevant class code (e.g.
            "built-up" or a misclassified neighbor), and since the value
            is provably inert under a building, there is no reason to
            require its land-cover code be in the crosswalk table at all.
            When omitted, every cell is mapped strictly by its land-cover
            code.

    Returns:
        A ``manning_n`` grid of the same shape, ready for
        :class:`~flood_engine.core.solver.wca2d.DomainInputs`.

    Raises:
        RoughnessError: if ``landcover_class_codes`` contains a class code
            absent from :data:`MANNING_N_BY_LANDCOVER_CLASS`, at a cell
            not covered by ``building_mask``.
    """
    if building_mask is not None and building_mask.shape != landcover_class_codes.shape:
        raise RoughnessError(
            f"building_mask has shape {building_mask.shape}, expected "
            f"{landcover_class_codes.shape} (same as landcover_class_codes)."
        )

    codes_to_check = landcover_class_codes
    if building_mask is not None:
        codes_to_check = landcover_class_codes[~building_mask]

    known_codes = set(MANNING_N_BY_LANDCOVER_CLASS)
    unknown_codes = sorted(set(np.unique(codes_to_check).tolist()) - known_codes)
    if unknown_codes:
        raise RoughnessError(
            f"landcover_class_codes contains class code(s) {unknown_codes} not present "
            "in the frozen NMS roughness table -- refusing to guess a Manning's-n value. "
            f"Known classes: {sorted(MANNING_N_BY_LANDCOVER_CLASS)}."
        )

    manning_n = np.zeros(landcover_class_codes.shape, dtype=np.float64)
    for class_code, value in MANNING_N_BY_LANDCOVER_CLASS.items():
        manning_n[landcover_class_codes == class_code] = value

    if building_mask is not None:
        manning_n[building_mask] = BUILDING_MANNING_N_PLACEHOLDER

    return manning_n


__all__ = [
    "BARE_SPARSE_VEGETATION",
    "BUILDING_MANNING_N_PLACEHOLDER",
    "BUILT_UP",
    "CROPLAND",
    "GRASSLAND",
    "HERBACEOUS_WETLAND",
    "MANGROVES",
    "MANNING_N_BY_LANDCOVER_CLASS",
    "MOSS_AND_LICHEN",
    "PERMANENT_WATER_BODIES",
    "RoughnessError",
    "SHRUBLAND",
    "SNOW_AND_ICE",
    "TREE_COVER",
    "roughness_grid",
]
