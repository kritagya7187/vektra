"""core.solver.infiltration: NMS "Infiltration" (SCS Curve Number, pre-processing loss).

Implements the land-cover -> infiltration-rate crosswalk the NMS assigns
to this module (Steps 1-17 documented it but never implemented it; see
the Step 18 architecture-verification finding this module resolves).
Feeds ``infiltration_loss_mm_per_hr`` directly -- the constant per-cell
rate ``core.solver.wca2d.step()``'s existing bucket-removal mechanism
(``remove = min(h, infiltration_rate)``) already consumes; this module
computes that rate, it does not touch the removal mechanism itself.

**Real methodology deviation, disclosed explicitly (Step 18
architecture-review resolution, confirmed by the project owner):** the
classic SCS Curve Number method produces a *cumulative* abstraction curve
(potential retention ``S``), not a constant rate -- converting it to the
single static rate this module must produce would require an unfrozen,
storm-duration-dependent assumption nothing in the NMS specifies. Instead
of deriving a rate from CN's cumulative-retention formula, this module
uses literature-published NRCS/USDA *minimum (final) infiltration rates
by Hydrologic Soil Group* directly -- a real, sourced rate table, not a
converted curve. "SCS Curve Number" in the module's own name refers to
the same land-cover/soil-group classification framework this table is
drawn from, not to running the CN cumulative-abstraction formula itself.

**Single default Hydrologic Soil Group, per the frozen NMS's own stated
assumption** ("VEKTRA has no soil-survey data source"): Group D, the most
conservative (least-infiltration, most-runoff-producing) group -- the
same worst-credible-case convention this project already applies
elsewhere (e.g. the building multi-cell max-depth rule in SDS Section 4).
Because Group D's own published minimum-infiltration-rate range (Musgrave
1955; widely reproduced in NRCS hydrology references) is only
0-1.3 mm/hr regardless of surface cover, land cover's role here is
narrower than roughness's: it distinguishes **impervious** surfaces
(built-up, open water -- zero infiltration capacity by definition,
independent of any soil group) from **pervious** surfaces (every
vegetated/bare-soil class, all sharing the one assumed HSG-D rate) -- it
does not further differentiate infiltration *among* pervious classes,
because HSG-D's own published range does not support inventing
per-vegetation-type multipliers within it.
"""

from typing import Final

import numpy as np
from numpy.typing import NDArray

from flood_engine.core.solver.roughness import (
    BARE_SPARSE_VEGETATION,
    BUILT_UP,
    CROPLAND,
    GRASSLAND,
    HERBACEOUS_WETLAND,
    MANGROVES,
    PERMANENT_WATER_BODIES,
    SHRUBLAND,
    TREE_COVER,
)

IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR: Final[float] = 0.0
"""Built-up/paved surfaces and open water: no soil infiltration pathway
exists, independent of hydrologic soil group -- water is already the
saturated/ponded state infiltration acts on, not a surface it flows into."""

PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR: Final[float] = 1.0
"""The single default-HSG-D rate applied uniformly to every pervious
(vegetated/bare-soil) land-cover class, chosen from the published
Group-D minimum/final infiltration rate range (0-1.3 mm/hr, Musgrave
1955) -- the upper end of that range, a disclosed point choice within a
published range (the same class of decision as
``core.solver.roughness``'s table and the Step 10.5/11A Numerical
Parameter Specification's ``alpha``/``time_mindt_s``/``time_maxdt_s``),
not an invented number."""

INFILTRATION_RATE_BY_LANDCOVER_CLASS: Final[dict[int, float]] = {
    TREE_COVER: PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
    SHRUBLAND: PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
    GRASSLAND: PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
    CROPLAND: PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
    BARE_SPARSE_VEGETATION: PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR,
    BUILT_UP: IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR,
    PERMANENT_WATER_BODIES: IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR,
    # Found missing by running against the real Mumbai extract -- see
    # core.solver.roughness's own table for why mangroves/wetland are
    # really present here. Both are tidally/seasonally saturated
    # substrate, hydrologically closer to standing water than to
    # draining soil, so both get the impervious rate rather than the
    # pervious HSG-D rate.
    MANGROVES: IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR,
    HERBACEOUS_WETLAND: IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR,
}
"""Same class-code coverage as ``core.solver.roughness.MANNING_N_BY_LANDCOVER_CLASS``
(snow/ice, moss/lichen absent for the same reason: not physically
plausible for the Mumbai AOI, not addressed by the frozen NMS).
:func:`infiltration_grid` raises on any other class code rather than
silently defaulting."""

