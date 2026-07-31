# VEKTRA — Engineering Design Document

**Working Title:** Building-Level Urban Heat Resilience Digital Twin for South Mumbai
**Document Type:** Engineering Design Document (EDD)
**Document Status:** Draft — for engineering review
**Version:** 0.1
**Date:** 2026-07-31
**Prepared as:** Principal Systems Engineer / GIS Software Architect review artifact

**Notation used throughout this document:**
- **Fact** — externally verifiable, sourced information about a real dataset, standard, or technology.
- **Engineering Decision** — a design choice made in this document, with rationale, that a review board may accept, reject, or amend.
- **Assumption** — a statement not yet verified against ground truth for the South Mumbai study area. Must be validated before implementation proceeds.
- **Not specified.** — information required for a complete design that is not available at time of writing and must not be invented.
- **Requires future implementation.** — a capability intentionally deferred beyond initial scope.

---

## 1. Project Vision

VEKTRA is a deterministic, modular, browser-based platform that represents buildings in a defined South Mumbai study area as geospatial entities, augments them with environmental observations drawn from open datasets, and computes a reproducible, versioned Building Heat Exposure Index per building. The platform additionally supports scenario evaluation, in which hypothetical attribute-level interventions (not geometry changes) can be applied and re-simulated for comparison against a baseline.

VEKTRA is an engineering platform, not a predictive AI system. Its outputs are only as credible as its input data and its documented methodology, and both must be traceable end to end.

## 2. Problem Definition

Urban heat exposure varies at sub-city and even sub-block scale due to differences in building density, vegetation cover, surface materials, and morphology. Coarse, city-level heat metrics (e.g., a single air temperature reading for Mumbai) do not resolve this variation and are insufficient for building-level adaptation planning (e.g., prioritizing retrofits, cool-roof programs, or green infrastructure).

**Assumption:** No existing open, building-level heat exposure dataset for South Mumbai is known to the authors of this document. This has not been exhaustively verified through a data-source survey; the ingestion pipeline (Section 14) must include an explicit step to search for and rule out existing authoritative products before VEKTRA computes its own index, to avoid duplicating an existing effort.

## 3. Objectives

1. Represent buildings in a defined South Mumbai bounding box as discrete, attributed geospatial entities sourced from OpenStreetMap.
2. Ingest open environmental datasets (elevation, optical/thermal imagery, land cover, meteorological data) covering the same bounding box and time window.
3. Compute a composite, per-building Heat Exposure Index using a documented, versioned, reproducible methodology.
4. Provide 3D visualization of buildings styled by index value.
5. Support definition and comparison of adaptation scenarios without mutating baseline geometry or baseline data.
6. Maintain full data provenance and computational reproducibility for every displayed value.

## 4. System Scope

- A fixed, explicitly defined bounding box within South Mumbai. **Not specified.** — the exact bounding box (ward boundaries or coordinate extent) has not been provided and must be defined by the project owner before ingestion begins; it directly determines Overpass query extent, tile selection for satellite products, and cost/time of ingestion.
- Building footprints and available attributes from OpenStreetMap.
- Elevation context from SRTM.
- Optical and thermal remote sensing context from Sentinel-2 and Landsat Collection 2.
- Land cover context from ESA WorldCover.
- Meteorological context from Open-Meteo.
- A deterministic simulation engine producing a versioned Heat Exposure Index.
- A scenario engine limited to attribute-level overlays.
- A 3D web visualization client.
- A backend API mediating all data access between storage and clients.

## 5. Out of Scope

- Real-time or streaming sensor ingestion. **Not specified** whether any such sensor network exists for South Mumbai; none is assumed.
- Municipal cadastral, permit, or building-material datasets. **Never assume municipal data exists** — per project constraint, none is assumed available, and none is fabricated.
- Physically validated thermodynamic building energy simulation (e.g., full building energy modeling). The Heat Exposure Index (Section 18) is a composite proxy indicator, not a certified physical simulation.
- Nationwide or all-of-Mumbai coverage in the initial release.
- Mobile native applications.
- Automated building geometry generation or modification by any AI or ML component, at any stage, under any circumstance.
- Citizen-facing public deployment; initial scope is an internal/engineering-reviewable platform.

## 6. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | System shall ingest building footprint polygons and available tags (height, building:levels, building, name, etc.) for the defined bounding box via the Overpass API. |
| FR-2 | System shall ingest an SRTM elevation tile (or tiles) covering the bounding box. |
| FR-3 | System shall ingest Sentinel-2 Level-2A optical scenes and Landsat Collection 2 Level-2 surface temperature scenes covering the bounding box for a defined, documented date range. |
| FR-4 | System shall ingest ESA WorldCover land cover classification tiles covering the bounding box. |
| FR-5 | System shall ingest meteorological variables from Open-Meteo for the bounding box (or representative point(s) within it) for a defined date range. |
| FR-6 | System shall persist all ingested data with source, retrieval timestamp, and version metadata (Section 24). |
| FR-7 | System shall compute a Heat Exposure Index value per building per simulation run, using the documented conceptual methodology (Section 18), on demand or on a defined schedule. |
| FR-8 | System shall allow definition of a scenario as a set of attribute overrides applied to a baseline snapshot, without modifying baseline geometry or baseline records. |
| FR-9 | System shall re-run the simulation for a scenario and expose both baseline and scenario results for comparison. |
| FR-10 | System shall render buildings in 3D, styled by Heat Exposure Index value, in a web client. |
| FR-11 | System shall expose an API through which all persisted and derived data is retrievable; the frontend shall not access the database directly. |
| FR-12 | System shall record, for every simulation run, the exact input dataset versions and code version used, sufficient to reproduce the run. |
| FR-13 | System shall support export of computed results (at minimum: tabular format such as CSV, and vector format such as GeoJSON). |

