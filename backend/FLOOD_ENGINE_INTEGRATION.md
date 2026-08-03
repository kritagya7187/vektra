# Flood Engine Integration (Step 19)

How the Node backend talks to the Python flood-engine FastAPI service (Step 15) that fronts the job queue (Step 16), persistence (Step 17), and scientific solver (Steps 1–14, 18). This document covers the Node side only. It does not restate flood-engine's own architecture — see `flood-engine/README.md`, `flood-engine/VALIDATION.md`, and `flood-engine/docs/NUMERICAL_DEVIATIONS.md` for that.

**Scope discipline**: this integration is orchestration only. No scientific computation, no reinterpretation of numerical output, and no job-lifecycle state invented on the Node side — the Python engine is the source of truth for everything except HTTP transport and error translation.

## Architecture

```
Frontend ──▶ Node.js Backend ──HTTP──▶ FastAPI Service (Step 15)
                                              │
                                              ▼
                                        Job Queue (Step 16)
                                              │
                                              ▼
                                       Persistence (Step 17)
                                              │
                                              ▼
                                    Scientific Engine (Step 18)
```

There is no direct Node → solver interaction anywhere in this integration. Every scientific value the backend exposes was computed by the Python engine and is only ever renamed (snake_case → camelCase) on the way through, never recomputed.

## Module layout (`backend/src/floodEngine/`)

| File            | Responsibility                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`      | Public camelCase DTOs, plus `*Wire` interfaces that mirror flood-engine's real JSON field names exactly.                                                                                                                                          |
| `translate.ts`  | Pure rename-only translation functions between DTOs and wire shapes (Parts D/E). No numeric value is computed, rounded, or reinterpreted anywhere in this file.                                                                                   |
| `errors.ts`     | Maps flood-engine HTTP status codes and network failures onto this backend's existing error taxonomy (Part F).                                                                                                                                    |
| `httpClient.ts` | `floodEngineFetch()` — timeout/retry/backoff transport wrapper around `fetch`, independent of `ingestion/shared/httpRetry.ts` (that utility collapses all failures into one generic error and loses the HTTP-status distinction Part F requires). |
| `client.ts`     | `createFloodEngineClient()` / `getFloodEngineClient()` — the public API surface. Five methods, one per flood-engine route.                                                                                                                        |
| `index.ts`      | Barrel export.                                                                                                                                                                                                                                    |

## Configuration (Part B)

All flood-engine connection settings live in `src/config/env.schema.ts` / `src/config/config.ts`, read once at process startup like every other config value in this backend. No hard-coded URLs anywhere in `src/floodEngine/`.

| Env var                          | Default                             | Purpose                                                                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLOOD_ENGINE_BASE_URL`          | _(none — required at point of use)_ | Base URL of the flood-engine FastAPI service. Not defaulted, matching `RASTER_STORAGE_DIR`'s existing pattern: no established deployment address exists yet (flood-engine is not in `docker-compose.yml`). `createFloodEngineClient()` throws immediately if empty. |
| `FLOOD_ENGINE_TIMEOUT_MS`        | `30000`                             | Per-attempt request timeout.                                                                                                                                                                                                                                        |
| `FLOOD_ENGINE_MAX_RETRIES`       | `3`                                 | Retries for retryable failures (429, 5xx, network/timeout errors).                                                                                                                                                                                                  |
| `FLOOD_ENGINE_MAX_PAYLOAD_BYTES` | `65536`                             | Maximum submission payload size, checked client-side before sending.                                                                                                                                                                                                |

`getFloodEngineClient()` lazily constructs a process-wide singleton from `config.floodEngine` on first use — constructing eagerly at import time would break any process (including the test suite) that hasn't set `FLOOD_ENGINE_BASE_URL`.

## Job lifecycle (Part C)

Five states, copied — not re-derived — from `flood_engine.jobs.models.JobStatus` (Step 16, frozen):

```
pending → running → completed [terminal]
              │
              ├─→ failed [terminal]
              └─→ cancelled [terminal]  (internal-only on the Python side; reachable via the Node client's cancelSimulation() only while still pending)
```

