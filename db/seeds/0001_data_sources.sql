-- VEKTRA Database — Seed 0001
-- Populates the closed set of external data sources (EDD Section 13,
-- Section 8). This is reference/lookup data transcribed directly from the
-- EDD, not synthetic test data.
--
-- No building, environmental_raster_asset, meteorological_observation,
-- simulation_run, heat_exposure_result, scenario, or scenario_override
-- rows are seeded. Populating those with fabricated values (a fake
-- footprint geometry, a fake Landsat scene ID, a fake index value) would
-- violate the "no fake data / do not invent values" constraint on this
-- task. Real rows for those tables can only come from the ingestion
-- pipeline (Section 14) and simulation engine (Section 17) once
-- implemented, against the real, currently undefined study-area bounding
-- box (Section 4).

INSERT INTO data_source (source_code, display_name, license) VALUES
    ('osm_overpass',   'OpenStreetMap / Overpass API',                          'ODbL (Open Database License)'),
    ('srtm_dem',       'SRTM Digital Elevation Model (USGS EarthExplorer)',     'Public domain (USGS)'),
    ('sentinel2_l2a',  'Sentinel-2 Level-2A (Copernicus Data Space Ecosystem)', 'Free, open — Copernicus data terms'),
    ('landsat_c2_l2',  'Landsat Collection 2 Level-2 (USGS EarthExplorer)',     'Public domain (USGS)'),
    ('esa_worldcover', 'ESA WorldCover',                                       'Free, no restriction on use — attribution required'),
    ('open_meteo',     'Open-Meteo',                                           'Free for non-commercial use — CC BY 4.0 attribution'),
    -- Added by migration 0015 (Remote Sensing Strategy Change: Google
    -- Earth Engine acquisition). ERA5-Land reanalysis, produced by
    -- ECMWF for the Copernicus Climate Change Service (C3S).
    ('era5',           'ERA5-Land (ECMWF / Copernicus Climate Change Service)', 'Free — Copernicus Climate Change Service license, attribution required');
