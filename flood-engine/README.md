# flood-engine

Stage 1 simulation engine for the VEKTRA Earth-Observation-Driven Urban Flood
Digital Twin — the first Python component in the VEKTRA stack, alongside the
existing `backend/` (Node/TypeScript) and `frontend/` (TypeScript/Cesium).

This service is not an independent product. It implements exactly one
frozen specification: the Scientific Design Specification (SDS) and
Numerical Model Specification (NMS) in the project's plan record. Nothing in
this codebase should be read as redefining the scientific problem, the
mathematical model, or the datasets — those decisions are frozen upstream of
this repository. If an implementation detail here appears to contradict the
NMS/SDS, that is treated as a bug in this codebase or a genuine
specification gap to be raised explicitly, never as license to quietly
reinterpret the spec.

## Why Python, in an otherwise Node/TypeScript stack

Numerical grid computation (the WCA2D cell-update rule, raster
preprocessing) is array-heavy work NumPy/SciPy/rasterio/GeoPandas are built
for, and Node has no comparable ecosystem. The existing Node backend already
orchestrates one external specialized capability this way (Google Earth
Engine, via `backend/src/ingestion/remoteSensing/gee/`); this service is the
same shape — the Node backend calls out to `flood-engine` over HTTP, not a
new architectural pattern.

## Layout

```
src/flood_engine/
├── core/            pure scientific logic — NMS math only, zero I/O, zero framework imports
│   └── solver/      the Stage 1 WCA2D implementation specifically (swappable in isolation)
├── inputs/          typed in-memory shape of DEM/land-cover/building/rainfall inputs
├── scenario/        the flood_scenario domain object (SDS §5)
├── simulation/       controller: drives core over real inputs, produces NMS summary outputs
├── io/               rasterio/geopandas file I/O — the only package that opens a file
├── preprocessing/    DEM/land-cover/building preprocessing pipelines (io + inputs -> model-ready arrays)
├── api/              FastAPI app, routers, Pydantic schemas
├── jobs/             async job queue for simulation runs
└── persistence/      PostgreSQL/PostGIS repositories, one per SDS §7 entity
```

Dependency direction is one-way: `core` depends on nothing else in this
package; `simulation`/`scenario`/`inputs` depend only on `core`;
`api`/`io`/`preprocessing`/`jobs`/`persistence` depend on the layers above
them, never the reverse. This is what keeps the solver testable without a
database or a running service, and what confines a future Stage 2 solver
swap to `core/solver/` alone.

## Status

Steps 1–11 of 20 are frozen; Step 12 (`core.timestepping`, the outer
simulation loop) is implemented and awaiting freeze review. The WCA2D
solver (`core/solver/wca2d.py`) is now VEKTRA's reference implementation
of the frozen Numerical Algorithm Specification — see
`docs/NUMERICAL_DEVIATIONS.md` for every reviewed, intentional difference
from the University of Exeter reference implementation, and the project
plan record for the full build order and the frozen NMS/SDS this
implements.