BUILDING_INFILTRATION_RATE_MM_PER_HR: Final[float] = IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR
"""A building footprint's own surface is impervious regardless of its
underlying land-cover class code -- matches
``core.solver.roughness.BUILDING_MANNING_N_PLACEHOLDER``'s reasoning,
though unlike that value this one is also physically correct on its own
terms (buildings are excluded from the flow domain entirely per NMS
"Building obstruction", not merely assigned an inert placeholder)."""


class InfiltrationError(Exception):
    """Raised when a land-cover grid cannot be converted to a valid infiltration-rate grid."""


def infiltration_grid(
    landcover_class_codes: NDArray[np.integer],
    *,
    building_mask: NDArray[np.bool_] | None = None,
) -> NDArray[np.float64]:
    """Map a land-cover class-code grid to an infiltration-rate grid (mm/hr).

    Args:
        landcover_class_codes: ESA WorldCover class codes, one per model
            cell, as produced by
            :func:`~flood_engine.preprocessing.landcover_preprocessing.preprocess_landcover`
            (``RasterDataset.data``, untouched).
        building_mask: Where ``True``, the cell is a building footprint
            (per :func:`~flood_engine.preprocessing.building_rasterization.rasterize_buildings`).
            When supplied, building cells are assigned
            :data:`BUILDING_INFILTRATION_RATE_MM_PER_HR` regardless of
            their underlying land-cover class code, for the same reason
            :func:`~flood_engine.core.solver.roughness.roughness_grid`
            does. When omitted, every cell is mapped strictly by its
            land-cover code.

    Returns:
        An ``infiltration_loss_mm_per_hr`` grid of the same shape, ready
        for :func:`~flood_engine.core.solver.wca2d.step` /
        :func:`~flood_engine.core.timestepping.run_simulation`.

    Raises:
        InfiltrationError: if ``landcover_class_codes`` contains a class
            code absent from :data:`INFILTRATION_RATE_BY_LANDCOVER_CLASS`,
            at a cell not covered by ``building_mask``.
    """
    if building_mask is not None and building_mask.shape != landcover_class_codes.shape:
        raise InfiltrationError(
            f"building_mask has shape {building_mask.shape}, expected "
            f"{landcover_class_codes.shape} (same as landcover_class_codes)."
        )

    codes_to_check = landcover_class_codes
    if building_mask is not None:
        codes_to_check = landcover_class_codes[~building_mask]

    known_codes = set(INFILTRATION_RATE_BY_LANDCOVER_CLASS)
    unknown_codes = sorted(set(np.unique(codes_to_check).tolist()) - known_codes)
    if unknown_codes:
        raise InfiltrationError(
            f"landcover_class_codes contains class code(s) {unknown_codes} not present "
            "in the frozen NMS infiltration table -- refusing to guess an infiltration "
            f"rate. Known classes: {sorted(INFILTRATION_RATE_BY_LANDCOVER_CLASS)}."
        )

    rate = np.zeros(landcover_class_codes.shape, dtype=np.float64)
    for class_code, value in INFILTRATION_RATE_BY_LANDCOVER_CLASS.items():
        rate[landcover_class_codes == class_code] = value

    if building_mask is not None:
        rate[building_mask] = BUILDING_INFILTRATION_RATE_MM_PER_HR

    return rate


__all__ = [
    "BUILDING_INFILTRATION_RATE_MM_PER_HR",
    "IMPERVIOUS_INFILTRATION_RATE_MM_PER_HR",
    "INFILTRATION_RATE_BY_LANDCOVER_CLASS",
    "PERVIOUS_HSG_D_INFILTRATION_RATE_MM_PER_HR",
    "InfiltrationError",
    "infiltration_grid",
]
