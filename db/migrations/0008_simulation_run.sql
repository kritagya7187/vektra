-- VEKTRA Database — Migration 0008
-- simulation_run: SimulationRun entity (EDD Section 16), Derived/Computed
-- Layer (Section 15). One row per execution of the deterministic
-- simulation engine, whether a baseline run or a scenario-derived run
-- (Section 11).
--
-- Per Section 17, a run is fully determined by (code_version,
-- configuration_version, input dataset version identifiers) — those
-- identity columns must never change after creation, which is why this
-- table is NOT fully append-only like the others: it needs a mutable
-- `status` lifecycle (Section 16: "status"; Section 21: "Trigger and query
-- the status of a simulation run") while its identity columns stay fixed.
-- fn_guard_simulation_run_update() enforces exactly that split.
--
-- baseline_run_id is a self-reference used only by scenario runs, to
-- record "the baseline run identifier it was derived from" (Section 11).

CREATE TABLE simulation_run (
    run_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_version           TEXT NOT NULL,
    configuration_version  TEXT NOT NULL,
    run_type               TEXT NOT NULL CHECK (run_type IN ('baseline', 'scenario')),
    baseline_run_id        UUID REFERENCES simulation_run(run_id),
    status                 TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at             TIMESTAMPTZ,
    completed_at           TIMESTAMPTZ,
    error_message          TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_run_baseline_reference CHECK (
        (run_type = 'baseline' AND baseline_run_id IS NULL) OR
        (run_type = 'scenario' AND baseline_run_id IS NOT NULL)
    )
);

CREATE OR REPLACE FUNCTION fn_guard_simulation_run_update()
RETURNS trigger AS $$
BEGIN
    IF NEW.code_version          IS DISTINCT FROM OLD.code_version OR
       NEW.configuration_version IS DISTINCT FROM OLD.configuration_version OR
       NEW.run_type              IS DISTINCT FROM OLD.run_type OR
       NEW.baseline_run_id       IS DISTINCT FROM OLD.baseline_run_id OR
       NEW.created_at            IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION
            'simulation_run identity columns (code_version, configuration_version, run_type, baseline_run_id, created_at) are immutable per EDD Section 17 (run_id: %)',
            OLD.run_id;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_guard_simulation_run_update() IS
    'Allows only status/started_at/completed_at/error_message to change on a simulation_run; identity columns are frozen at creation (EDD Section 17).';

CREATE TRIGGER trg_simulation_run_guard_update
    BEFORE UPDATE ON simulation_run
    FOR EACH ROW EXECUTE FUNCTION fn_guard_simulation_run_update();

CREATE INDEX idx_simulation_run_status ON simulation_run (status);
CREATE INDEX idx_simulation_run_type ON simulation_run (run_type);
CREATE INDEX idx_simulation_run_baseline_run_id ON simulation_run (baseline_run_id);
CREATE INDEX idx_simulation_run_code_version ON simulation_run (code_version);

COMMENT ON TABLE simulation_run IS
    'SimulationRun entity (EDD Section 16, 17). One row per baseline or scenario simulation execution.';
COMMENT ON COLUMN simulation_run.configuration_version IS
    'Versioned run configuration identifier (Section 17, 27). No separate configuration table is defined — EDD Section 16/17 describe this only as a version identifier, not a distinct entity.';