## 7. Non-functional Requirements

- **Determinism:** Given identical input dataset versions and identical code version, the simulation engine shall produce bit-identical (or, where floating-point non-associativity makes bit-identity impractical, numerically identical within a defined tolerance) output. This is an explicit design constraint per project principles, not an assumption.
- **Modularity:** Ingestion, storage, simulation, scenario management, API, and visualization shall be independently deployable and independently testable components communicating through defined interfaces.
- **Traceability:** Every value exposed to a user shall be traceable to a source dataset version and a simulation run identifier.
- **Maintainability:** Components shall be strongly typed (TypeScript for Node.js services and clients; Python type hints for ingestion/simulation) and version-controlled.
- **Performance (proposed, unvalidated):** **Assumption** — interactive frontend rendering should target a smooth frame rate for the defined study-area extent at building level of detail. No load test has been performed; this is a target for the review board to accept, revise, or reject, not a measured or guaranteed figure.
- **Availability:** **Not specified.** No SLA has been defined by the project owner. Default engineering assumption: this is an internally used analysis and portfolio platform, not a production public service; no high-availability architecture is assumed necessary at this stage.
- **Security baseline:** see Section 33.

## 8. System Context

**External human actors:**
- GIS/data engineer — configures ingestion, validates data in QGIS, reviews simulation runs.
- Platform administrator — manages deployment, credentials, and access.
- End user (researcher / planner) — views the 3D twin, inspects index values, defines and compares scenarios.

**External systems (all Fact, existing, third-party):**
- OpenStreetMap / Overpass API — building footprints and tags.
- USGS EarthExplorer — SRTM DEM tiles, Landsat Collection 2 Level-2 products.
- Copernicus Data Space Ecosystem — Sentinel-2 Level-2A scenes; also indexes Copernicus DEM and ESA WorldCover.
- ESA WorldCover distribution (esa-worldcover.org / Copernicus Data Space / registry mirrors) — land cover classification tiles.
- Open-Meteo — historical (ERA5-based archive) and forecast meteorological variables, no API key required for non-commercial use.
- TomTom Developer APIs — optional, for basemap/routing/traffic context (Section 13).
- Cesium ion — hosting and streaming of 3D Tiles content, including the Cesium OSM Buildings global tileset.

VEKTRA itself is the system boundary; it does not expose control back to any of these external systems beyond read-only data retrieval and (for Cesium ion) asset hosting/streaming.

## 9. High-Level Architecture

**Engineering Decision:** A layered architecture with strict separation between computation and rendering, consistent with the stated digital twin principles.

```
 [External Data Sources]
   OSM/Overpass | SRTM (USGS) | Sentinel-2 (CDSE) | Landsat C2 (USGS) | ESA WorldCover | Open-Meteo | TomTom (optional)
            |
            v
 [Data Ingestion Layer]  (Python ETL jobs, one per source, independently schedulable)
            |
            v
 [Canonical Storage Layer]
   PostgreSQL + PostGIS (vector + attribute + metadata)
   Object/file storage for large raster assets (Section 16)
            |
            v
 [Simulation Engine]  (Python, deterministic, versioned, containerized)
            |
            v
 [Derived Results Store]  (versioned Heat Exposure Index results, scenario results)
            |
            v
 [Backend API Layer]  (Node.js + TypeScript)
            |
            v
 [Frontend Application]  (TypeScript + CesiumJS, Cesium ion for terrain/imagery/building tile streaming)
```

Rendering (frontend) depends only on the API layer. The simulation engine depends only on canonical storage, never on the API or frontend. The API layer depends on canonical and derived storage, never directly on external data sources. This ordering enforces the required independence between rendering, computation, and ingestion.

## 10. Subsystem Breakdown

1. **Ingestion Subsystem** — one connector per external source; responsible for extraction, schema validation, CRS normalization, and provenance tagging.
2. **Validation/QA Subsystem** — geometry validity checks, CRS checks, duplicate detection; supports manual review in QGIS as an engineering workflow, not a runtime dependency.
3. **Canonical Storage Subsystem** — PostGIS vector store plus raster/object storage.
4. **Simulation Subsystem** — deterministic batch computation of the Heat Exposure Index.
5. **Scenario Subsystem** — manages attribute-override overlays and triggers re-computation.
6. **Provenance/Metadata Subsystem** — cross-cutting; every other subsystem writes to it.
7. **API Subsystem** — mediates all external read/write access to the platform's data.
8. **Visualization Subsystem** — CesiumJS-based 3D client.
9. **Logging/Monitoring Subsystem** — cross-cutting operational observability.

## 11. Data Flow