The Node backend never invents a sixth state, never infers a state from timing or absence of a response, and never transitions a job itself — every state comes from a `status` field in a flood-engine response.

## Request flow (Part D)

`client.submitSimulation(request)`:

1. Caller supplies a `SubmitSimulationRequest` (camelCase) — `scenarioId` plus five `.npy` file path fields (`elevationPath`, `buildingMaskPath`, `manningNPath`, `infiltrationLossPath`, `rainfallRatesPath`), and optional `solverParameters` / `timesteppingParameters` overrides.
2. `toSubmitSimulationRequestWire()` renames fields to flood-engine's exact snake_case Pydantic schema (`flood_engine/src/flood_engine/api/schemas/jobs.py::SubmitSimulationRequest`). No field value is altered.
3. Payload size is checked against `maxPayloadBytes` before sending.
4. `floodEngineFetch()` POSTs to `/api/v1/simulations`.

This mirrors `PostgresJobRepository.enqueue()`'s real parameters exactly — a deliberate, disclosed departure from the original SDS §8 sketch (which assumed a `flood_scenario` object that does not exist yet; `flood_engine.scenario` remains a stub). The five path fields reference already-prepared arrays on shared storage; this backend does not upload raw array data inline.

The backend may validate structurally required fields (non-empty strings, etc.) before sending, but never derives, defaults, or alters a simulation parameter — every solver/timestepping value either comes from the caller unchanged or is omitted so flood-engine applies its own frozen defaults.

## Response flow (Part E)

Each of the five client methods does exactly: HTTP call → JSON parse → wire→DTO rename. Nothing else.

| Method                                        | Route                                                 | DTO                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `submitSimulation(request)`                   | `POST /api/v1/simulations`                            | `SubmitSimulationResult` (`runId`, `status`)                                                                                   |
| `getSimulationStatus(runId)`                  | `GET /api/v1/simulations/{runId}`                     | `SimulationRunStatus` (status + all four timestamps + `errorMessage`)                                                          |
| `getSimulationSummary(runId)`                 | `GET /api/v1/simulations/{runId}/summary`             | `FloodOutputSummary` (max depth / arrival time / duration-above-threshold grids, `MassLedger`, step count, simulated duration) |
| `downloadSimulationArtifact(runId, artifact)` | `GET /api/v1/simulations/{runId}/download/{artifact}` | `DownloadedArtifact` (raw `.npy` bytes, content type, filename — bytes are never parsed or modified)                           |
| `cancelSimulation(runId)`                     | `POST /api/v1/simulations/{runId}/cancel`             | `SimulationRunStatus`                                                                                                          |

`artifact` is one of `'max-depth' | 'arrival-time' | 'duration-above-threshold'` (`SIMULATION_ARTIFACTS`). `arrivalTimeMin` preserves `null` exactly where flood-engine wrote it (its own representation of "threshold never crossed" for a cell) — never coerced to a number, never dropped.

## Error propagation (Part F)

`floodEngineFetch()` retries 429 and 5xx responses, plus network/timeout failures, up to `maxRetries` times with exponential backoff (base 500ms, cap 10s, honoring a numeric `Retry-After` header when present). Non-retryable HTTP errors and exhausted retries are translated once, at the transport boundary, into this backend's existing error types — no new error classes were needed:

| flood-engine response                    | Node error             | HTTP status returned to caller |
| ---------------------------------------- | ---------------------- | ------------------------------ |
| 400 / 422                                | `ValidationError`      | 400                            |
| 404                                      | `NotFoundError`        | 404                            |
| 409                                      | `ConflictError`        | 409                            |
| any other status (500, unexpected codes) | `ExternalServiceError` | 502                            |
| network failure / connection refused     | `ExternalServiceError` | 502                            |
| request timeout                          | `ExternalServiceError` | 502                            |
| malformed (non-JSON) 2xx response body   | `ExternalServiceError` | 502                            |

