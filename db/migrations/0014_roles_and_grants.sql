-- VEKTRA Database — Migration 0014
-- Least-privilege database roles per service (EDD Section 33: "Database
-- access: least-privilege database roles per service (e.g., the API layer
-- should not have the same privileges as the ingestion/simulation jobs)").
--
-- These are group roles (NOLOGIN). Actual application login users must be
-- created and granted membership in the appropriate role separately,
-- through a secrets-managed provisioning process — never with a
-- hardcoded password committed to version control (Section 33, "Secrets
-- management: environment variables or a secrets manager, never
-- hardcoded values in the repository").

CREATE ROLE vektra_ingestion NOLOGIN;
CREATE ROLE vektra_simulation NOLOGIN;
CREATE ROLE vektra_backend_api NOLOGIN;

-- Ingestion Subsystem (Section 10 #1, Section 14): writes raw ingested
-- data and its provenance only. Never touches derived results or scenarios.
GRANT SELECT, INSERT ON data_source TO vektra_ingestion;
GRANT SELECT, INSERT ON data_provenance_record TO vektra_ingestion;
GRANT SELECT, INSERT ON building TO vektra_ingestion;
GRANT SELECT, INSERT ON environmental_raster_asset TO vektra_ingestion;
GRANT SELECT, INSERT ON meteorological_observation TO vektra_ingestion;

-- Simulation Subsystem (Section 10 #4, Section 17): reads canonical data
-- and scenario overlays, writes run status and derived results. Also
-- resolves scenario overlays at simulation time (Section 15), so it is
-- the role that sets scenario.derived_run_id once a scenario run completes.
GRANT SELECT ON data_source, data_provenance_record, building,
    environmental_raster_asset, meteorological_observation, scenario,
    scenario_override TO vektra_simulation;
GRANT SELECT, INSERT, UPDATE ON simulation_run TO vektra_simulation;
GRANT SELECT, INSERT ON simulation_run_input_dataset TO vektra_simulation;
GRANT SELECT, INSERT ON heat_exposure_result TO vektra_simulation;
GRANT SELECT, INSERT ON heat_exposure_factor_value TO vektra_simulation;
GRANT UPDATE (derived_run_id) ON scenario TO vektra_simulation;

-- API Subsystem (Section 10 #7, Section 21, 23): read access to
-- everything it serves (FR-11); write access limited to scenario
-- definition (FR-8). The API layer never writes canonical geometry,
-- environmental data, or simulation results directly (Section 9, 11).
GRANT SELECT ON data_source, data_provenance_record, building,
    environmental_raster_asset, meteorological_observation, simulation_run,
    simulation_run_input_dataset, heat_exposure_result,
    heat_exposure_factor_value, scenario, scenario_override
    TO vektra_backend_api;
GRANT INSERT ON scenario, scenario_override TO vektra_backend_api;

-- TODO: whether the backend API directly INSERTs a simulation_run row to
-- "trigger" a run (FR-9, Section 21: "Trigger and query the status of a
-- simulation run") or whether triggering is mediated by a job queue owned
-- by the Scenario/Simulation Subsystem is Not specified in EDD Section
-- 21/23. No INSERT grant on simulation_run is given to vektra_backend_api
-- until this is resolved, to avoid inventing that mechanism here.
