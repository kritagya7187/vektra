-- VEKTRA Database — Migration 0015
-- Adds ERA5 as a second, independently-credentialed meteorological
-- source alongside Open-Meteo (Remote Sensing Strategy Change: Google
-- Earth Engine becomes the primary acquisition provider). ERA5-Land
-- (ECMWF/Copernicus Climate Change Service reanalysis, real dataset
-- ECMWF/ERA5_LAND/HOURLY on Earth Engine) is ingested as a second POINT
-- time-series source into the SAME meteorological_observation table
-- Open-Meteo already uses — same row shape (location, timestamp,
-- variable, value, unit), same MeteorologicalObservationClient
-- interface, same MeteorologicalIngestionService, same
-- computeMeteorologicalContextFactor consumer — not a new table or a
-- gridded raster asset, since its real use in this project is the same
-- kind of point reading Open-Meteo already supplies.
--
-- meteorological_observation.source_code was deliberately closed to
-- exactly 'open_meteo' in migration 0007; this migration loosens it to
-- the smallest change that admits 'era5' too, per the same "closed set,
-- not an open string" reasoning migration 0007 itself already
-- documents — the constraint stays closed, just to two values now.

ALTER TABLE meteorological_observation
    DROP CONSTRAINT meteorological_observation_source_code_check;

ALTER TABLE meteorological_observation
    ADD CONSTRAINT meteorological_observation_source_code_check
        CHECK (source_code IN ('open_meteo', 'era5'));
