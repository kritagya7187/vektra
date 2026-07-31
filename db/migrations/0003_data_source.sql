-- VEKTRA Database — Migration 0003
-- data_source: closed lookup table enumerating the external data sources
-- listed in the EDD, used for referential integrity on
-- data_provenance_record.source_code.
--
-- This is NOT one of the entities named in EDD Section 16 — it is an
-- implementation-level normalization added so provenance rows cannot
-- reference an undocumented source. The set of rows it may ever contain
-- is closed by EDD Section 13 (Data Sources) and Section 8 (External
-- systems).
--
-- TomTom and Cesium ion are intentionally excluded from this table:
-- TomTom is an optional, currently unused future input whose use as a
-- heat-index input is explicitly "speculative" and "deferred to Section
-- 38" (Section 13); Cesium ion is 3D asset hosting/streaming, not a
-- dataset ingested into this database (Section 8, Section 20).

CREATE TABLE data_source (
    source_code   TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    license       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_data_source_no_update
    BEFORE UPDATE ON data_source
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_update();

COMMENT ON TABLE data_source IS
    'Closed set of external data sources listed in EDD Section 13. Referenced by data_provenance_record.source_code.';
COMMENT ON COLUMN data_source.license IS
    'License/attribution requirement for this source, per EDD Section 24.';
