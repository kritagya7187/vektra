"""persistence.schema: the DDL for the two SDS Section 7 entities Step 16's worker needs.

Raw SQL, not an ORM's declarative schema (see `repository.py`'s module
docstring for why: Step 3's already-frozen dependency decision is raw
`psycopg`, not SQLAlchemy). ``CREATE TABLE IF NOT EXISTS`` -- idempotent,
safe to apply repeatedly, matching how ``ensure_schema`` is used in tests
(called once per test session/fixture, not a migration-versioning system).

**Legal state-transition enforcement**: the Node backend's own
``simulation_run`` precedent enforces this via a DB trigger
(``fn_guard_simulation_run_update``). This schema does not add an
equivalent trigger -- the same safety property (no illegal transition
ever succeeds) is enforced instead by `repository.py`'s conditional
``UPDATE ... WHERE status = '<expected>'`` pattern, checking the affected
row count. Simpler, and sufficient given every transition this repository
performs is already a single, small, well-known set of statements it
controls itself -- not exposed to arbitrary ad-hoc UPDATEs the way the
Node backend's own multi-consumer table is.

**Not yet added to** ``db/migrations/`` -- that directory is the Node
backend's own numbered-migration convention for the *shared* database;
wiring flood-engine's tables into it is a real, reasonable follow-up but
is not one of the files this step was asked to create, and touching it
wasn't necessary to satisfy "worker operates without modification." Noted
as a known limitation in the Step 17 freeze audit, not silently done here.

**``scenario_id`` is ``TEXT``, not ``UUID``**: an earlier version of this
schema used ``UUID``, assuming a format nothing frozen actually specifies
-- no ``flood_scenario`` table exists anywhere (SDS Section 5), so this
column's real format is genuinely undetermined. Caught by a real
constraint-violation failure in integration testing (a plain test string
was correctly rejected as invalid UUID syntax), not assumed away --
``TEXT`` matches what this column actually is: an opaque reference, per
the plan record's Step 17 resolution.

**The three JSON-payload columns are ``TEXT``, not ``JSONB``**: an
earlier version used ``JSONB``. psycopg3 has built-in adapters that
auto-deserialize ``JSONB``/``JSON`` columns into native Python
``dict``s on fetch -- which conflicts with `serialization.py`'s own
contract (``serialize_mass_ledger``/``deserialize_mass_ledger`` treat
these as opaque JSON *strings*, matching ``solver_parameters_json``'s
own equivalent handling in `repository.py`). Caught by a real
``TypeError`` in integration testing (``json.loads()`` on an
already-parsed ``dict``), not assumed away. ``TEXT`` stores the exact
same JSON text; Postgres can still query it via an explicit ``::jsonb``
cast if ever needed, it just isn't auto-parsed on the way back into
Python.
"""

from psycopg import Connection

CREATE_FLOOD_SIMULATION_RUN = """
CREATE TABLE IF NOT EXISTS flood_simulation_run (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id                     TEXT NOT NULL,
    status                          TEXT NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending', 'running', 'completed',
                                                            'failed', 'cancelled')),
    elevation_path                  TEXT NOT NULL,
    building_mask_path              TEXT NOT NULL,
    manning_n_path                  TEXT NOT NULL,
    infiltration_loss_path          TEXT NOT NULL,
    rainfall_rates_path             TEXT NOT NULL,
    solver_parameters_json          TEXT,
    timestepping_parameters_json    TEXT,
    worker_id                       TEXT,
    attempt_count                   INTEGER NOT NULL DEFAULT 0,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at                      TIMESTAMPTZ,
    completed_at                    TIMESTAMPTZ,
    cancelled_at                    TIMESTAMPTZ,
    error_message                   TEXT,
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    aoi_west                        DOUBLE PRECISION,
    aoi_south                       DOUBLE PRECISION,
    aoi_east                        DOUBLE PRECISION,
    aoi_north                       DOUBLE PRECISION,
    elevation_transform_json        TEXT,
    elevation_crs_epsg              INTEGER
);
"""
"""``aoi_*`` (Step 20): the run's AOI bounding box in EPSG:4326 (west,
south, east, north), for map display only -- never read by the solver,
timestepping, or any numeric computation anywhere in this codebase. All
four nullable: most existing runs use tiny synthetic test arrays with no
real geography, and this is purely additive metadata, not a scientific
parameter (see ``pipeline.build_simulation_inputs`` for where it's
computed, from georeferencing that already exists in ``RasterDataset``
but was previously dropped before reaching ``SimulationInputs``).
"""

