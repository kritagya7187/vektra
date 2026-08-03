# VALIDATION.md — Step 18: Scientific Validation & End-to-End Integration

This document records the scientific assumptions, validation methodology, analytical test cases,
known deviations, accepted limitations, and verification results established by Step 18. It does
not restate anything already frozen in earlier steps — see
[`docs/NUMERICAL_DEVIATIONS.md`](docs/NUMERICAL_DEVIATIONS.md) for every deliberate numerical
difference between this implementation and the University of Exeter CADDIES/WCA2D reference, and
the project's plan record for the frozen Scientific Design Specification (SDS) and Numerical Model
Specification (NMS) this step validates against.

## 1. Scope and architecture (Part A)

Step 18 introduced **two new scientific modules** that Steps 1–17 documented as part of the frozen
design but never implemented — `core.solver.roughness` (Manning's-*n* land-cover crosswalk) and
`core.solver.infiltration` (land-cover/Hydrologic-Soil-Group infiltration-rate crosswalk). Their
absence was a real, blocking gap discovered during Step 18's own pre-implementation architecture
verification: Part B's required execution chain (`DEM → land cover → building raster → roughness
grid → infiltration grid → rainfall forcing → controller → output → persistence`) cannot be built
without them. Building them was confirmed with the project owner before any code was written, and
is disclosed here rather than folded in silently. No other frozen module (WCA2D solver, timestep
logic, preprocessing, rainfall loading, persistence, API, job queue) was modified except one
objective defect fix: `jobs.worker._build_repository()` still unconditionally raised
`NotImplementedError` claiming Step 17 didn't exist, when it had been implemented in a prior
session — wired to the real `PostgresJobRepository` here.

A third new module, `flood_engine.pipeline`, closes a second gap `simulation.controller`'s own
docstring names explicitly: nothing converted `RasterDataset`/`GeoDataFrame`/`RainfallForcing`
outputs into the raw NumPy arrays `simulation.controller.run()` requires. `pipeline.build_simulation_inputs()`
is that layer — pure orchestration (calls each frozen preprocessing/crosswalk function once, in
the NMS's own documented order), no new physics.

Dependency direction verified clean throughout: `core` never imports outward; `simulation` still
depends only on `core`; `pipeline` is the first module allowed to depend on both the
`io`/`preprocessing`/`inputs` side and the `simulation` side, sitting strictly above `simulation`
per the package's own frozen one-directional rule.

## 2. Scientific assumptions this step froze

### 2.1 Roughness (Manning's *n*)

Point values are the midpoint of the NMS's own frozen "typical range" table, cited against Chow,
V.T., *Open-Channel Hydraulics* (McGraw-Hill, 1959) — the source the NMS's own text names as the
one to check at implementation time. See `core/solver/roughness.py`'s module docstring for the
full table and the exact class-code coverage (ESA WorldCover v100/v200 codes actually used
elsewhere in this project's ingestion pipeline, not invented). Building cells receive a provably
inert placeholder value (the built-up/paved figure) — `core.solver.wca2d.step()`'s own building
mask excludes them from every roughness-driven computation, confirmed by reading the solver
directly, not assumed.

### 2.2 Infiltration

The classic SCS Curve Number method produces a *cumulative* abstraction curve, not the constant
per-cell rate `core.solver.wca2d.step()`'s existing bucket-removal mechanism needs. Converting CN
to a rate would require an unfrozen, storm-duration-dependent assumption nothing in the NMS
specifies — a real methodology gap surfaced during this step, confirmed with the project owner
before implementation. **Resolution (confirmed, not assumed):** use literature-published NRCS
minimum/final infiltration rates by Hydrologic Soil Group directly, not a value converted from CN's
cumulative-retention formula. A single default HSG **D** (the most conservative — least infiltration,
most runoff-producing) is assumed uniformly, per the NMS's own already-frozen "no soil-survey data
source" statement. Land cover's role is narrower than roughness's here: it distinguishes
**impervious** (built-up, open water — zero infiltration capacity, independent of soil group) from
**pervious** (every vegetated/bare-soil class, sharing the one assumed HSG-D rate — HSG-D's own
published 0–1.3 mm/hr range does not support inventing per-vegetation-type multipliers within it).
See `core/solver/infiltration.py`'s module docstring for the full sourcing.

### 2.3 Pipeline coverage requirement

`pipeline.build_simulation_inputs()` refuses to run the solver against a DEM with any nodata cell
remaining after alignment (raises `PipelineError`) — the solver has no nodata concept at all, and
feeding it a sentinel elevation value would silently corrupt the physics rather than fail loudly.
AOI/DEM-coverage resolution remains an explicitly unresolved NMS "Grid" section item; this is a
real, disclosed limitation, not a defect papered over.

## 3. Validation methodology (Part C)

Every test in `tests/validation/test_scientific_validation.py` calls
`simulation.controller.run()` — never the solver or timestepping engine directly — validating
properties of the *complete model*, distinct from what Steps 1–17's own frozen unit tests already
establish at the single-step/single-run-loop level. Comparisons are analytical where the WCA2D
formulation makes one tractable (mass conservation, monotonic max/duration accumulation,
dry-domain zero-state, elapsed-time-equals-cumulative-dt), and manually-computed/synthetic-scenario
otherwise (symmetry preservation under a centered hill/depression, repeatability). No comparison
against real CADDIES reference output anywhere — none is available to this project, consistent with
the prompt's own instruction.

**13 categories validated, 32 tests:** mass conservation over a full run, no negative depths (final
and every intermediate timestep), stable timestep evolution (bounds, finiteness, elapsed-time
consistency), rainfall volume conservation (against the analytical `rate × area × duration`
expectation for constant forcing), infiltration accounting (zero for impervious, positive for
pervious, never exceeds rainfall input), boundary outflow accounting (positive for sloped terrain,
negligible for a closed depression), building obstruction (dry throughout every recorded timestep,
not just the final state), arrival-time correctness (independently recomputed by scanning real
timestep records, not the same code path as `generate_summary`), maximum-depth accumulation
(independently recomputed running maximum), duration-above-threshold accumulation (independently
recomputed `Σ dt` over above-threshold steps), dry-domain behavior (zero rainfall ⇒ all-zero
state/ledger/summary), symmetry preservation (left-right and top-bottom mirror symmetry for a
centered hill/depression), and repeatability (bit-identical final state, mass ledger, and summary
across fresh, independently-constructed input arrays).

### 3.1 Real finding during validation: boundary outflow in a "closed" depression is not exactly zero

Expected a deep, closed depression with modest rainfall to produce exactly zero boundary outflow.
Real measured result: a small but nonzero amount (≈0.5% of total rainfall input for the tested
scenario). **Cause, confirmed by reading `docs/NUMERICAL_DEVIATIONS.md`'s own open-boundary
section:** the frozen open-boundary convention (`H_boundary = z_center`) means any wet edge cell has
an inherent outward gradient regardless of terrain slope, and rainfall falls on edge cells directly
too — a real, already-documented model property, not a Step 18 defect. The test asserts "small
relative to total rainfall" (< 1%), not exact zero.

## 4. Numerical regression suite (Part D)

`tests/validation/test_numerical_regression.py` — 13 permanent scenarios (flat terrain, single
hill, single depression, building barrier, constant rainfall, zero rainfall, high rainfall, large
timestep, small timestep, long simulation, very shallow water, deep water, edge discharge), 17
tests. Each scenario's real, actually-computed output (step count, simulated duration, final depth
sum/max, full mass ledger) was captured once and pinned as a permanent expected value — `rtol=1e-9`
for floating-point values (the same bound the frozen mass-ledger machine-precision test in
`core.timestepping`'s own suite uses), exact equality for `step_count`/`simulated_duration_s`. A
future failure here is a signal to investigate per `docs/NUMERICAL_DEVIATIONS.md`'s own review
discipline ("any change to wca2d.py that could alter output requires a dedicated numerical audit
before merge"), never a value to casually update.

Two scenarios also carry an explicit physical cross-check alongside their pinned values: the deep-water
scenario's final depth stays below the depression's own basin depth (a sanity bound, not just a
number match), and the edge-discharge scenario confirms boundary outflow genuinely dominates the
mass budget over infiltration (the scenario's defining physical property, not an incidental fact
about the pinned numbers).

## 5. Performance benchmark (Part E)

Measured only — nothing was optimized. Single-run wall-clock measurements on one development
machine, not controlled multi-run statistics.

| Grid size | Cells | Steps | Elapsed (s) | Cells/sec | Steps/sec | Peak memory (MB) |
|---|---|---|---|---|---|---|
| 100×100 | 10,000 | 300 | 0.903 | 3,322,721 | 332.27 | 51.62 |
| 250×250 | 62,500 | 301 | 4.060 | 4,634,176 | 74.15 | 322.36 |
| 500×500 | 250,000 | 300 | 30.350 | 2,471,172 | 9.88 | 1,284.72 |
| 1000×1000 | 1,000,000 | 300 | 130.772 | 2,294,070 | 2.29 | 5,138.26 |

**Observed, undocumented-until-now characteristic (reported per this Part's own "document, do not
change" instruction):** runtime does not scale linearly with cell count. 100→250 is ≈4.5× slower
for 6.25× the cells; 250→500 is ≈7.5× slower for only 4× the cells; 500→1000 is ≈4.3× slower for
4× the cells. The middle jump (250→500) is the steepest relative to its cell-count increase,
suggesting a real memory-bandwidth/cache effect becomes significant somewhere between 250×250 and
500×500 on the measurement machine — not investigated further, since Part E's own instruction is
to measure and document, not to profile or optimize. Peak memory scales close to linearly with
cell count throughout (≈5 KB/cell), consistent with a small constant number of full-grid float64
arrays held per step.

100×100 and 250×250 run in every ordinary `pytest` invocation (a few seconds, a standing
catastrophic-regression guard using a generously loose throughput floor, not a performance pin).
500×500 and 1000×1000 are skipped by default (real wall-clock minutes) — set
`FLOOD_ENGINE_RUN_BENCHMARKS=1` to include them.

## 6. Determinism (Part F)

`tests/validation/test_determinism.py` — every output raster (`FloodOutputSummary.max_depth_m`,
`arrival_time_min`, `duration_above_threshold_min`) and the final `SolverState.water_depth_m` field
is hashed with SHA-256 (`hashlib.sha256(array.tobytes())`, including NaN bit patterns) across
repeated runs from fresh, independently-constructed input arrays — hill, depression, and building-barrier
scenarios, three repeated runs (not just two) for one scenario to make a coincidental cancelling bug
implausible. All hashes matched exactly, every run, across all scenarios. A separate check confirms
the hash function itself actually distinguishes real content (different rainfall, different terrain,
and even a single differing cell all change the digest) — without this, the matching-hash tests
above would be vacuously true.

## 7. Error recovery (Part G)

`tests/validation/test_error_recovery.py` — 17 tests. Every mechanism exercised already exists in
the frozen Steps 15–17 persistence/job-queue layers; this Part validates them holistically, it does
not invent new error handling (the one exception, `pipeline.PipelineError`, is Step 18's own
addition, already covered in `tests/integration/test_pipeline.py`).

- **Invalid DEM / land cover / buildings**: missing-nodata and CRS-mismatch guards raise clearly
  (`RasterValidationError`); an unmapped land-cover class raises clearly
  (`RoughnessError`/`InfiltrationError`) rather than silently defaulting; a NaN elevation value is
  **not** independently validated by the solver, but is caught by the frozen run-level
  mass-conservation check (`SimulationControllerError`) rather than silently producing a
  wrong-but-plausible answer — a real, observed finding, not assumed.
- **Missing rainfall**: an empty record sequence (`RainfallForcingError`) and an empty rate array
  to the controller (`TimesteppingError`) both raise clearly.
- **Database unavailable**: connecting to a guaranteed-unroutable host (`192.0.2.1`, RFC 5737
  TEST-NET-1) fails within single-digit seconds via `psycopg_pool.PoolTimeout`, not a hang.
- **Worker crash**: a repository whose `mark_completed` raises mid-write-back does not kill
  `run_worker`'s outer loop (frozen Step 16 behavior, validated here against a real scenario, not
  re-implemented).
- **Simulation exception**: a real job with a shape-mismatched array (`WCA2DError`) is marked
  `failed`, not `completed`, in the real database, with a non-empty `error_message`, and the worker
  loop survives and keeps polling.
- **Persistence rollback**: a real duplicate-primary-key violation (a second `mark_completed` for an
  already-completed run) raises `PersistenceError` without corrupting the first, already-committed
  row — exactly one output row survives, status stays `completed`.
- **Job recovery after restart**: a job claimed (`running`) and then abandoned (simulating a crashed
  worker) is reclaimed as `failed` by `sweep_stuck_jobs()` once its timeout elapses — the real
  "job recovery after restart" mechanism a freshly (re)started worker calls every poll cycle. A run
  still within its timeout is confirmed left untouched (`running`), not prematurely reclaimed.
- **No partial outputs after failure**: confirmed directly against the real database — a failed run
  has zero rows in `flood_simulation_output`, and `read_completed_output()` returns `None`.

## 8. Accepted limitations (carried forward, not introduced by Step 18)

- Overland-flow-only; no piped drainage network (NMS, frozen).
- 30 m grid; sub-grid building partial-blockage not modeled (NMS, frozen).
- Rainfall forcing is spatially uniform across the AOI (NMS, frozen).
- AOI/DEM-coverage resolution remains unresolved — `pipeline.build_simulation_inputs()` fails
  loudly rather than guessing (Step 18, disclosed above).
- The single default Hydrologic Soil Group (D) is a real, disclosed assumption, not a measured soil
  property — VEKTRA has no soil-survey data source (NMS, frozen; Step 18 resolves how it is
  consumed, not whether it is assumed).
- No `max_velocity_mps` field on `FloodOutputSummary` — excluded per prior project-owner
  confirmation despite appearing in SDS Section 3 prose (frozen, unchanged by Step 18).
- Output arrays remain `.npy` dumps, not real georeferenced rasters (Step 17, frozen; unaffected by
  this step).

## 9. Verification results

```
ruff check .          -> All checks passed (entire flood-engine/ tree)
mypy src               -> Success: no issues found in 41 source files
mypy src tests         -> 24 pre-existing errors, all in frozen Steps 1-17 test files
                           (tests/unit/core/test_timestepping.py, tests/unit/simulation/test_controller.py,
                           tests/unit/jobs/test_models.py, tests/unit/api/test_app.py,
                           tests/integration/test_postgres_job_repository.py) -- confirmed identical
                           to the Step 18 architecture-verification baseline (Part A), none touching
                           any Step 18 code; every new file this step adds is clean under mypy --strict
                           on its own.
pytest -q              -> 398 passed, 2 skipped (opt-in slow 500x500/1000x1000 benchmarks), 100.00%
                           coverage (fail_under=85)
```

**Totals**: 400 tests collected (285 pre-Step-18 baseline + 115 new). New test files:
`tests/unit/core/test_roughness.py` (10), `tests/unit/core/test_infiltration.py` (10),
`tests/integration/test_pipeline.py` (10), `tests/integration/test_end_to_end.py` (8),
`tests/validation/test_scientific_validation.py` (32), `tests/validation/test_numerical_regression.py` (17),
`tests/validation/test_performance_benchmark.py` (4, 2 skipped by default),
`tests/validation/test_determinism.py` (8), `tests/validation/test_error_recovery.py` (17); plus one
net-new test in the existing `tests/unit/jobs/test_worker.py` (two obsolete
`NotImplementedError`-era tests replaced with one real wiring test, per the `_build_repository()`
defect fix in §1).

No claim in this document was made without running the command it reports.
