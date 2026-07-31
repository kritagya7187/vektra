-- VEKTRA Database — Migration 0010
-- scenario: Scenario entity (EDD Section 16), Scenario/Overlay Layer
-- (Section 15). A named, versioned set of attribute-level overrides
-- applied on top of one baseline simulation run (Section 19).
--
-- Per FR-8/FR-9, a scenario is first defined (baseline_run_id, name,
-- overrides) and only later executed, producing a derived SimulationRun
-- (Section 16: "produces exactly one derived SimulationRun"). That means
-- derived_run_id starts NULL and is set exactly once, after execution —
-- the one legitimate mutation this otherwise append-only table permits
-- (Section 19: "Scenarios are retained indefinitely (append-only)").
-- fn_guard_scenario_update() enforces that.

CREATE TABLE scenario (
    scenario_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baseline_run_id  UUID NOT NULL REFERENCES simulation_run(run_id),
    derived_run_id   UUID REFERENCES simulation_run(run_id),
    name             TEXT NOT NULL,
    description      TEXT,
    created_by       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_scenario_derived_not_baseline
        CHECK (derived_run_id IS NULL OR derived_run_id <> baseline_run_id)
);

CREATE OR REPLACE FUNCTION fn_guard_scenario_update()
RETURNS trigger AS $$
BEGIN
    IF NEW.baseline_run_id IS DISTINCT FROM OLD.baseline_run_id OR
       NEW.name            IS DISTINCT FROM OLD.name OR
       NEW.description     IS DISTINCT FROM OLD.description OR
       NEW.created_by       IS DISTINCT FROM OLD.created_by OR
       NEW.created_at        IS DISTINCT FROM OLD.created_at OR
       (OLD.derived_run_id IS NOT NULL AND NEW.derived_run_id IS DISTINCT FROM OLD.derived_run_id)
    THEN
        RAISE EXCEPTION
            'scenario is append-only per EDD Section 19, except for setting derived_run_id exactly once (scenario_id: %)',
            OLD.scenario_id;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_guard_scenario_update() IS
    'Allows only a one-time transition of derived_run_id from NULL to a value, once a scenario has been executed (EDD Section 19).';

CREATE TRIGGER trg_scenario_guard_update
    BEFORE UPDATE ON scenario
    FOR EACH ROW EXECUTE FUNCTION fn_guard_scenario_update();

CREATE INDEX idx_scenario_baseline_run_id ON scenario (baseline_run_id);
CREATE INDEX idx_scenario_derived_run_id ON scenario (derived_run_id);

COMMENT ON TABLE scenario IS
    'Scenario entity (EDD Section 16, 19). Never modifies baseline geometry or baseline records; overrides are resolved at simulation time (Section 15).';
COMMENT ON COLUMN scenario.created_by IS
    'Free-text identifier of who/what created the scenario, for audit logging (Section 30). Authentication/authorization model is Not specified in EDD Section 23 — no users table is assumed or invented.';
