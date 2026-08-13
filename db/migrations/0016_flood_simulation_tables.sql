-- VEKTRA Database — Migration 0016
-- flood_simulation_run / flood_simulation_output: the two tables
-- flood-engine's persistence layer (SDS Section 7) needs. Created here,
-- by the DB init/migration process running as superuser, so the
-- flood-engine runtime role never needs CREATE on schema public.

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

CREATE INDEX IF NOT EXISTS ix_flood_simulation_run_status_created_at
    ON flood_simulation_run (status, created_at);

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

GRANT SELECT, INSERT, UPDATE ON flood_simulation_run, flood_simulation_output TO vektra_simulation;
