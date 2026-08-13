"""Turns raw loaded sources (``flood_engine.io``) into model-ready ``flood_engine.inputs``.

- ``dem_preprocessing``        -> reprojects/aligns the SRTM DEM to
  the model grid (NMS "Grid": UTM 43N, 30m, AOI-checked against DEM-derived
  flow direction per the NMS's explicit warning against reusing the
  heat-exposure AOI verbatim).
- ``landcover_preprocessing``  -> majority-resamples ESA WorldCover to the
  model grid and applies the single shared land-cover crosswalk table (NMS
  "Static inputs") that drives both roughness and Curve Number infiltration.
- ``building_rasterization``   -> rasterizes OSM building footprints to the
  binary obstruction mask using the frozen >=50% cell-coverage rule (NMS
  "Static inputs" / "Building obstruction").

Each module here is the only place a specific frozen NMS rasterization/
resampling rule is encoded — the rule is applied once, and consumed as
already-correct data everywhere else.
"""
