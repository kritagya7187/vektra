# Schema Migrations

Numbered, sequential SQL migrations implementing the database foundation. Apply in order — each file assumes the previous ones have already run (foreign keys reference tables created earlier in the sequence).

| File | Creates |
|---|---|
| `0001_extensions.sql` | `postgis`, `pgcrypto` extensions |
| `0002_common_functions.sql` | `fn_prevent_update()` — shared append-only guard |
| `0003_data_source.sql` | `data_source` lookup table |
| `0004_data_provenance_record.sql` | `data_provenance_record` |
| `0005_building.sql` | `building` (+ UTM-derivation trigger) |
| `0006_environmental_raster_asset.sql` | `environmental_raster_asset` |
| `0007_meteorological_observation.sql` | `meteorological_observation` |
| `0008_simulation_run.sql` | `simulation_run` (+ status-guard trigger) |
| `0009_simulation_run_input_dataset.sql` | `simulation_run_input_dataset` (join) |
| `0010_scenario.sql` | `scenario` (+ one-time-update guard trigger) |
| `0011_scenario_override.sql` | `scenario_override` |
| `0012_heat_exposure_result.sql` | `heat_exposure_result` |
| `0013_heat_exposure_factor_value.sql` | `heat_exposure_factor_value` |
| `0014_roles_and_grants.sql` | least-privilege roles (`vektra_ingestion`, `vektra_simulation`, `vektra_backend_api`) |
| `0015_era5_meteorological_source.sql` | loosens `meteorological_observation.source_code`'s CHECK to admit `'era5'` alongside `'open_meteo'` (Remote Sensing Strategy Change: Google Earth Engine acquisition) |

No specific migration tool is assumed (e.g. Flyway, node-pg-migrate, `psql` run in sequence) — that choice is deferred to the engineering team, consistent with how the EDD defers the backend framework choice (Section 12). These files are plain SQL and compatible with any of them.

`db/schema.sql` is the concatenation of these files in order, kept in sync manually — see `db/README.md`.

Full design rationale for every table, relationship, and index: `db/README.md`.
