-- VEKTRA Database — Migration 0012
-- heat_exposure_result: HeatExposureResult entity (EDD Section 16),
-- Derived/Computed Layer (Section 15). One row per (simulation_run,
-- building) pair — "a Building has many HeatExposureResults (one per
-- SimulationRun in which it participated); a SimulationRun has many
-- HeatExposureResults" (Section 16, Key relationships).
--
-- index_value is nullable. Section 18 ("Combination") states the
-- normalization method and weights that would produce a single composite
-- value are "Requires future implementation" and "must be defined,
-- justified, and version-controlled before the index is presented as
-- anything other than a set of independent, per-factor values." Until
-- that methodology exists, a run may only populate per-factor values (see
-- heat_exposure_factor_value, migration 0013) and leave index_value NULL.

CREATE TABLE heat_exposure_result (
    result_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        UUID NOT NULL REFERENCES simulation_run(run_id),
    building_id   UUID NOT NULL REFERENCES building(building_id),
    index_value   NUMERIC,
    computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_result_run_building UNIQUE (run_id, building_id)
);

CREATE INDEX idx_result_run_id ON heat_exposure_result (run_id);
CREATE INDEX idx_result_building_id ON heat_exposure_result (building_id);

CREATE TRIGGER trg_result_no_update
    BEFORE UPDATE ON heat_exposure_result
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_update();

COMMENT ON TABLE heat_exposure_result IS
    'HeatExposureResult entity (EDD Section 16). One row per building per simulation run.';
COMMENT ON COLUMN heat_exposure_result.index_value IS
    'Composite Heat Exposure Index. NULL until the combination methodology (Section 18) is defined; TODO per that section.';
