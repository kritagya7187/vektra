# Seed Data

Minimal reference data only. `0001_data_sources.sql` populates the closed set of external data sources named in EDD Section 13/8 — this is factual/reference data transcribed from the EDD, not synthetic test data.

No `building`, `environmental_raster_asset`, `meteorological_observation`, `simulation_run`, `heat_exposure_result`, `scenario`, or `scenario_override` rows are seeded. Fabricating those (a fake footprint geometry, a fake Landsat scene ID, a fake index value) would violate the "no fake data" constraint on this task. Real rows for those tables must come from the ingestion pipeline (Section 14) and simulation engine (Section 17) against the real, currently undefined study-area bounding box (Section 4).

Run after all migrations have been applied:

```
psql -d <database> -f seeds/0001_data_sources.sql
```
