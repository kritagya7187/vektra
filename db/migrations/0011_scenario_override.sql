-- VEKTRA Database — Migration 0011
-- scenario_override: child of scenario, realizing Section 16's "ordered
-- list of attribute overrides (each referencing a building identifier, an
-- attribute name, and an override value)". sequence_number preserves the
-- stated ordering.
--
-- Per Section 19, "only attributes referenced by the Heat Exposure Index
-- methodology (Section 18) may be overridden", and per Section 22 the
-- scenario editor is "scoped to a defined set of overridable attributes."
-- That set itself is never enumerated anywhere in the EDD, so
-- attribute_name is left as free TEXT rather than a CHECK-constrained
-- enum or foreign key to an attribute catalog.
--
-- TODO: the closed set of overridable attributes, and the value type/
-- validation rules for override_value, are Not specified in EDD Section
-- 18/19/22 and must be defined before the Scenario Subsystem (Section 10
-- #5) can enforce them. Application-level validation is expected to
-- narrow this once that set is defined; it is not invented here.

CREATE TABLE scenario_override (
    override_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id       UUID NOT NULL REFERENCES scenario(scenario_id),
    building_id       UUID NOT NULL REFERENCES building(building_id),
    sequence_number   INTEGER NOT NULL CHECK (sequence_number >= 0),
    attribute_name    TEXT NOT NULL,
    override_value    TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_scenario_override_sequence UNIQUE (scenario_id, sequence_number),
    CONSTRAINT uq_scenario_override_attribute UNIQUE (scenario_id, building_id, attribute_name)
);

CREATE INDEX idx_scenario_override_scenario_id ON scenario_override (scenario_id);
CREATE INDEX idx_scenario_override_building_id ON scenario_override (building_id);

CREATE TRIGGER trg_scenario_override_no_update
    BEFORE UPDATE ON scenario_override
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_update();

COMMENT ON TABLE scenario_override IS
    'Ordered attribute-level overrides belonging to a scenario (EDD Section 16, 19). Never modifies the building row it references.';
COMMENT ON COLUMN scenario_override.override_value IS
    'Stored as TEXT: the EDD defines no fixed schema for override value types across attributes. Type coercion is an application-level concern (Section 19).';
