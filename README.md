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
```

---

## Getting started

VEKTRA has three services: a Node/TypeScript **backend** (API + job queue), a Python **flood-engine** (WCA2D solver, FastAPI), and a TypeScript **frontend** (MapLibre + deck.gl viewer), backed by PostGIS.

### Option A — Docker Compose (backend + frontend + database)

```bash
cp .env.example .env   # fill in the required values — see the comments in the file
docker compose up --build
```

This starts PostGIS, the backend API, and the frontend. The frontend is served at `http://localhost:${FRONTEND_PORT}` (default `8080`), the backend at `http://localhost:${BACKEND_PORT}` (default `3000`).

flood-engine is not wired into `docker-compose.yml` yet — run it separately (Option B below) and point the backend at it via `FLOOD_ENGINE_BASE_URL` in `.env` (use `http://host.docker.internal:8000` from inside the backend container).

### Option B — Run each service directly

```bash
# Database: any PostGIS-enabled Postgres reachable via the POSTGRES_* vars in .env

# Backend
cd backend
npm install
cp .env.example .env   # fill in the required values
npm run dev             # http://localhost:3000

# Frontend
cd frontend
npm install
cp .env.example .env   # fill in the required values
npm run dev             # http://localhost:5173 (Vite default)

# flood-engine
cd flood-engine
python -m venv .venv
.venv/bin/pip install -e .        # Windows: .venv\Scripts\pip install -e .
cp .env.example .env               # fill in the required values
.venv/bin/python -m uvicorn flood_engine.api.app:app --host 127.0.0.1 --port 8000
```

Every `.env.example` file (root, `backend/`, `frontend/`, `flood-engine/`) documents each variable inline — required vs. optional, and what happens if left blank.

### Running the checks locally

Each service defines the same checks CI runs (`.github/workflows/ci.yml`):

```bash
npm run typecheck && npm run lint && npm run format:check && npm test   # backend, frontend
ruff check . && mypy src && pytest                                       # flood-engine
```
