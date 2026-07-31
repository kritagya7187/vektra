-- VEKTRA Database — Migration 0009
-- simulation_run_input_dataset: join table recording the exact set of
-- dataset versions (data_provenance_record rows) consumed by a given
-- simulation run.
--
-- This table is what realizes, at the schema level:
--   - FR-12: "record, for every simulation run, the exact input dataset
--     versions and code version used, sufficient to reproduce the run."
--   - Section 17, point 3: a run "writes results tagged with a run
--     identifier, the code version, and the exact input version
--     identifiers used."
--   - The "dataset versions" tracking requirement given for this task —
--     see db/README.md for why this is a join table rather than a
--     duplicate "dataset_version" table (also explained in migration
--     0004).
--
-- A run typically consumes multiple dataset versions at once (an OSM
-- batch, an SRTM tile, a Sentinel-2 scene, a Landsat scene, a WorldCover
-- tile, an Open-Meteo pull), hence a many-to-many join rather than a
-- single foreign key on simulation_run.

CREATE TABLE simulation_run_input_dataset (
    run_id         UUID NOT NULL REFERENCES simulation_run(run_id),
    provenance_id  UUID NOT NULL REFERENCES data_provenance_record(provenance_id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (run_id, provenance_id)
);

CREATE INDEX idx_run_input_dataset_provenance_id ON simulation_run_input_dataset (provenance_id);

CREATE TRIGGER trg_run_input_dataset_no_update
    BEFORE UPDATE ON simulation_run_input_dataset
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_update();

COMMENT ON TABLE simulation_run_input_dataset IS
    'Join of simulation_run to the exact data_provenance_record rows (dataset versions) it consumed. Implements FR-12 and EDD Section 17 reproducibility.';
