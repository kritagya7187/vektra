"""flood_engine.aoi: real municipal boundary acquisition."""

from flood_engine.aoi.boundary import (
    AoiError,
    BoundaryProvenance,
    fetch_mumbai_municipal_boundary,
)

__all__ = ["AoiError", "BoundaryProvenance", "fetch_mumbai_municipal_boundary"]