**Baseline pipeline:**
Extraction (per source) → Validation → Canonical storage (versioned batch) → Simulation engine reads a defined canonical snapshot + a versioned configuration → writes a versioned Heat Exposure Index result set tagged with a run identifier → API layer serves canonical and derived data → Frontend requests via API → CesiumJS renders buildings styled by index value.

**Scenario pipeline:**
User defines scenario (attribute overrides referencing a baseline snapshot) via frontend → Scenario stored as an overlay record, distinct from and non-destructive to baseline data → Scenario submitted to simulation engine → Simulation engine applies overlay on top of the referenced baseline snapshot → New run produced with its own run identifier, referencing the baseline run identifier it was derived from → API returns both runs → Frontend renders a comparison view.

No path in either flow allows the frontend, API layer, or scenario subsystem to write to building geometry.

## 12. Technology Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| Ingestion / Simulation | Python | Fact — already installed, per project constraints. |
| Backend API | Node.js + TypeScript | Fact — already installed. Specific framework (e.g., Express, Fastify, NestJS): **Not specified**; this is an implementation-level choice deferred to the engineering team, all three are real, production-stable options. |
| Frontend | TypeScript + CesiumJS | CesiumJS is a real, open-source (Apache 2.0) JavaScript library for 3D geospatial visualization. |
| 3D asset hosting/streaming | Cesium ion | Fact — commercial platform; includes curated global assets such as Cesium World Terrain and Cesium OSM Buildings, and supports uploading custom tiled content. |
| Database | PostgreSQL + PostGIS | Fact — already installed. |
| Raster/large asset storage | **Not specified.** | See Section 16; requires an explicit decision (filesystem, cloud object storage, or PostGIS raster extension) before implementation. |
| Dev/DB tooling | DBeaver, QGIS | Fact — already installed; used by engineers for inspection, QA, and manual validation, not part of the production runtime. |
| Containerization | Docker | Fact — already installed. |
| Version control | Git + GitHub | Fact — already installed. |
| CI/CD | GitHub Actions | Fact — natively integrated with GitHub; a reasonable default recommendation, not mandated by the source constraints. |

## 13. Data Sources

| Source | What it provides | Resolution / cadence | Access | Known limitation for this project |
|---|---|---|---|---|
| OpenStreetMap (via Overpass API) | Building footprint polygons; tags such as `building`, `height`, `building:levels`, `name` where mapped | Community-maintained, irregular update cadence | Free, open (ODbL license) | **Assumption, unverified:** completeness of `height`/`building:levels` tagging for South Mumbai is unknown and likely partial. Must be measured via an Overpass query against the actual bounding box before the Heat Exposure Index design (Section 18) can finalize which morphology factors are computable. |
| SRTM DEM | Global digital elevation model | 30 m (SRTM 1 arc-second) or 90 m (3 arc-second), single epoch (~2000) | Free, via USGS EarthExplorer | Elevation data is over two decades old; does not reflect any construction since acquisition. South Mumbai is largely low-relief/coastal, so DEM contributes limited topographic variation but is still required for consistent terrain-clamped 3D rendering. |
| Sentinel-2 (Level-2A) | Multispectral optical surface reflectance | 10 m (visible/NIR bands), 5-day revisit with two satellites | Free, via Copernicus Data Space Ecosystem | No thermal band; used for optical/vegetation context, not for surface temperature. Cloud cover during monsoon months is a known constraint on South Asian coastal cities and will affect scene availability for parts of the year. |
| Landsat Collection 2 Level-2 | Surface Temperature (ST) science product, derived from TIRS thermal bands | Delivered at 30 m spatial sampling (native TIRS resolution ~100 m, resampled); 16-day revisit per satellite | Free, via USGS EarthExplorer | Primary intended source for the thermal signature factor of the Heat Exposure Index. 16-day revisit and cloud sensitivity limit temporal density; a single representative acquisition date (or small composite) will need to be selected and documented, not silently assumed. |
| ESA WorldCover | Global land cover classification, 11 classes | 10 m resolution; two static epochs only — 2020 (v100) and 2021 (v200), produced with different algorithm versions | Free, no restriction on use (attribution required) | Only two fixed years exist; there is no continuously updated WorldCover product. Any land cover state used by VEKTRA will reflect 2020 or 2021 conditions, not current conditions, and this must be stated wherever land cover is used in the index or displayed to a user. |
| Open-Meteo | Historical (ERA5 reanalysis, from 1940) and forecast meteorological variables (temperature, humidity, wind, solar radiation, etc.) | Reanalysis grid resolution on the order of 9–25 km depending on variable/model; forecast models up to ~1 km in some regions | Free for non-commercial use (CC BY 4.0 attribution), no API key, documented rate limit for non-commercial tier | Native resolution is far coarser than a single building footprint. Any building-level meteorological value is necessarily a spatial disaggregation of a coarser field, not a direct building-level measurement, and must be labeled as such. |
| TomTom (Traffic/Routing APIs) | Real-time and historical traffic flow/incidents; routing | Real-time to historical, road-network based | Commercial, transaction-based licensing | Not a heat/environmental data source. Relevant only as an optional future proxy for anthropogenic activity/heat near road corridors, or for basemap/routing context in the frontend. Any use as a heat-index input is speculative and is deferred to Section 38 (Future Extensions), not included in the baseline methodology. |

Per project constraint, no dataset beyond the sources explicitly listed as available is introduced in this design.

