-- VEKTRA Database — Migration 0005
-- building: Building entity, Static Geometric Layer (EDD Section 15, 16).
-- Represents one immutable, versioned snapshot of an OSM building
-- footprint as ingested for a given provenance batch (FR-1). Geometry is
-- never altered once ingested, by any process, under any circumstance
-- (Section 5, 9, 15) — enforced below by the append-only trigger, which
-- covers the whole row, not only the geometry columns, consistent with
-- Section 15's description of the whole static geometric layer as
-- "Immutable once ingested for a given OSM snapshot".
--
-- osm_type distinguishes OSM ways from multipolygon relations. This is a
-- factual property of the OpenStreetMap data model required to represent
-- footprints correctly under FR-1; it is not itself named in EDD Section
-- 16, but is necessary to ingest real OSM data without loss of structure.
--
-- Dual geometry columns implement the Section 14 Engineering Decision to
-- "store vector data in WGS84 (EPSG:4326) for interchange and in a
-- projected CRS suitable for metric analysis... UTM zone 43N (EPSG:32643)".
-- geom_utm43n is derived automatically from geom_wgs84 by the trigger
-- below when not supplied directly by the ingestion pipeline, because
-- PostGIS's ST_Transform() is STABLE (depends on spatial_ref_sys), not
-- IMMUTABLE, and therefore cannot be used in a GENERATED ALWAYS AS STORED
-- column expression.
--
-- footprint_area_sqm is a generated column (ST_Area is IMMUTABLE for
-- planar geometry) supporting the building morphology/density factor
-- input described in Section 18 (factor 3: "derived from footprint area...").

CREATE TABLE building (
    building_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    osm_id               BIGINT NOT NULL,
    osm_type             TEXT NOT NULL CHECK (osm_type IN ('way', 'relation')),
    building_tag_type    TEXT,
    name                 TEXT,
    height_m             NUMERIC CHECK (height_m IS NULL OR height_m > 0),
    building_levels      INTEGER CHECK (building_levels IS NULL OR building_levels > 0),
    geom_wgs84           geometry(MultiPolygon, 4326) NOT NULL,
    geom_utm43n          geometry(MultiPolygon, 32643),
    footprint_area_sqm   NUMERIC GENERATED ALWAYS AS (ST_Area(geom_utm43n)) STORED,
    provenance_id        UUID NOT NULL REFERENCES data_provenance_record(provenance_id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_building_osm_snapshot
        UNIQUE (osm_id, osm_type, provenance_id),
    CONSTRAINT chk_building_geom_wgs84_srid
        CHECK (ST_SRID(geom_wgs84) = 4326),
    CONSTRAINT chk_building_geom_utm43n_srid
        CHECK (geom_utm43n IS NULL OR ST_SRID(geom_utm43n) = 32643),
    CONSTRAINT chk_building_geom_wgs84_valid
        CHECK (ST_IsValid(geom_wgs84))
);

CREATE OR REPLACE FUNCTION fn_populate_building_utm_geometry()
RETURNS trigger AS $$
BEGIN
    IF NEW.geom_utm43n IS NULL THEN
        NEW.geom_utm43n := ST_Transform(NEW.geom_wgs84, 32643);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_populate_building_utm_geometry() IS
    'Derives the UTM 43N projected geometry from the canonical WGS84 geometry when not supplied directly (EDD Section 14).';

CREATE TRIGGER trg_building_populate_utm_geometry
    BEFORE INSERT ON building
    FOR EACH ROW EXECUTE FUNCTION fn_populate_building_utm_geometry();

CREATE TRIGGER trg_building_no_update
    BEFORE UPDATE ON building
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_update();

CREATE INDEX idx_building_geom_wgs84_gist ON building USING GIST (geom_wgs84);
CREATE INDEX idx_building_geom_utm43n_gist ON building USING GIST (geom_utm43n);
CREATE INDEX idx_building_osm_id ON building (osm_id);
CREATE INDEX idx_building_provenance_id ON building (provenance_id);

COMMENT ON TABLE building IS
    'Building entity (EDD Section 16), Static Geometric Layer (Section 15). One row per versioned OSM footprint snapshot.';
COMMENT ON COLUMN building.height_m IS
    'OSM "height" tag. Completeness for the study area is unverified (Section 13); expect NULLs.';
COMMENT ON COLUMN building.building_levels IS
    'OSM "building:levels" tag. Completeness for the study area is unverified (Section 13); expect NULLs.';
