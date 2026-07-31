# VEKTRA Database Layer — Architectural Context

This diagram shows where the database layer (this `db/` directory) sits within VEKTRA's overall architecture, per EDD Section 9 (High-Level Architecture) and Section 7 (Modularity). It documents context only — nothing outside `db/` has been implemented as part of this task; ingestion, simulation, backend, and frontend remain out of scope here.

```mermaid
flowchart TD
    subgraph EXT["External Data Sources (Section 8, 13)"]
        OSM["OSM / Overpass"]
        SRTM["SRTM (USGS)"]
        S2["Sentinel-2 (CDSE)"]
        L8["Landsat C2 (USGS)"]
        WC["ESA WorldCover"]
        OM["Open-Meteo"]
    end

    subgraph ING["Ingestion Layer — NOT implemented here (Section 10 #1)"]
        ING_JOBS["Python ETL jobs, one per source"]
    end

    subgraph DB["Database Layer — THIS DELIVERABLE"]
        direction TB
        LOOKUP["data_source"]
        PROV["data_provenance_record"]
        BLDG["building"]
        RAST["environmental_raster_asset"]
        MET["meteorological_observation"]
        RUN["simulation_run"]
        RUNIN["simulation_run_input_dataset"]
        SCEN["scenario"]
        SCENOV["scenario_override"]
        RES["heat_exposure_result"]
        FACT["heat_exposure_factor_value"]
    end

    subgraph RASTER_STORE["Object/file storage for raw raster assets (Section 16, 21) — technology Not specified"]
        FILES["Raw SRTM/Sentinel-2/Landsat/WorldCover files, referenced by environmental_raster_asset.storage_location"]
    end

    subgraph SIM["Simulation Engine — NOT implemented here (Section 10 #4, 17)"]
        SIM_ENGINE["Deterministic Python batch process"]
    end

    subgraph API["Backend API — NOT implemented here (Section 10 #7, 21, 23)"]
        API_LAYER["Node.js + TypeScript REST API"]
    end

    subgraph FE["Frontend — NOT implemented here (Section 10 #8, 20, 22)"]
        FE_APP["TypeScript + CesiumJS client"]
    end

    OSM --> ING_JOBS
    SRTM --> ING_JOBS
    S2 --> ING_JOBS
    L8 --> ING_JOBS
    WC --> ING_JOBS
    OM --> ING_JOBS

    ING_JOBS -->|"role: vektra_ingestion (Section 33)"| DB
    ING_JOBS -.->|raw files| RASTER_STORE
    RASTER_STORE -.->|storage_location reference| RAST

    DB -->|"role: vektra_simulation (Section 33)"| SIM_ENGINE
    SIM_ENGINE -->|"writes runs + results"| DB

    DB -->|"role: vektra_backend_api, read-only + scenario writes (Section 33)"| API_LAYER
    API_LAYER --> FE_APP
```

## Layer boundaries this schema enforces (Section 9)

- **Ingestion depends on nothing downstream.** It only ever writes to `data_source`, `data_provenance_record`, `building`, `environmental_raster_asset`, `meteorological_observation` (see `vektra_ingestion` grants, migration `0014`).
- **Simulation depends only on canonical storage**, never on the API or frontend (Section 9: "The simulation engine depends only on canonical storage, never on the API or frontend"). It reads canonical + scenario tables and writes `simulation_run`, `simulation_run_input_dataset`, `heat_exposure_result`, `heat_exposure_factor_value` (`vektra_simulation` grants).
- **The API layer depends on canonical and derived storage, never directly on external data sources** (Section 9). It is read-only except for scenario creation (FR-8), matching `vektra_backend_api` grants.
- **No path allows the frontend, API layer, or scenario subsystem to write to building geometry** (Section 11). Enforced structurally: no role other than `vektra_ingestion` has `INSERT`/`UPDATE` on `building`, and the `trg_building_no_update` trigger blocks all updates regardless of role (migration `0005`).

## Explicitly out of scope for this task

Per the instructions this schema was built under: no frontend code, no Cesium integration, no API code, no simulation code, and no ingestion code were written. Only the database layer (`db/`) was implemented.
