# VEKTRA — Entity-Relationship Diagram

Reflects `db/schema.sql` / `db/migrations/0001`–`0014`. EDD reference: Section 16 (Database Conceptual Model).

```mermaid
erDiagram
    data_source ||--o{ data_provenance_record : "source_code"
    data_provenance_record ||--o{ building : "provenance_id"
    data_provenance_record ||--o{ environmental_raster_asset : "provenance_id"
    data_provenance_record ||--o{ meteorological_observation : "provenance_id"
    data_provenance_record ||--o{ simulation_run_input_dataset : "provenance_id"
    simulation_run ||--o{ simulation_run_input_dataset : "run_id"
    simulation_run ||--o{ heat_exposure_result : "run_id"
    simulation_run ||--o{ simulation_run : "baseline_run_id (self-reference)"
    simulation_run ||--o{ scenario : "baseline_run_id"
    simulation_run |o--o| scenario : "derived_run_id"
    building ||--o{ heat_exposure_result : "building_id"
    building ||--o{ scenario_override : "building_id"
    scenario ||--o{ scenario_override : "scenario_id"
    heat_exposure_result ||--o{ heat_exposure_factor_value : "result_id"

    data_source {
        text source_code PK
        text display_name
        text license
        timestamptz created_at
        timestamptz updated_at
    }

    data_provenance_record {
        uuid provenance_id PK
        text source_code FK
        text source_product_identifier
        timestamptz retrieval_timestamp
        text license
        text ingestion_pipeline_version
        text checksum
        timestamptz created_at
        timestamptz updated_at
    }

    building {
        uuid building_id PK
        bigint osm_id
        text osm_type
        text building_tag_type
        text name
        numeric height_m
        integer building_levels
        geometry_4326 geom_wgs84
        geometry_32643 geom_utm43n
        numeric footprint_area_sqm "generated"
        uuid provenance_id FK
        timestamptz created_at
        timestamptz updated_at
    }

    environmental_raster_asset {
        uuid raster_asset_id PK
        text source_code FK
        date acquisition_date
        text crs
        numeric resolution_m
        text storage_location
        geometry_4326 spatial_extent
        uuid provenance_id FK
        timestamptz created_at
        timestamptz updated_at
    }

    meteorological_observation {
        uuid met_observation_id PK
        text source_code FK
        timestamptz observation_timestamp
        geometry_4326 location
        text variable_name
        numeric variable_value
        text variable_unit
        uuid provenance_id FK
        timestamptz created_at
        timestamptz updated_at
    }

    simulation_run {
        uuid run_id PK
        text code_version
        text configuration_version
        text run_type
        uuid baseline_run_id FK
        text status
        timestamptz started_at
        timestamptz completed_at
        text error_message
        timestamptz created_at
        timestamptz updated_at
    }

    simulation_run_input_dataset {
        uuid run_id PK_FK
        uuid provenance_id PK_FK
        timestamptz created_at
        timestamptz updated_at
    }

    scenario {
        uuid scenario_id PK
        uuid baseline_run_id FK
        uuid derived_run_id FK
        text name
        text description
        text created_by
        timestamptz created_at
        timestamptz updated_at
    }

    scenario_override {
        uuid override_id PK
        uuid scenario_id FK
        uuid building_id FK
        integer sequence_number
        text attribute_name
        text override_value
        timestamptz created_at
        timestamptz updated_at
    }

    heat_exposure_result {
        uuid result_id PK
        uuid run_id FK
        uuid building_id FK
        numeric index_value
        timestamptz computed_at
        timestamptz created_at
        timestamptz updated_at
    }

    heat_exposure_factor_value {
        uuid factor_value_id PK
        uuid result_id FK
        text factor_key
        numeric factor_value
        boolean is_computable
        text notes
        timestamptz created_at
        timestamptz updated_at
    }
```

## Reading notes

- `geometry_4326` / `geometry_32643` denote PostGIS `geometry(...)` columns constrained to that SRID by a `CHECK (ST_SRID(...) = ...)` constraint — Mermaid's ER syntax has no native spatial type, so this is a documentation convention, not a literal column type name.
- `simulation_run.baseline_run_id` is self-referential: a scenario-type run points back at the baseline run it was derived from (Section 11).
- `scenario` has two independent links to `simulation_run`: `baseline_run_id` (the run it overlays, required at creation) and `derived_run_id` (the run its execution produced, NULL until executed) — see Section 16, "a Scenario references exactly one baseline SimulationRun and produces exactly one derived SimulationRun."
- There is deliberately no `dataset_version` entity. `data_provenance_record` fulfills that role (Section 27), and `simulation_run_input_dataset` is the many-to-many join recording which dataset versions a given run consumed (FR-12). Full rationale in `db/README.md`.
