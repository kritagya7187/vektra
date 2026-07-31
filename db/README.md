# VEKTRA Database Layer

PostgreSQL + PostGIS schema for the Canonical Storage Subsystem and Derived Results Store (EDD Section 10 #3, Section 16). This directory implements **only the database layer**. No frontend, Cesium, API, simulation, or ingestion application code was written as part of this — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how this layer's boundaries are enforced.

## Contents

- [`schema.sql`](./schema.sql) — full schema, concatenated from `migrations/` in order. Convenience file for standing up a fresh database in one shot.
- [`migrations/`](./migrations/) — 14 numbered, sequential SQL migrations. Source of truth; `schema.sql` must be regenerated if these change (see below).
- [`seeds/`](./seeds/) — minimal reference seed data (the 6 real data sources named in the EDD). No synthetic/fake rows.
- [`schema/ER_DIAGRAM.md`](./schema/ER_DIAGRAM.md) — Mermaid entity-relationship diagram.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Mermaid diagram of this layer's place in VEKTRA's overall architecture (Section 9) and the boundaries it enforces.

## Setup

```
psql -d <database> -f schema.sql
psql -d <database> -f seeds/0001_data_sources.sql
```

or, applying migrations individually in order:

```
for f in migrations/0*.sql; do psql -d <database> -f "$f"; done
psql -d <database> -f seeds/0001_data_sources.sql
```

If a new migration is added to `migrations/`, regenerate `schema.sql` by concatenating all migration files in numeric order (a one-line `cat migrations/0*.sql > schema.sql`-style step, with the header comment preserved).

No specific PostgreSQL version, migration tool, or database-provisioning mechanism is mandated by the EDD (Section 12 states PostgreSQL is "already installed" without a version number). This schema assumes PostgreSQL ≥ 13 and PostGIS ≥ 3.x — verify against the actual deployment target before production use.

---

## Design principles this schema enforces

### 1. Append-only / immutability, structurally (Section 15)

Section 15 (Digital Twin State Model) states that every layer of VEKTRA's state — static geometric, environmental observation, derived/computed, scenario/overlay — is either "immutable once ingested" or "append-only," and that this layering is what allows determinism and reproducibility "to be satisfied structurally rather than by convention alone."

This schema enforces that with `BEFORE UPDATE` triggers, not just documentation:

- **Fully immutable tables** (`data_source`, `data_provenance_record`, `building`, `environmental_raster_asset`, `meteorological_observation`, `simulation_run_input_dataset`, `scenario_override`, `heat_exposure_result`, `heat_exposure_factor_value`) use the shared `fn_prevent_update()` function — any `UPDATE` raises an exception. Corrections must be made by inserting a new versioned row (a new provenance batch, a new run), never by editing one in place.
- **`simulation_run`** has a mutable lifecycle (`status`, `started_at`, `completed_at`, `error_message`) but frozen identity columns (`code_version`, `configuration_version`, `run_type`, `baseline_run_id`) — a run's defining inputs can never change after creation, which is the operational definition of "deterministic and reproducible" per Section 17. `fn_guard_simulation_run_update()` enforces the split.
- **`scenario`** permits exactly one legitimate mutation: setting `derived_run_id` once, after execution (Section 19 — a scenario is defined via FR-8, then executed later via FR-9, and is otherwise "retained indefinitely (append-only)"). `fn_guard_scenario_update()` enforces this.

This is a deliberate, non-obvious engineering decision on top of what Section 16 literally specifies (which states "no schema/DDL is specified here per output constraints"). It operationalizes a constraint repeated across Sections 1, 5, 9, 11, 15, and 19 — most emphatically the Out-of-Scope statement that automated geometry modification is disallowed "at any stage, under any circumstance" (Section 5). If this level of enforcement is heavier than the team wants at this stage, the triggers can be dropped or relaxed per table without touching the rest of the schema.

### 2. Dual geometry storage (Section 14)

Section 14's Engineering Decision: store vector data "in WGS84 (EPSG:4326) for interchange and in a projected CRS suitable for metric analysis... UTM zone 43N (EPSG:32643)." `building` has both `geom_wgs84` and `geom_utm43n`. They cannot be linked via a `GENERATED` column because PostGIS's `ST_Transform()` is `STABLE` (depends on the `spatial_ref_sys` table), not `IMMUTABLE`, which PostgreSQL requires for generated column expressions. Instead, a `BEFORE INSERT` trigger (`fn_populate_building_utm_geometry`) derives `geom_utm43n` from `geom_wgs84` automatically when the ingestion pipeline doesn't supply it directly. `footprint_area_sqm` *is* a `GENERATED` column, since `ST_Area()` on a projected geometry is `IMMUTABLE`.

### 3. No `dataset_version` table

The task listed "Dataset versions" as a required entity, but no separate table for it exists in this schema. Reasoning:

- Section 27 (Versioning Strategy) defines "Dataset version" as "every ingested batch is tagged with a version identifier (e.g., an ingestion run timestamp plus source product identifiers)."
- `data_provenance_record` already carries exactly that: `source_product_identifier` + `retrieval_timestamp` (Section 24's minimum required fields).
- Section 16's own stated relationship is singular: "every Building, EnvironmentalRasterAsset, and MeteorologicalObservation references **exactly one** DataProvenanceRecord" — not one provenance reference plus a separate version reference.

Introducing a second, parallel table would duplicate `data_provenance_record`'s fields and contradict that stated one-reference relationship. Instead, "dataset versions" is realized as:

- `data_provenance_record` = the version-tagged batch record itself.
- `simulation_run_input_dataset` = the join recording exactly which dataset versions a given run consumed (FR-12: "record... the exact input dataset versions and code version used, sufficient to reproduce the run").

If the review board wants an explicitly separate, differently-shaped "dataset version" concept, that is a one-migration addition on top of this design — flagging it here rather than guessing at it.

### 4. `data_source` lookup table

Not a Section 16 entity. Added as a closed-set referential-integrity control so `data_provenance_record.source_code` cannot drift to an undocumented source. The set of rows it may ever contain is closed by Section 13 — TomTom and Cesium ion are deliberately excluded (see comments in migration `0003`), since neither is an ingested dataset.

### 5. `heat_exposure_factor_value` as a child table, not wide columns

Section 16 describes `HeatExposureResult` as carrying "computed index value, per-factor contributing values (Section 18)." Rather than five nullable columns (one per Section 18 candidate factor), factor values are normalized into their own table, one row per `(result, factor)`. This means adding, retiring, or renaming a candidate factor is a data change, not a schema migration, and it lets `is_computable` mark any factor — not just exposure/shading — as "not computable with available data" per Section 18's explicit instruction to mark rather than approximate.

### 6. Least-privilege roles (Section 33)

Migration `0014` creates three `NOLOGIN` group roles — `vektra_ingestion`, `vektra_simulation`, `vektra_backend_api` — each granted only the tables and operations its subsystem needs, per Section 33 ("the API layer should not have the same privileges as the ingestion/simulation jobs") and Section 9's stated dependency ordering. No passwords are set in these migrations; Section 33 requires secrets to live in environment variables or a secrets manager, never committed to the repository. Provisioning actual login users and granting them role membership is a deployment-time step outside version control.

---

## Tables

### `data_source`
Closed lookup of the 6 external data sources named in Section 13. Referenced by `data_provenance_record.source_code` for integrity. Immutable.

### `data_provenance_record`
The `DataProvenanceRecord` entity (Section 16, 24). One row per ingested batch/scene/tile/extract: source, product identifier, retrieval timestamp, license, ingestion pipeline version, checksum. Also fulfills the "dataset version" role (Section 27, see Design principle 3). Immutable. `UNIQUE (source_code, source_product_identifier, retrieval_timestamp)` prevents accidentally re-ingesting the same retrieval event as a duplicate row.

### `building`
The `Building` entity (Section 16), Static Geometric Layer (Section 15). One row per versioned OSM footprint snapshot (FR-1): OSM id/type, `building`/`height`/`building:levels`/`name` tags, dual-CRS geometry, generated footprint area, and a provenance reference. Immutable (geometry, per Sections 5/9/15, must never be altered post-ingestion by any process). `UNIQUE (osm_id, osm_type, provenance_id)` prevents duplicate ingestion of the same feature within one batch.

### `environmental_raster_asset`
The `EnvironmentalRasterAsset` entity (Section 16), Environmental Observation Layer (Section 15). Metadata only — raw raster pixels are not stored in PostGIS, per Section 16's own stated Engineering Decision that raster files live in a separate object/file store (technology "Not specified" — `storage_location` is an opaque reference string so this schema doesn't presume a technology). `spatial_extent` (bounding-box footprint) is an addition needed to implement the "spatial overlay" mechanism Section 18 describes for attributing raster-derived factors to buildings — without it, there'd be no way to determine which raster assets cover which footprints. Immutable.

### `meteorological_observation`
The `MeteorologicalObservation` entity (Section 16). One row per `(location, timestamp, variable)` reading from Open-Meteo. Modeled per-variable rather than as fixed columns because Section 13 gives only an open-ended example list ("temperature, humidity, wind, solar radiation, etc.") — a fixed-column design would require guessing the closed set the EDD doesn't provide. Immutable.

### `simulation_run`
The `SimulationRun` entity (Section 16, 17). One row per baseline or scenario execution of the simulation engine: code version, configuration version, run type, self-referencing `baseline_run_id` for scenario runs, and a mutable status lifecycle. Identity columns are frozen after creation; only lifecycle columns can change (Design principle 1).

### `simulation_run_input_dataset`
Join table: which `data_provenance_record` rows (dataset versions) a given run consumed. Realizes FR-12 and Section 17's "exact input version identifiers used." Many-to-many because a single run typically consumes multiple dataset versions at once (an OSM batch, an SRTM tile, a Sentinel-2 scene, etc.). Immutable.

### `scenario`
The `Scenario` entity (Section 16, 19). A named, versioned overlay referencing exactly one baseline `SimulationRun` and, once executed, exactly one derived `SimulationRun` (`derived_run_id`, nullable until then — the one permitted mutation). Never modifies the baseline data it references (Section 15, 19).

### `scenario_override`
Child of `scenario`, realizing the "ordered list of attribute overrides (each referencing a building identifier, an attribute name, and an override value)" from Section 16. `sequence_number` preserves ordering. `attribute_name`/`override_value` are free `TEXT` because the EDD never enumerates the closed set of overridable attributes it references (Section 22: "scoped to a defined set of overridable attributes" — that set itself is undefined; see TODOs). Immutable.

### `heat_exposure_result`
The `HeatExposureResult` entity (Section 16), Derived/Computed Layer (Section 15). One row per `(run, building)` pair. `index_value` is nullable because Section 18's composite-combination methodology is explicitly "Requires future implementation." Immutable. `UNIQUE (run_id, building_id)` matches Section 16's stated cardinality: "a Building has many HeatExposureResults (one per SimulationRun in which it participated)."

### `heat_exposure_factor_value`
Child of `heat_exposure_result` (Design principle 5). One row per `(result, factor)`, `factor_key` constrained to exactly the 5 candidate factors named in Section 18. `is_computable = FALSE` marks a factor as not computable with available data (Section 18's explicit instruction, generalized beyond just the exposure/shading factor it was stated for) rather than approximating it. Immutable.

---

## Relationships

- **`data_source` → `data_provenance_record`** (one-to-many): every provenance record cites exactly one of the 6 closed-set sources.
- **`data_provenance_record` → `building` / `environmental_raster_asset` / `meteorological_observation`** (one-to-many each): Section 16's stated relationship — "every Building, EnvironmentalRasterAsset, and MeteorologicalObservation references exactly one DataProvenanceRecord."
- **`data_provenance_record` ↔ `simulation_run` via `simulation_run_input_dataset`** (many-to-many): a run consumes many dataset versions; a dataset version may feed many runs.
- **`simulation_run` → `simulation_run`** (self-referencing, one-to-many): a scenario-type run's `baseline_run_id` points at the baseline run it was derived from (Section 11).
- **`simulation_run` → `heat_exposure_result`** (one-to-many): "a SimulationRun has many HeatExposureResults" (Section 16).
- **`building` → `heat_exposure_result`** (one-to-many): "a Building has many HeatExposureResults... one per SimulationRun in which it participated" (Section 16).
- **`heat_exposure_result` → `heat_exposure_factor_value`** (one-to-many): per-factor contributing values for one result.
- **`simulation_run` → `scenario`** (one-to-many via `baseline_run_id`, one-to-zero-or-one via `derived_run_id`): "a Scenario references exactly one baseline SimulationRun and produces exactly one derived SimulationRun" (Section 16).
- **`scenario` → `scenario_override`** (one-to-many): the ordered overrides belonging to one scenario.
- **`building` → `scenario_override`** (one-to-many): each override targets one building, never mutating it directly.

---

## Indexes — why each one exists

| Index | Table | Rationale |
|---|---|---|
| `idx_provenance_source_code` | `data_provenance_record` | Look up all batches from a given source (e.g. "every Landsat ingestion") — common ingestion/QA query. |
| `idx_provenance_retrieval_timestamp` | `data_provenance_record` | Chronological provenance queries and Section 26 ingestion-time reporting. |
| `idx_building_geom_wgs84_gist` | `building` | GiST spatial index — required for any bounding-box/overlap query against footprints (map viewport queries, FR-11 "query buildings... within the study area"). |
| `idx_building_geom_utm43n_gist` | `building` | GiST spatial index in the metric CRS — required for area/distance/neighborhood queries feeding the morphology/density and exposure/shading factors (Section 18). |
| `idx_building_osm_id` | `building` | Look up a building's full snapshot history by its real-world OSM identifier. |
| `idx_building_provenance_id` | `building` | Traceability lookups: "which buildings came from this ingestion batch" (Section 7, Traceability NFR). |
| `idx_raster_asset_extent_gist` | `environmental_raster_asset` | GiST spatial index — the "spatial overlay" mechanism Section 18 describes (which raster assets cover a given building) is a spatial join and needs this. |
| `idx_raster_asset_source_code` / `idx_raster_asset_acquisition_date` / `idx_raster_asset_provenance_id` | `environmental_raster_asset` | Filter by source and by acquisition window (Section 13's per-source date-range ingestion) and trace back to provenance. |
| `idx_met_observation_location_gist` | `meteorological_observation` | Spatial nearest-neighbor lookups when disaggregating coarse meteorological fields to buildings (Section 18, factor 5). |
| `idx_met_observation_timestamp` / `idx_met_observation_variable_name` / `idx_met_observation_provenance_id` | `meteorological_observation` | Filter a time series by variable and period, and trace to provenance. |
| `idx_simulation_run_status` | `simulation_run` | "Query the status of a simulation run" (Section 21) — direct support for that capability. |
| `idx_simulation_run_type` | `simulation_run` | Separate baseline vs. scenario runs (Section 11's two distinct pipelines). |
| `idx_simulation_run_baseline_run_id` | `simulation_run` | Walk from a baseline run to every scenario run derived from it. |
| `idx_simulation_run_code_version` | `simulation_run` | Reproducibility/audit queries: "which runs used code version X" (Section 7, 27). |
| `idx_run_input_dataset_provenance_id` | `simulation_run_input_dataset` | Reverse lookup: "which runs used this dataset version" — impact analysis when a source dataset is found to be flawed. |
| `idx_scenario_baseline_run_id` / `idx_scenario_derived_run_id` | `scenario` | Both directions of the scenario↔run relationship are queried independently by the comparison view (Section 22, FR-9). |
| `idx_scenario_override_scenario_id` / `idx_scenario_override_building_id` | `scenario_override` | Resolve all overrides for one scenario at simulation time (Section 15), and find all scenarios that touch a given building (scenario editor, Section 22). |
| `idx_result_run_id` / `idx_result_building_id` | `heat_exposure_result` | The two primary access patterns: "all results for this run" (map rendering, Section 20) and "all results for this building across runs" (inspection panel history, Section 22). |
| `idx_factor_value_result_id` / `idx_factor_value_factor_key` | `heat_exposure_factor_value` | Fetch a result's full factor breakdown (inspection panel, Section 22), and filter/aggregate by a single factor across results (factor-level legend toggling, Section 22). |

---

## Open items (from the EDD, not invented here)

- **Study-area bounding box** (Section 4) — not defined. No table depends on a fixed extent, but every future ingestion run does.
- **PostgreSQL/PostGIS version** (Section 12) — assumed ≥ 13 / ≥ 3.x; not confirmed.
- **Raster/object storage technology** (Section 16) — `environmental_raster_asset.storage_location` is intentionally storage-technology-agnostic (opaque `TEXT`) until this is decided.
- **Open-Meteo variable set and units** (Section 13) — `meteorological_observation` is modeled to accept any variable/unit; the actual set ingested is undecided.
- **Closed set of overridable scenario attributes** (Section 22) — `scenario_override.attribute_name`/`override_value` are unconstrained `TEXT` pending this.
- **Heat Exposure Index combination method/weights** (Section 18) — `heat_exposure_result.index_value` will be `NULL` until this exists; per-factor values can be populated independently.
- **Whether the backend directly triggers a run by inserting into `simulation_run`, or via a job queue** (Section 21/23) — no `INSERT` grant on `simulation_run` was given to `vektra_backend_api` pending this decision (migration `0014`).
- **Authentication/authorization model** (Section 23) — `scenario.created_by` is a free-text placeholder; no users/roles-of-humans table exists, since none is specified.

None of the above have been resolved with invented values — each is either left `NULL`-able, left as unconstrained `TEXT`, or flagged with a `TODO` comment in the relevant migration file.