## 14. Data Ingestion Pipeline

Conceptual pipeline, per source, executed as an independently schedulable job:

1. **Extraction** — Overpass query scoped to the defined bounding box (FR-1); tile/scene selection and download for SRTM, Sentinel-2, Landsat Collection 2, and ESA WorldCover scoped to the same bounding box and a documented date range; Open-Meteo API calls scoped to the bounding box or representative point(s).
2. **Schema and integrity validation** — geometry validity checks (e.g., no self-intersections, correct ring orientation), coordinate reference system verification, null/missing-attribute detection, checksum verification for downloaded files.
3. **Transformation** — reprojection to a defined storage CRS. **Engineering Decision:** store vector data in WGS84 (EPSG:4326) for interchange and in a projected CRS suitable for metric analysis; for South Mumbai (~72.8° E, ~18.9° N) the applicable UTM zone is 43N (EPSG:32643). This placement is a coordinate-geometry fact (UTM zone boundaries are fixed at 6° longitude intervals), not an assumption.
4. **Loading** — insertion into PostGIS (vector/attribute data) or object/file storage (raster) under a versioned batch identifier.
5. **Provenance tagging** — every loaded record or file is tagged per Section 24 before it is considered available to the simulation engine.

Manual QA in QGIS is expected as an engineering step after each ingestion batch, particularly for verifying building footprint completeness and attribute coverage against the live OSM state for the study area — this is a human-in-the-loop verification step, not an automated pipeline stage.

## 15. Digital Twin State Model

The state model is organized into layers with different mutability and versioning semantics:

- **Static geometric layer** — building footprints and their identifiers. Immutable once ingested for a given OSM snapshot; geometry is never altered by simulation, scenario, or any AI/automated process, per project principle.
- **Environmental observation layer** — raster and point-based environmental data (elevation, imagery, land cover, meteorology), each tagged with acquisition date and source version. Immutable once ingested; a new acquisition is a new record, not an edit of an old one.
- **Derived/computed layer** — Heat Exposure Index results and scenario results, each tagged with a run identifier referencing the exact input versions used to produce it. Append-only; a re-run produces a new record, it does not overwrite a prior run.
- **Scenario/overlay layer** — attribute-level overrides referencing the static and environmental layers by identifier. Overlays never modify the layers they reference; they are resolved at simulation time.
- **Temporal layer** — see Section 26.

This layering is what allows "the geometry must always remain deterministic" and "every output must be reproducible" (project constraints) to be satisfied structurally rather than by convention alone.

## 16. Database Conceptual Model

Described at the entity level; no schema/DDL is specified here per output constraints.

**Entities (conceptual):**
- **Building** — identifier (OSM id or internal UUID), geometry, available tags (height, building:levels, building type, name), source snapshot/version reference.
- **EnvironmentalRasterAsset** — identifier, source (SRTM / Sentinel-2 / Landsat C2 / ESA WorldCover), acquisition date, storage location reference, CRS, resolution, provenance reference. **Engineering Decision, open:** raw raster pixel data is not proposed to live inside PostGIS as a first design choice; PostGIS metadata rows reference files held in a separate object/file store (Section 21/29). Whether to instead use the PostGIS raster extension is **Not specified** and should be decided based on team familiarity and expected data volume, which are not known at this stage.
- **MeteorologicalObservation** — source point/grid reference, timestamp, variable values, provenance reference.
- **SimulationRun** — run identifier, code version (Git commit hash), configuration version, referenced input dataset version identifiers, timestamp, status.
- **HeatExposureResult** — result identifier, building reference, run reference, computed index value, per-factor contributing values (Section 18), computation timestamp.
- **Scenario** — scenario identifier, referenced baseline run, description, ordered list of attribute overrides (each referencing a building identifier, an attribute name, and an override value), creation metadata.
- **DataProvenanceRecord** — source name, retrieval timestamp, source version/product identifier (e.g., Landsat scene ID, Sentinel-2 tile ID, OSM changeset or extract timestamp), license, checksum.

**Key relationships:** a Building has many HeatExposureResults (one per SimulationRun in which it participated); a SimulationRun has many HeatExposureResults; a Scenario references exactly one baseline SimulationRun and produces exactly one derived SimulationRun; every Building, EnvironmentalRasterAsset, and MeteorologicalObservation references exactly one DataProvenanceRecord.

## 17. Simulation Engine Overview

**Engineering Decision:** the simulation engine is a Python batch process, packaged as a versioned container image, that:
1. Reads a defined, immutable canonical data snapshot (and, for scenario runs, an overlay) by explicit version/identifier — never "latest" implicitly.
2. Computes the Heat Exposure Index per building per the conceptual methodology in Section 18.
3. Writes results tagged with a run identifier, the code version, and the exact input version identifiers used.
4. Is re-runnable: given the same snapshot identifiers, overlay (if any), and code version, it must produce numerically identical output. This is the operational definition of "deterministic" and "reproducible" used throughout this document.

The simulation engine has no dependency on the API layer, the frontend, or any interactive input at run time; it is invoked (manually, on a schedule, or by the Scenario Subsystem) and produces a complete, versioned result set.

## 18. Building Heat Exposure Index — Concept

