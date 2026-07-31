-- VEKTRA Database — Migration 0006
-- environmental_raster_asset: EnvironmentalRasterAsset entity
-- (EDD Section 16), Environmental Observation Layer (Section 15).
-- Metadata only — raw raster pixel data is NOT stored in PostGIS. Per
-- Section 16's stated Engineering Decision (open), "PostGIS metadata rows
-- reference files held in a separate object/file store"; the specific
-- object/file storage technology is "Not specified" and is left as a TODO
-- for the ingestion/infra layer. storage_location is therefore an opaque
-- reference string, not a typed path/URL, so this table does not assume a
-- particular storage technology.
--
-- spatial_extent (a bounding-box footprint geometry) is an addition not
-- explicitly named in Section 16, added because it is functionally
-- required to implement the "spatial overlay" mechanism Section 18
-- describes for attributing raster-derived factors (e.g. thermal
-- signature) to individual building footprints — without a stored extent,
-- there is no way to determine which raster assets cover which buildings.

CREATE TABLE environmental_raster_asset (
    raster_asset_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code        TEXT NOT NULL REFERENCES data_source(source_code)
                            CHECK (source_code IN ('srtm_dem', 'sentinel2_l2a', 'landsat_c2_l2', 'esa_worldcover')),
    acquisition_date   DATE NOT NULL,
    crs                TEXT NOT NULL,
    resolution_m       NUMERIC NOT NULL CHECK (resolution_m > 0),
    storage_location   TEXT NOT NULL,
    spatial_extent     geometry(Polygon, 4326) NOT NULL,
    provenance_id      UUID NOT NULL REFERENCES data_provenance_record(provenance_id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_raster_extent_srid CHECK (ST_SRID(spatial_extent) = 4326),
    CONSTRAINT chk_raster_extent_valid CHECK (ST_IsValid(spatial_extent))
);

CREATE INDEX idx_raster_asset_extent_gist ON environmental_raster_asset USING GIST (spatial_extent);
CREATE INDEX idx_raster_asset_source_code ON environmental_raster_asset (source_code);
CREATE INDEX idx_raster_asset_acquisition_date ON environmental_raster_asset (acquisition_date);
CREATE INDEX idx_raster_asset_provenance_id ON environmental_raster_asset (provenance_id);

CREATE TRIGGER trg_raster_asset_no_update
    BEFORE UPDATE ON environmental_raster_asset
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_update();

COMMENT ON TABLE environmental_raster_asset IS
    'EnvironmentalRasterAsset entity (EDD Section 16). One row per ingested SRTM/Sentinel-2/Landsat C2/ESA WorldCover tile or scene.';
COMMENT ON COLUMN environmental_raster_asset.acquisition_date IS
    'Observation time (Section 26). For ESA WorldCover this represents the product epoch (2020 v100 or 2021 v200), not a precise acquisition date (Section 13).';
COMMENT ON COLUMN environmental_raster_asset.storage_location IS
    'Opaque reference to the raster file in the object/file store. Storage technology is Not specified in EDD Section 16/21 — TODO once decided.';
