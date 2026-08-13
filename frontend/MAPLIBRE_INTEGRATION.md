# Flood Visualization Frontend (Step 20)

How the browser client visualizes flood-engine outputs on top of the frozen backend (Steps 1–19). This document covers the frontend only — see `backend/FLOOD_ENGINE_INTEGRATION.md` for the Node proxy layer and `flood-engine/VALIDATION.md` for the solver itself.

**Scope discipline**: this is a visualization layer only. No flood depth, arrival time, duration, exposure, damage, or vulnerability is computed anywhere in this codebase — every number displayed comes directly from a Step 14 summary raster, fetched unmodified.

## Why MapLibre GL JS + deck.gl, not "GeoLibre"

The Step 20 prompt asked for "GeoLibre." Investigation found GeoLibre (`github.com/opengeos/GeoLibre`) is not an embeddable library — it's a standalone Tauri+React+DuckDB-WASM application built on top of MapLibre GL JS. Per an explicit project-owner decision, the existing CesiumJS scene layer was replaced with **MapLibre GL JS + deck.gl** directly (deck.gl adds Google Photorealistic 3D Tiles support, which MapLibre has none of natively).

## Architecture

```
Frontend (this subsystem)
  │  HTTP, /api/*
  ▼
Node.js Backend (/api/flood-simulations/*, Step 20 Part 0b)
  │  HTTP, backend/src/floodEngine/client.ts (Step 19)
  ▼
FastAPI Service (Step 15/19)
  │
  ▼
Job Queue (Step 16) → Persistence (Step 17) → Scientific Engine (Step 18)
```

No direct Frontend → FastAPI or Frontend → solver interaction anywhere. `src/config.ts`'s `apiBaseUrl` is the only backend address this app knows.

## Two disclosed prerequisites (built alongside this step, not pre-existing)

Both were found during this step's own architecture audit and treated as minimal, additive, disclosed gaps — the same pattern Steps 15/19 used for their own missing-routes findings:

1. **`aoi_bounds_wgs84` metadata** — flood-engine outputs had no georeferencing anywhere (raw `.npy` arrays, no CRS/bounds). Added as an optional `[west, south, east, north]` (EPSG:4326) field threaded through `pipeline.py` → persistence → the API schema → the Node DTOs. Pure metadata, never read by the solver.
2. **`/api/flood-simulations/*` Node routes** — Step 19 built a server-side client that could talk to FastAPI but never exposed it over HTTP. Added as a thin pass-through Express router (`backend/src/api/routes/floodSimulations.ts`), zero new business logic.

## Module layout (`frontend/src/`)

