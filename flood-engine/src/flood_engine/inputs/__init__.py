"""Domain-level representations of the Stage 1 model's static and dynamic inputs.

Holds the typed, in-memory shape of each NMS "Static inputs" / "Dynamic
inputs" source (DEM, land cover, buildings, rainfall) *after* loading and
preprocessing — this package defines what a valid input looks like, not how
it is read from disk or a raster store. Loading lives in
``flood_engine.io``; DEM/land-cover/building-specific preprocessing
pipelines (resampling, rasterization, land-cover-to-roughness/CN crosswalk)
live in ``flood_engine.preprocessing``. Modules here stay free of
``rasterio``/``geopandas`` imports for the same testability reason as
``flood_engine.core``.
"""