`errorHandler.ts` (pre-existing, unmodified) only ever serializes `err.message` to the client, never `.cause` or `.stack` — this structurally guarantees no Python traceback reaches an HTTP caller, as long as the constructed message stays generic, which every branch above does. The real flood-engine error detail (`{"detail": "..."}`, when present) is used to build the Node error's message but the underlying Python traceback itself is never available on this side — flood-engine's own FastAPI exception handlers already strip it before the response leaves the Python process.

## Testing (Part G)

`backend/tests/integration/floodEngine.test.ts` — 10 scenarios, run against real infrastructure wherever practical:

- **Real server, real worker** (`tests/helpers/floodEngineServer.ts` spawns a real `uvicorn` process serving `flood_engine.api.app:app` plus a real `python -m flood_engine.jobs.worker` process, both pointed at the disposable `flood-engine-test-db` Postgres container used throughout Steps 17–18): successful submission, polling to completion, a genuinely failed job (malformed array shape — the same scenario flood-engine's own error-recovery tests use), a cancelled job, unknown-run 404, duplicate concurrent polling, concurrent submissions.
- **Mocked external infrastructure only** (plain `node:http` servers, not the real flood-engine — legitimate per Part G's "mock only external infrastructure" instruction, since these three failure modes can't be induced by the real service on demand): an unavailable server (closed port), a request that exceeds the configured timeout, a malformed non-JSON response body.

Real-server tests skip (not fail) when the disposable test database isn't reachable, matching the convention flood-engine's own Python integration tests already use.

`backend/tests/integration/floodEnginePerformance.test.ts` — Part H, measurement only, against the same real server/worker infrastructure.

## Performance (Part H — measurement only, no optimization performed)

Measured on the development machine against the local real FastAPI service + worker + disposable Postgres container, tiny (2×2 cell) synthetic scenarios:

| Operation                                          | n   | min                                         | p50   | mean   | max    |
| -------------------------------------------------- | --- | ------------------------------------------- | ----- | ------ | ------ |
| Submission                                         | 5   | 4.1ms                                       | 5.6ms | 10.1ms | 27.4ms |
| Status poll                                        | 10  | 1.5ms                                       | 1.9ms | 2.5ms  | 8.0ms  |
| Artifact download                                  | 3   | 2.8ms                                       | 3.0ms | 3.5ms  | 4.6ms  |
| Concurrent submission (5 in parallel, per-request) | 5   | 6.1ms                                       | 7.7ms | 7.5ms  | 8.9ms  |
| Concurrent submission (aggregate, 5 requests)      | —   | total wall clock 9.7ms (≈518 req/s implied) |       |        |        |

These numbers reflect local-loopback network cost and a trivial grid size — they are not a production SLA and were not used to tune anything (per the freeze spec: "no optimization is required, only measurement"). Real-world latency will be dominated by actual solver runtime for realistic grid sizes (see `flood-engine/VALIDATION.md`'s own runtime-scaling finding), not by this transport layer.

## Deployment configuration and operational assumptions

- flood-engine is not yet in `docker-compose.yml` — `FLOOD_ENGINE_BASE_URL` must be set explicitly wherever this backend runs against a real flood-engine deployment. There is no default; omitting it makes any flood-engine client call fail fast with a clear message rather than silently pointing at `localhost`.
- The Node backend assumes the FastAPI service and its worker process are both already running and reachable — it does not start, stop, or health-check them. Deploying/supervising those processes is out of Step 19's scope (per the freeze spec's "do not... redesign the job queue").
- Retries are safe to enable for all five methods as implemented, because flood-engine's own job submission is not naturally idempotent at the HTTP layer (each successful `POST /api/v1/simulations` creates a new run) — but retries only fire for network failures/429/5xx, i.e. cases where no successful response was ever received by this client, not after a confirmed 2xx.
- `FLOOD_ENGINE_MAX_PAYLOAD_BYTES` guards against accidentally-oversized submission bodies; it does not bound the size of downloaded artifacts (summary/download responses can legitimately be large for real grid sizes — no client-side cap is applied to response bodies).
