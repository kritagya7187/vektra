-- VEKTRA Database — Migration 0013
-- heat_exposure_factor_value: child of heat_exposure_result, realizing
-- Section 16's "per-factor contributing values (Section 18)" for
-- HeatExposureResult. Normalized into its own table (one row per factor
-- per result) rather than five wide nullable columns, so that adding or
-- retiring a candidate factor never requires a schema migration.
--
-- factor_key is constrained to exactly the five candidate conceptual
-- factors named in EDD Section 18. is_computable operationalizes Section
-- 18's explicit instruction for the exposure/shading factor — generalized
-- here to any factor — that when a factor cannot be computed from
-- available data, it "must be explicitly marked as 'not computable with
-- available data' rather than approximated with invented values."

CREATE TABLE heat_exposure_factor_value (
    factor_value_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id         UUID NOT NULL REFERENCES heat_exposure_result(result_id),
    factor_key        TEXT NOT NULL CHECK (factor_key IN (
                            'thermal_signature',
                            'vegetation_land_cover',
                            'morphology_density',
                            'exposure_shading',
                            'meteorological_context'
                        )),
    factor_value      NUMERIC,
    is_computable     BOOLEAN NOT NULL DEFAULT TRUE,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_factor_value_per_result UNIQUE (result_id, factor_key),
    CONSTRAINT chk_factor_value_computable
        CHECK (is_computable OR factor_value IS NULL)
);

CREATE INDEX idx_factor_value_result_id ON heat_exposure_factor_value (result_id);
CREATE INDEX idx_factor_value_factor_key ON heat_exposure_factor_value (factor_key);

CREATE TRIGGER trg_factor_value_no_update
    BEFORE UPDATE ON heat_exposure_factor_value
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_update();

COMMENT ON TABLE heat_exposure_factor_value IS
    'Per-factor contributing values for a HeatExposureResult (EDD Section 16, 18).';
COMMENT ON COLUMN heat_exposure_factor_value.is_computable IS
    'FALSE marks a factor as "not computable with available data" per EDD Section 18, instead of approximating it with an invented value.';
COMMENT ON COLUMN heat_exposure_factor_value.notes IS
    'Free-text explanation, e.g. why exposure_shading was not computable for a given building (insufficient OSM height coverage, Section 13/18).';
