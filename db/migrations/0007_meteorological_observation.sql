-- VEKTRA Database — Migration 0007
-- meteorological_observation: MeteorologicalObservation entity
-- (EDD Section 16), Environmental Observation Layer (Section 15).
-- One row per (location, timestamp, variable) reading retrieved from
-- Open-Meteo.
--
-- Modeled as one row per variable (rather than fixed columns per
-- variable) because EDD Section 13 gives only an open-ended example list
-- of variables ("temperature, humidity, wind, solar radiation, etc.") and
-- does not enumerate the exact set VEKTRA will ingest. A fixed-column
-- design would require inventing that closed set; this design does not.
--
-- TODO: the exact set of Open-Meteo variables to ingest, and the unit
-- convention for variable_unit, are Not specified in EDD Section 13 and
-- must be finalized during ingestion implementation (Section 14).

CREATE TABLE meteorological_observation (
    met_observation_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code             TEXT NOT NULL REFERENCES data_source(source_code)
                                 CHECK (source_code = 'open_meteo'),
    observation_timestamp   TIMESTAMPTZ NOT NULL,
    location                 geometry(Point, 4326) NOT NULL,
    variable_name            TEXT NOT NULL,
    variable_value           NUMERIC NOT NULL,
    variable_unit            TEXT NOT NULL,
    provenance_id            UUID NOT NULL REFERENCES data_provenance_record(provenance_id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_met_location_srid CHECK (ST_SRID(location) = 4326),
    CONSTRAINT uq_met_observation
        UNIQUE (location, observation_timestamp, variable_name, provenance_id)
);

CREATE INDEX idx_met_observation_location_gist ON meteorological_observation USING GIST (location);
CREATE INDEX idx_met_observation_timestamp ON meteorological_observation (observation_timestamp);
CREATE INDEX idx_met_observation_variable_name ON meteorological_observation (variable_name);
CREATE INDEX idx_met_observation_provenance_id ON meteorological_observation (provenance_id);

CREATE TRIGGER trg_met_observation_no_update
    BEFORE UPDATE ON meteorological_observation
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_update();

COMMENT ON TABLE meteorological_observation IS
    'MeteorologicalObservation entity (EDD Section 16). One row per variable reading at a representative point (Section 13).';
COMMENT ON COLUMN meteorological_observation.location IS
    'Representative point queried, per Section 13: "the bounding box or representative point(s) within it". Native source resolution is far coarser than a building footprint (Section 13, 37) — must be disclosed as such wherever used.';
