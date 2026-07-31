-- VEKTRA Database — Migration 0004
-- data_provenance_record: DataProvenanceRecord entity (EDD Section 16),
-- carrying the minimum required fields from the Data Provenance Strategy
-- (Section 24): source name, source product/scene/tile identifier,
-- retrieval timestamp, license/attribution, ingestion pipeline version,
-- and checksum "where feasible".
--
-- Design note — no separate "dataset_version" table:
-- EDD Section 27 (Versioning Strategy) defines "Dataset version" as
-- "every ingested batch is tagged with a version identifier (e.g., an
-- ingestion run timestamp plus source product identifiers)". That is
-- structurally identical to what this table already carries
-- (source_product_identifier + retrieval_timestamp), and EDD Section 16's
-- own stated relationship is that "every Building, EnvironmentalRasterAsset,
-- and MeteorologicalObservation references exactly one DataProvenanceRecord"
-- — singular, not a provenance reference plus a separate version reference.
-- Introducing a second, parallel "dataset_version" entity would duplicate
-- this table's fields and contradict that stated one-reference relationship.
-- The "dataset versions used by a SimulationRun" requirement (FR-12,
-- Section 17 point 3) is instead realized via the
-- simulation_run_input_dataset join table (migration 0009), which links a
-- run to the exact set of data_provenance_record rows it consumed.
-- See db/README.md for the full rationale.

CREATE TABLE data_provenance_record (
    provenance_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code                 TEXT NOT NULL REFERENCES data_source(source_code),
    source_product_identifier   TEXT NOT NULL,
    retrieval_timestamp         TIMESTAMPTZ NOT NULL,
    license                     TEXT NOT NULL,
    ingestion_pipeline_version  TEXT NOT NULL,
    checksum                    TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_provenance_batch
        UNIQUE (source_code, source_product_identifier, retrieval_timestamp)
);

CREATE INDEX idx_provenance_source_code ON data_provenance_record (source_code);
CREATE INDEX idx_provenance_retrieval_timestamp ON data_provenance_record (retrieval_timestamp);

CREATE TRIGGER trg_provenance_no_update
    BEFORE UPDATE ON data_provenance_record
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_update();

COMMENT ON TABLE data_provenance_record IS
    'DataProvenanceRecord (EDD Section 16, 24). Also fulfills the "dataset version" role described in Section 27 — see migration header.';
COMMENT ON COLUMN data_provenance_record.source_product_identifier IS
    'e.g. Landsat scene ID, Sentinel-2 tile ID, ESA WorldCover tile+version, OSM changeset or extract timestamp (Section 24).';
COMMENT ON COLUMN data_provenance_record.retrieval_timestamp IS
    'Ingestion time — when VEKTRA fetched the data, distinct from the data''s own observation/acquisition time (Section 26).';
COMMENT ON COLUMN data_provenance_record.checksum IS
    'Checksum of the retrieved artifact "where feasible" (Section 24); nullable by design.';