No equation is specified in this document, per project constraint; only the conceptual structure of the methodology is described. Defining actual weights, normalization functions, and combination logic is explicitly **Requires future implementation** and should be treated as a distinct design/calibration exercise, ideally reviewed against literature on urban heat island indicators before any coefficients are fixed.

**Candidate conceptual factors**, each derived from a source already listed in Section 13:

1. **Thermal signature factor** — derived from Landsat Collection 2 Level-2 Surface Temperature for a documented acquisition date (or small composite), attributed to each building footprint by spatial overlay.
2. **Vegetation/land cover context factor** — derived from ESA WorldCover class(es) present at and immediately around each building footprint (e.g., built-up vs. tree cover vs. bare/impervious), and optionally a standard, well-established remote-sensing vegetation index computed from Sentinel-2 bands. Any such index would be a named, pre-existing scientific technique referenced by name in a future implementation document, not an equation invented for VEKTRA.
3. **Building morphology/density factor** — derived from footprint area, building density in the local neighborhood, and — **conditional on the OSM attribute-completeness verification in Section 13** — building height/levels where available.
4. **Exposure/shading factor** — conceptually dependent on building height and surrounding building heights combined with the DEM, relevant to solar exposure and shading between buildings. **Not specified** whether sufficient height data exists in OSM for the study area to compute this factor meaningfully; if not, this factor must be explicitly marked as "not computable with available data" rather than approximated with invented values.
5. **Local meteorological context factor** — derived from Open-Meteo variables (e.g., air temperature, humidity) for the representative date/period, applied uniformly or spatially interpolated across the study area, with the coarse native resolution of the source data (Section 13) explicitly disclosed.

**Combination:** a composite index is expected to be formed from a documented, versioned combination of the above factors (e.g., a normalized weighted composite). The specific normalization method and weights are **Requires future implementation** and must be defined, justified, and version-controlled before the index is presented as anything other than a set of independent, per-factor values.

**Validation:** **Not specified.** No known ground-truth, building-level heat exposure measurement dataset for South Mumbai exists to the authors' knowledge. Absent such a dataset, the index should be presented and labeled as a relative, comparative indicator (useful for ranking buildings within the study area against one another under a fixed methodology) rather than a validated absolute physical measurement.

## 19. Scenario Engine

A scenario is a named, versioned set of attribute-level overrides applied on top of a specific baseline simulation run — for example, a change to a building's assumed roof reflectivity attribute or an added vegetation-context override for a specific footprint. Per project principle, a scenario **never modifies building geometry**; only attributes referenced by the Heat Exposure Index methodology (Section 18) may be overridden, and only within a scenario's own overlay record (Section 15/16).

Executing a scenario produces a new SimulationRun that references its baseline run, allowing side-by-side comparison of baseline versus scenario Heat Exposure Index values per building. Scenarios are retained indefinitely (append-only) so past comparisons remain reproducible.

## 20. Visualization Layer

**Engineering Decision:** CesiumJS (open-source) as the rendering engine, with Cesium ion providing terrain and, where applicable, streamed 3D building content.

Two building-rendering strategies are available and should be evaluated against each other before implementation:
- **Extrusion of ingested OSM footprints** using available `height`/`building:levels` tags (falling back to a documented default extrusion height where tags are absent), giving direct control over per-building styling by Heat Exposure Index value and full consistency with VEKTRA's own canonical data.
- **Cesium OSM Buildings** — a Fact: an existing, global, OSM-derived 3D buildings tileset distributed via Cesium ion (3D Tiles format, reported to cover over 350 million buildings globally, updated on a regular cadence). This could provide pre-tiled global 3D geometry, but coupling VEKTRA's per-building attribute join to this externally-tiled dataset (rather than to VEKTRA's own ingested footprints) is an integration detail that is **Not specified** and requires a feasibility check (matching VEKTRA building identifiers to Cesium OSM Buildings feature IDs) before being adopted.

Styling (color ramp by Heat Exposure Index, scenario-vs-baseline toggling, legend) is a frontend-only concern operating on API-served data; it has no access to raw source datasets or to the simulation engine directly, consistent with Section 9.

## 21. Backend Services

The API layer is described at the capability level (no endpoint code):
- Query buildings and their attributes within the study area.
- Query environmental observations associated with a building or area.
- Query Heat Exposure Index results for a given simulation run (default: latest baseline run).
- Trigger and query the status of a simulation run (subject to authorization; see Section 33).
- Create, retrieve, and list scenarios; trigger scenario runs; retrieve scenario-vs-baseline comparison results.
- Query provenance metadata for any served record.
- Export services (CSV, GeoJSON) for the above.

**Engineering Decision:** a REST-style API is recommended over GraphQL for the initial release, on the basis that the query shapes above are a small, well-defined set of resource-oriented operations rather than an open-ended, client-driven graph query need; GraphQL remains a reasonable future option if client query needs become more heterogeneous.

## 22. Frontend Services