| Layer     | New files (Step 20)                                                                                                                            | Responsibility                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene/`  | `mapViewer.ts`, `photorealisticTilesLayer.ts`, `floodLayer.ts`, `buildingPickLayer.ts`; rewritten `camera.ts`, `selection.ts`, `twinScene.ts`  | The only layer touching MapLibre/deck.gl. `viewer.ts` and `buildingLayer.ts` (Cesium-specific) were deleted.                                                                                      |
| `domain/` | `colormap.ts`, `floodRaster.ts`, `timeline.ts`, `layers.ts`, `geometryBounds.ts`, `demoScenario.ts`                                            | Pure, framework-free logic — colormapping, rasterizing, the timeline reducer, layer-visibility types. `extrusion.ts`/`styling.ts` (Cesium-extrusion-only) were deleted as dead code once retired. |
| `state/`  | `floodRunState.ts`, `layerVisibilityState.ts`, `timelineState.ts`, `floodInspectionState.ts`                                                   | New `Store<T>` domains, same pattern as the existing `buildingState.ts`/`runState.ts`.                                                                                                            |
| `api/`    | `floodSimulations.ts`, DTOs added to `types.ts`                                                                                                | Reuses the existing `getJson`/`postJson`/`exportUrl` (`api/client.ts`) unchanged — no new HTTP plumbing.                                                                                          |
| `panels/` | `jobStatusPanel.ts`, `timelinePanel.ts` (persistent chrome), `layerControlPanel.ts`, `floodInspectionPanel.ts` (togglable, via `panelHost.ts`) | UI.                                                                                                                                                                                               |

## Job lifecycle (§5, §9)

Five states, copied — never re-derived — from the backend's own `FloodSimulationStatus`: `pending → running → { completed | failed | cancelled }`. `state/floodRunState.ts` polls `GET /api/flood-simulations/:runId` every 2s until terminal, then fetches the summary once on `completed`.

**"Submit" is a labeled demo action, not a real scenario picker** (explicit project-owner decision, this step): no `flood_scenario`/AOI-definition system exists anywhere in this project (frozen out of scope). The "Run Demo Flood Simulation" button (`domain/demoScenario.ts`) submits a fixed, clearly-labeled request referencing `.npy` array paths under `demo-data/` (relative to the flood-engine worker's own cwd), generated from a real windowed subset of actual Mumbai SRTM DEM, ESA WorldCover, and OSM building data (not synthetic fixtures):

```
cd flood-engine
python -m flood_engine.cli.prepare_demo_scenario --dem <path> --landcover <path>
```

`demo-data/provenance.json` records the exact source rasters, window, and real building count used. If `demo-data/` is missing, the job still submits (202 pending) and then genuinely fails when the worker can't load the files — an honest, observable outcome, not a broken demo.

## Layers (§1–§3)

- **Terrain**: MapLibre native `raster-dem` source (Terrarium-encoded), defaulting to AWS's free public tiles (`config.terrainTileUrl`, no key needed).
- **Base imagery**: a MapLibre style URL (`config.mapStyleUrl`), defaulting to a free OpenFreeMap style.
- **3D buildings**: Google Photorealistic 3D Tiles via deck.gl's `Tile3DLayer` (`scene/photorealisticTilesLayer.ts`). Requires `VITE_GOOGLE_3D_TILES_API_KEY` (a real Google Cloud Maps Platform credential this codebase cannot supply); **absent gracefully** — the app renders terrain/imagery/flood layers normally without it, just without photorealistic buildings. **Not end-to-end verified against a real key in this environment** (no live browser here) — flagged below as a known limitation.
- **Flood layers**: exactly the three real Step 14 summary rasters (max depth, arrival time, duration above threshold), colormapped (`domain/colormap.ts`) and rasterized (`domain/floodRaster.ts`) client-side from the already-fetched summary JSON into a deck.gl `BitmapLayer` positioned by the run's `aoiBoundsWgs84`. No interpolation, smoothing, or recomputation of any value.

All six layers (terrain, imagery, 3D buildings, and the three flood layers) are independently toggleable (`state/layerVisibilityState.ts`, `panels/layerControlPanel.ts`) and never interfere with each other.

## Time Animation — approved scope-down (§4)

**No API exposes per-timestep simulation history** — Step 17 never persisted `timestep_records`, and Step 19's frozen API only ever returns the 3 summary rasters. Per explicit project-owner decision, "Time Animation" is a play/pause/restart/speed/slider cycle through those 3 real layers (`domain/timeline.ts`, `state/timelineState.ts`) — not true per-timestep playback. No simulation is ever rerun; no physics is interpolated.

## Feature Inspection (§7)

Clicking the map resolves to exactly one of two outcomes (`scene/selection.ts`'s `resolveMapClick`, routed in `main.ts`):

- **Hit the invisible building-pick layer** → opens the existing (unchanged) building inspection panel.
- **Otherwise** → `domain/floodRaster.ts`'s `sampleGridAt()` reads the already-fetched summary grids at that exact cell (a lookup, never an interpolation) and displays coordinates + max depth + arrival time + duration. No exposure or damage computation.

## Camera (§8)

Reset (top-down, north-up), zoom-to-AOI, and fit-to-buildings are explicit `scene/camera.ts` functions built on `map.fitBounds()`/`map.easeTo()`. Rotate, pitch, and free navigation are native MapLibre drag/touch/scroll gestures plus the `NavigationControl` — nothing to implement. No automatic cinematic fly-through (explicitly out of scope).

## Configuration

| Env var                        | Default                    | Purpose                                                                                        |
| ------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`            | _(required)_               | Backend base URL — also fronts `/api/flood-simulations/*` (same Express app).                  |
| `VITE_MAP_STYLE_URL`           | OpenFreeMap `liberty`      | MapLibre style JSON URL.                                                                       |
| `VITE_TERRAIN_TILE_URL`        | AWS public Terrarium tiles | Raster-DEM terrain source.                                                                     |
| `VITE_GOOGLE_3D_TILES_API_KEY` | _(none)_                   | Google Maps Platform key for Photorealistic 3D Tiles; optional, graceful degradation if unset. |

