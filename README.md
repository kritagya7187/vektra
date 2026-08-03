# VEKTRA

<img width="600" alt="VEKTRA — Physics-Based Urban Flood Digital Twin" src="VEKTRA_Logo.png" />

A Fluvial Flood Simulation Engine for urban pluvial flood digital twins, built on open Earth-observation data.

The core scientific component is a physically-grounded, reduced-complexity overland-flow engine (CADDIES/WCA2D methodology) that simulates rainfall-driven inundation and produces per-cell depth, arrival-time, and duration summaries — see [`flood-engine/README.md`](flood-engine/README.md) for the engine's own architecture, scientific specification, and build status.

## Modules

- [`flood-engine/`](flood-engine/) — the flood simulation engine itself: a Python microservice implementing the WCA2D solver, timestepping, simulation controller, output summaries, an async job queue, and PostgreSQL persistence. See its own README for the full numerical specification and current implementation status.
- [`backend/`](backend/) — Node.js + TypeScript REST API. Mediates all access to the shared PostGIS database and hosts the data ingestion CLI entry points (OSM building footprints, DEM/land-cover/imagery via Google Earth Engine, meteorological observations) that feed both `flood-engine/` and the frontend.
- [`frontend/`](frontend/) — TypeScript + CesiumJS 3D client. Currently renders the building digital twin (footprints, attributes, provenance); flood-run visualization is planned on top of the same viewer/panel/state architecture.
- [`db/`](db/) — PostgreSQL + PostGIS schema: numbered migrations, seed data, and schema documentation for the shared canonical/derived storage layer `backend/` and `flood-engine/` both read from and write to.
- [`infra/`](infra/) — Docker Compose orchestration and CI configuration. See [`infra/ci/README.md`](infra/ci/README.md) for what the GitHub Actions workflow actually checks.
- [`docs/`](docs/) — project-level design artifacts.

## Getting started

```
cp .env.example .env   # fill in required values
docker compose up
```

See [`infra/docker/README.md`](infra/docker/README.md) and each module's own README for details.
