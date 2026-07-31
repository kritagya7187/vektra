-- VEKTRA Database — Migration 0002
-- Shared trigger function enforcing the append-only / immutability
-- semantics of the Digital Twin State Model.
--
-- EDD reference: Section 15 (Digital Twin State Model), Section 7
-- (Determinism, Traceability non-functional requirements).
--
-- Section 15 states, for every layer of the state model, that data is
-- either "immutable once ingested" or "append-only" once computed, and
-- that this layering is what allows determinism and reproducibility "to
-- be satisfied structurally rather than by convention alone." This
-- migration is the structural enforcement mechanism: a BEFORE UPDATE
-- trigger that unconditionally rejects UPDATE statements on tables that
-- represent the static, environmental, or derived/computed layers.
--
-- Corrections to ingested or computed data must be made by inserting a
-- new, separately versioned row (a new provenance batch, a new
-- simulation run, etc.), never by editing an existing one in place.

CREATE OR REPLACE FUNCTION fn_prevent_update()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'table "%" is append-only per EDD Section 15; UPDATE is not permitted',
        TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_prevent_update() IS
    'Blocks UPDATE statements on append-only/immutable tables (EDD Section 15). '
    'Corrections must be made by inserting a new versioned row, never by editing an existing one.';
