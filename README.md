# VEKTRA

<img width="600" alt="VEKTRA — Physics-Based Urban Flood Digital Twin" src="VEKTRA_Logo.png" />

### Physics-Based Urban Flood Digital Twin

VEKTRA is an open, research-oriented urban flood digital twin that connects real Earth-observation data, geospatial data, rainfall forcing, physically grounded flood modelling, and an interactive 3D city interface.

The system is designed around a simple idea:

> **A city should not be represented only as a map. It should be possible to explore how rainfall interacts with terrain, buildings, and the urban environment through a physically grounded simulation.**

VEKTRA currently operates on a real Mumbai study area and combines:

- real SRTM elevation data
- ESA WorldCover land-cover data
- real OpenStreetMap building footprints
- real municipal boundary data
- real ERA5-Land rainfall observations
- a WCA2D/CADDIES-style reduced-complexity overland-flow solver
- tiled city-scale execution
- georeferenced GeoTIFF flood products
- an interactive 3D digital-twin viewer

The project is intended as a research and engineering platform rather than a generic map viewer.

---

## What VEKTRA does

VEKTRA connects the following pipeline:

```text
Earth Observation + Open Geospatial Data
                 │
                 ▼
        Spatial Data Ingestion
                 │
                 ▼
        PostGIS Canonical Store
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
   Rainfall Events    City Geometry
        │                 │
        └────────┬────────┘
                 ▼
          Flood Engine
          WCA2D Solver
                 │
                 ▼
       Tiled City-Scale Run
                 │
                 ▼
       Georeferenced Outputs
                 │
        ┌────────┴────────┐
        ▼                 ▼
   GeoTIFF Products    API / Job Queue
                          │
                          ▼
                 Interactive 3D Twin