## Testing

Full unit coverage (vitest, `environment: 'node'`, matching the existing convention) for every pure module: `domain/colormap.ts`, `domain/floodRaster.ts`, `domain/timeline.ts`, `domain/geometryBounds.ts`, `state/floodRunState.ts` (mocked `fetch`, real polling behavior via fake timers), `state/layerVisibilityState.ts`, `state/timelineState.ts` (fake timers), `state/floodInspectionState.ts`, `api/floodSimulations.ts` (mocked `fetch`).

**Disclosed limitation, matching this project's existing convention**: true WebGL/MapLibre/deck.gl rendering (viewer bootstrap producing real pixels, animation FPS, GPU memory) is **not automated** — the frozen `vitest.config.ts` already documented the identical limitation for Cesium before this step. No Playwright/Puppeteer was introduced. Layer/viewer _construction logic_ is unit-tested; actual GPU rendering is not.

## Performance (measurement only, no optimization performed)

- `npm run build`: ~4.4s, production bundle 1.70 MB (466 KB gzipped) — dominated by deck.gl + MapLibre + loaders.gl, expected for this class of library. Vite's own >500 KB chunk-size warning fires; no code-splitting was applied (out of scope per this step's own "no optimization required, only measurement" instruction).
- Live FPS, GPU memory, and tile-load timing require a real browser session this tool environment cannot drive — **reported honestly as unmeasured**, not fabricated. Manual verification in a real browser is a known follow-up.

## Known limitations (disclosed, not silently absorbed)

- **Building selection has no visual feedback on the map anymore.** The retired Cesium scene highlighted the selected building's outline; a fully-invisible pick layer and an opaque, streamed Google Photorealistic 3D Tiles mesh cannot be selectively recolored per building. `state/buildingState.ts`/`panels/inspectionPanel.ts` still work exactly as before — only the map's own visual cue is gone. `TwinScene.setSelectedBuilding()` is kept as a documented no-op to preserve the class's public interface.
- **Google Photorealistic 3D Tiles auth is unverified end-to-end** — no real Google API key was available in this development environment. The `?key=` query-string pattern matches Google's own documented Map Tiles API usage but has not been visually confirmed against a live tileset.
- **The raster row-order convention (row 0 = north) is not visually confirmed against a real rendered map** — verified only by unit test against the documented convention, not by eye against real non-uniform depth data (no live browser here).
- **The demo submission button requires `flood-engine/demo-data/` to have been generated once** via `python -m flood_engine.cli.prepare_demo_scenario` — not regenerated automatically on every submit; see Job lifecycle above.
- **Bundle size** (466 KB gzipped) is unoptimized — code-splitting was out of scope for this step.
- **Pre-existing, unrelated**: `npm audit` reports a moderate `esbuild`/`vite` dev-server advisory that predates this step (fixing it means an out-of-scope `vite@8` major upgrade) — not acted on.