_ALTER_FLOOD_SIMULATION_RUN_ADD_AOI_COLUMNS = """
ALTER TABLE flood_simulation_run
    ADD COLUMN IF NOT EXISTS aoi_west DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS aoi_south DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS aoi_east DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS aoi_north DOUBLE PRECISION;
"""
"""Forward-migrates any table created before Step 20 by an earlier
``CREATE TABLE IF NOT EXISTS`` call (which is a no-op against an
already-existing table, so the new columns above would never appear on
their own) -- safe/idempotent to run against a table that already has
them, matching this module's existing convention of tolerating repeated
``ensure_schema()`` calls.
"""

_ALTER_FLOOD_SIMULATION_RUN_ADD_ELEVATION_GEOREFERENCING_COLUMNS = """
ALTER TABLE flood_simulation_run
    ADD COLUMN IF NOT EXISTS elevation_transform_json TEXT,
    ADD COLUMN IF NOT EXISTS elevation_crs_epsg INTEGER;
"""
"""Forward-migrates tables created before the real-Mumbai-data city-scale
work added GeoTIFF output support -- same convention as the AOI columns
above."""

CREATE_FLOOD_SIMULATION_RUN_STATUS_INDEX = """
CREATE INDEX IF NOT EXISTS ix_flood_simulation_run_status_created_at
    ON flood_simulation_run (status, created_at);
"""
"""Supports claim_next_pending's `WHERE status='pending' ORDER BY created_at`."""

CREATE_FLOOD_SIMULATION_OUTPUT = """
CREATE TABLE IF NOT EXISTS flood_simulation_output (
    run_id                              UUID PRIMARY KEY
                                             REFERENCES flood_simulation_run(id),
    max_depth_location                  TEXT NOT NULL,
    arrival_time_location                TEXT NOT NULL,
    duration_above_threshold_location   TEXT NOT NULL,
    mass_ledger_json                     TEXT NOT NULL,
    step_count                           INTEGER NOT NULL,
    simulated_duration_s                 DOUBLE PRECISION NOT NULL,
    max_depth_geotiff_path               TEXT,
    arrival_time_geotiff_path            TEXT,
    duration_geotiff_path                TEXT,
    created_at                           TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_ALTER_FLOOD_SIMULATION_OUTPUT_ADD_GEOTIFF_COLUMNS = """
ALTER TABLE flood_simulation_output
    ADD COLUMN IF NOT EXISTS max_depth_geotiff_path TEXT,
    ADD COLUMN IF NOT EXISTS arrival_time_geotiff_path TEXT,
    ADD COLUMN IF NOT EXISTS duration_geotiff_path TEXT;
"""
"""Forward-migrates tables created before GeoTIFF output support was added."""

_STATEMENTS = (
    CREATE_FLOOD_SIMULATION_RUN,
    _ALTER_FLOOD_SIMULATION_RUN_ADD_AOI_COLUMNS,
    _ALTER_FLOOD_SIMULATION_RUN_ADD_ELEVATION_GEOREFERENCING_COLUMNS,
    CREATE_FLOOD_SIMULATION_RUN_STATUS_INDEX,
    CREATE_FLOOD_SIMULATION_OUTPUT,
    _ALTER_FLOOD_SIMULATION_OUTPUT_ADD_GEOTIFF_COLUMNS,
)


def ensure_schema(conn: Connection) -> None:
    """Create both tables (and the supporting index) if they do not already exist.

    Idempotent -- safe to call at the start of every test, or at worker
    startup. Runs as one transaction: either every statement applies, or
    none do.

    Args:
        conn: An open, writable connection.
    """
    with conn.transaction():
        for statement in _STATEMENTS:
            conn.execute(statement)


__all__ = ["ensure_schema"]