- 3D map/viewport component (CesiumJS).
- Building attribute/inspection panel (selected building's raw attributes, environmental context, and Heat Exposure Index breakdown).
- Legend and styling control (index value color ramp, factor-level toggling where computable per Section 18).
- Scenario editor (attribute override entry, scoped to a defined set of overridable attributes).
- Baseline-vs-scenario comparison view.
- Provenance inspector (surfacing source, version, and retrieval timestamp for any displayed value, per Section 24).
- Temporal control, **conditional on** the temporal model (Section 26) supporting more than a single baseline snapshot; not guaranteed in the initial release.

## 23. API Layer

Transport: HTTPS. Format: JSON for data payloads; GeoJSON for geometry-bearing responses (a standard, RFC 7946 format, appropriate for CesiumJS/GIS tooling interoperability).

Authentication/authorization approach: **Not specified.** No requirements have been provided regarding who may trigger simulation runs, create scenarios, or access the platform at all. Default engineering assumption for an internal/portfolio-stage system: a single shared credential or simple session-based auth is sufficient initially, with role separation (read-only viewer vs. engineer who can trigger runs) deferred until an actual multi-user deployment requirement exists. This must be revisited before any deployment beyond a controlled internal environment.

## 24. Data Provenance Strategy

Every ingested or derived record carries, at minimum:
- Source name (e.g., "USGS Landsat Collection 2 Level-2").
- Source product/scene/tile identifier (e.g., Landsat scene ID, Sentinel-2 tile ID, ESA WorldCover tile+version, OSM extract timestamp/changeset).
- Retrieval timestamp (when VEKTRA fetched it, distinct from the data's own acquisition date).
- License/attribution requirement (all currently listed sources are free/open, several with attribution requirements — e.g., ESA WorldCover and Open-Meteo both require attribution under their respective terms — that must be honored in any published output).
- Ingestion pipeline version that processed it.
- A checksum of the retrieved artifact, where feasible, to detect silent corruption or unexpected upstream changes.

Derived records (simulation results) additionally carry the full set of input version identifiers and the code version, per Section 17.

## 25. Metadata Standards

**Engineering Decision (recommendation, not yet adopted):** align with existing, real, stable standards rather than inventing a bespoke metadata schema:
- **ISO 19115** — a Fact, an existing international standard for geographic metadata, applicable to describing VEKTRA's own derived datasets if they are ever published externally.
- **OGC API - Features** — a Fact, an existing OGC standard for serving vector geographic features over the web; a candidate future alignment target for the API layer's geometry-serving endpoints if broader interoperability is desired.
- **CityGML** — a Fact, an existing OGC standard for semantic 3D city models; relevant only as a **Future Extension** (Section 38) if VEKTRA's building representation needs to carry richer semantic structure than flat attributes; not adopted in the initial design given added complexity.

Adoption of any of the above beyond internal awareness is **Requires future implementation** and should be justified against an actual interoperability requirement, which has not been specified.

## 26. Temporal Model

Three distinct time concepts must be kept separate and are not interchangeable:
- **Observation time** — when the underlying phenomenon was recorded (e.g., a Landsat scene's acquisition date, an Open-Meteo reading's timestamp).
- **Ingestion time** — when VEKTRA retrieved and stored that observation.
- **Computation time** — when a SimulationRun that consumed the observation was executed.

**Engineering Decision:** the initial release operates on periodic, batch ingestion cycles rather than continuous/real-time synchronization, because none of the listed data sources are streaming feeds requiring continuous ingestion (Open-Meteo forecast data updates frequently but is still pull-based, not push-based). True real-time "live" digital twin state is out of scope (Section 5) and this should be stated plainly to stakeholders to avoid the "live twin" expectation implied by some marketing usage of the term "digital twin," which this document explicitly avoids (per project constraints).

Support for multiple historical baseline snapshots (as opposed to a single current baseline) is **Requires future implementation.**

## 27. Versioning Strategy

- **Dataset version** — every ingested batch is tagged with a version identifier (e.g., an ingestion run timestamp plus source product identifiers).
- **Code version** — Git commit hash (or tag, for released versions) for the ingestion, simulation, backend, and frontend codebases; recommended: independent semantic versioning (MAJOR.MINOR.PATCH) per subsystem, consistent with the modularity requirement (Section 7).
- **Simulation run version** — the tuple of (code version, configuration version, input dataset version identifiers) that fully determines a SimulationRun's output, per Section 17.
- **Scenario version** — a scenario's overlay content is itself versioned in the same append-only manner as simulation runs (Section 19).

## 28. Performance Requirements

**Assumption — proposed targets pending stakeholder validation, not measured:**
- API response time for a single-building query: sub-second, typical of a well-indexed PostGIS lookup at this data scale.
- Frontend initial load of the study-area 3D scene: a few seconds, dependent on 3D Tiles streaming behavior and network conditions, which have not been characterized.
- Batch ingestion and simulation run duration: expected to scale with bounding-box area and number of buildings; no specific throughput figure is given because the bounding box itself is **Not specified** (Section 4).

These figures must be replaced with measured values from load testing (Section 32) before being treated as commitments.

## 29. Scalability Strategy

At the defined scope (a single South Mumbai bounding box, building-level granularity, likely on the order of thousands to tens of thousands of buildings depending on the final bounding box), a single-node PostgreSQL/PostGIS instance and containerized services are expected to be sufficient; this is an engineering judgment based on typical PostGIS performance at this data scale, not a benchmarked figure for this specific dataset.

**Future Extension (Requires future implementation):** extending coverage to all of Mumbai or to additional cities would require: partitioning or read-replica strategies for PostGIS, a proper tiling strategy for 3D content (Cesium ion already provides this for its own hosted assets), and migration of raster/object storage to a horizontally scalable cloud object store. None of this is required at the defined initial scope.

## 30. Logging

**Engineering Decision:** structured (e.g., JSON) logging per subsystem, distinguishing:
- Ingestion logs — per source, per batch: start/end time, record counts, validation failures, checksum results.
- Simulation logs — per run: input version identifiers, code version, duration, any per-building computation failures (e.g., a building with insufficient data to compute a given factor, per Section 18).
- API/backend logs — request-level logs sufficient for debugging, excluding any sensitive credentials.
- Audit logs — who (or what automated trigger) initiated a simulation run or created a scenario, kept separate from error/debug logs.

## 31. Monitoring

**Engineering Decision (recommendation):** basic health checks per containerized service, and a simple operational view of ingestion/simulation run status (success/failure, last-run timestamp per source). Open-source, Docker-compatible tools such as Prometheus and Grafana are a reasonable, real, production-stable option for this if the team wants dashboarding beyond log inspection; adoption is a team decision, not a hard requirement of this design.

Alerting policy (who is notified on ingestion or simulation failure, and through what channel) is **Not specified** and depends on organizational context not provided.

## 32. Testing Strategy

- **Unit tests** — ingestion parsers/transformations (e.g., CRS reprojection correctness, tag-parsing logic), simulation factor computations in isolation.
- **Integration tests** — end-to-end pipeline runs against a small, fixed test bounding box (not the full study area), covering extraction through to a computed HeatExposureResult.
- **Determinism/regression tests** — running the same simulation input twice and asserting identical (or tolerance-bound identical) output; this directly tests the core reproducibility requirement (Section 7) rather than assuming it holds.
- **Data validation tests** — geometry validity, CRS correctness, and provenance-field completeness, run as part of ingestion, not only as a pre-deployment test suite.
- **Frontend tests** — component-level tests for the inspection panel, legend, and scenario editor; visual/smoke testing of the 3D view is a candidate future addition (**Requires future implementation**) given the added tooling complexity of automated 3D visual regression testing.

## 33. Security Considerations

- **Third-party credential handling:** API keys/tokens for TomTom and Cesium ion must never be embedded in frontend-shipped code; the backend should proxy any calls that require a secret credential, or the frontend should use a public/scoped token where the provider explicitly supports one (this distinction must be verified per-provider before implementation, and is not assumed here).
- **Secrets management:** environment variables or a secrets manager, never hardcoded values in the repository.
- **Input validation:** all API inputs (e.g., scenario override values, bounding-box parameters if ever exposed) validated server-side.
- **Database access:** least-privilege database roles per service (e.g., the API layer should not have the same privileges as the ingestion/simulation jobs).
- **CORS policy:** restricted to known frontend origins.
- **Dependency management:** routine vulnerability scanning of Node.js and Python dependencies given the use of multiple third-party libraries and SDKs.

Threat modeling beyond this baseline is **Not specified** and depends on deployment context (internal-only vs. any external exposure) not yet defined.

## 34. Deployment Strategy

**Engineering Decision:** Docker Compose for local/development environment orchestration, given Docker is already available and the initial scope is a single-node deployment (Section 29). Suggested service containers: PostgreSQL/PostGIS, ingestion/simulation (Python), backend API (Node.js/TypeScript), frontend (static build served by a lightweight web server, or a Node.js server if server-side rendering is desired — **Not specified**, a later implementation choice).

CI: GitHub Actions (native to the already-adopted GitHub) for build, lint, and test execution on push/PR.

Production deployment target (cloud provider, on-premises, orchestration platform such as Kubernetes) is **Not specified** and requires an organizational decision not available at this stage; container orchestration beyond Docker Compose is a **Future Extension**, not part of the initial design.

## 35. Repository Organization

**Engineering Decision (proposed):** a monorepo, given the subsystems are modular but must remain version-coordinated (e.g., a simulation run's provenance references specific code versions across ingestion and simulation).

Proposed top-level structure (descriptive, not implementation):
- `/ingestion` — per-source ETL jobs.
- `/simulation` — Heat Exposure Index computation engine.
- `/backend` — API service.
- `/frontend` — CesiumJS/TypeScript client.
- `/db` — schema migrations and conceptual model documentation (no live credentials).
- `/infra` — Docker Compose files, CI configuration.
- `/docs` — this document and subsequent design artifacts.

This is a proposal for the engineering team to accept, reject, or amend; a polyrepo split remains a valid alternative if the team's workflow preferences differ.

## 36. Risk Assessment

| Risk | Likelihood/Impact framing | Mitigation direction |
|---|---|---|
| OSM building height/attribute incompleteness for South Mumbai | Unverified likelihood; high impact on Section 18 factor availability | Verify via Overpass query against the real bounding box before finalizing index methodology (Section 13/18). |
| ESA WorldCover temporal mismatch (fixed 2020/2021 epochs vs. current conditions) | Certain (structural limitation of the dataset) | Explicitly disclose land-cover epoch wherever used; do not present as "current." |
| Cloud cover reducing Sentinel-2/Landsat scene availability, especially during South Asian monsoon months | Likely for parts of the year | Select and document an acquisition window with acceptable cloud cover before committing to a single-date thermal composite. |
| CRS/geometry mismatches across independently sourced datasets | Moderate, standard GIS integration risk | Enforced reprojection and validation step in ingestion (Section 14). |
| No ground-truth data to validate the Heat Exposure Index | Certain, given no known dataset (Section 18) | Present index as relative/comparative, not as a validated absolute measurement, until/unless a validation dataset is identified. |
| Third-party API/licensing changes (TomTom commercial terms, Cesium ion tier limits) | Possible over the project lifetime | Isolate third-party integrations behind internal interfaces (Section 9) so a provider swap does not require wide code changes. |
| Reproducibility failure due to unpinned external data (e.g., re-querying "current" OSM state produces different results over time) | Real risk if not engineered against | Snapshot/version every ingested batch explicitly (Section 14/27); never let the simulation engine read a live, unversioned external feed directly. |

## 37. Known Limitations

- The Heat Exposure Index is a composite proxy built from remote-sensing and reanalysis-scale data; it is not a direct, in-situ measurement of any building's actual thermal condition.
- Spatial resolution of contributing sources (Landsat 30 m, Sentinel-2 10 m, Open-Meteo reanalysis on the order of 9–25 km) is coarser than an individual building footprint in dense urban blocks; per-building values are necessarily attributed/disaggregated from coarser fields, not independently sensed per building.
- No building material, roof type, or albedo data is available from OSM with confirmed reliability for this study area; any factor depending on such attributes cannot be computed without an additional, currently unidentified data source, and must not be approximated with invented defaults.
- ESA WorldCover offers only two fixed-year products (2020, 2021); no continuously current land cover exists in the listed sources.
- No municipal, cadastral, or ground-truth heat/building dataset is assumed to exist for South Mumbai; none has been identified in this document.
- Building height/levels attribute completeness in OSM for the exact study area is unverified as of this document (Section 13).

## 38. Future Extensions

All items below are explicitly **Requires future implementation** and are not part of the initial scope:
- Evaluation of supplementary open building-footprint/height datasets (e.g., Microsoft Building Footprints, Google Open Buildings — both real, existing open datasets) for improved height/attribute completeness over South Mumbai, subject to a licensing and coverage review not yet performed.
- Evaluation of higher-resolution thermal remote sensing (e.g., NASA's ECOSTRESS instrument, a real ISS-hosted thermal imaging mission with resolution finer than Landsat) as a potential improvement to the thermal signature factor, subject to a data-access and licensing review.
- An optional, clearly separated machine-learning module (e.g., for predictive interpolation between observation dates) — per project principle, any such module must remain optional, must never generate or modify building geometry, and must be architecturally separable from the deterministic simulation engine described in Section 17.
- CityGML-based semantic building modeling (Section 25) if richer building semantics become a requirement.
- Multi-snapshot temporal support (Section 26).
- GraphQL API layer (Section 21/23) if client query needs diversify.
- Container-orchestrated (e.g., Kubernetes) production deployment (Section 34) if scale requirements grow beyond the initial single-node design.

## 39. Glossary

- **Digital twin (as used in this document):** a deterministic, versioned, data-driven representation of physical entities (buildings) and their environmental context, used for analysis and scenario comparison. Not synonymous with any generative, predictive, or "AI-driven" city model.
- **Heat Exposure Index:** the composite, per-building indicator defined conceptually in Section 18.
- **Provenance:** the recorded source, version, and retrieval metadata for any piece of data, per Section 24.
- **Deterministic simulation:** a computation that produces numerically identical output given identical inputs and code version (Section 17).
- **CRS:** Coordinate Reference System.
- **DEM:** Digital Elevation Model.
- **LST:** Land Surface Temperature, as delivered by the Landsat Collection 2 Level-2 Surface Temperature product.
- **NDVI:** Normalized Difference Vegetation Index — a standard, pre-existing remote-sensing vegetation index, referenced by name only (Section 18), not redefined here.
- **ETL:** Extract, Transform, Load.
- **3D Tiles:** an OGC open standard, developed by Cesium, for streaming large-scale heterogeneous 3D geospatial datasets.
- **PostGIS:** a spatial extension to PostgreSQL providing geographic object support.
- **Scenario:** a versioned, attribute-level overlay applied to a baseline simulation run, per Section 19.

## 40. References

The following are the real, existing organizations/products/standards referenced in this document. URLs are provided for identification; this document does not reproduce content from these sources.

- OpenStreetMap — openstreetmap.org
- Overpass API — overpass-api.de
- USGS EarthExplorer — earthexplorer.usgs.gov
- USGS Landsat Collection 2 Level-2 Science Products — usgs.gov (Landsat Missions section)
- Copernicus Data Space Ecosystem — dataspace.copernicus.eu
- ESA WorldCover — esa-worldcover.org
- Open-Meteo — open-meteo.com
- TomTom Developer Portal — developer.tomtom.com
- Cesium / Cesium ion / CesiumJS / Cesium OSM Buildings — cesium.com
- PostGIS — postgis.net
- OGC API - Features and 3D Tiles standards — ogc.org
- ISO 19115 (Geographic information — Metadata) — iso.org

---

**End of document.** This EDD is a design artifact for engineering review. Sections marked "Not specified" or "Requires future implementation" are open items and must be resolved — with real, verified information — before the corresponding subsystem is implemented.
