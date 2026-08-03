/**
 * Step 19 Part D/E: request/response DTOs for the flood-engine FastAPI service.
 *
 * Two shapes per concept, deliberately: a `*Wire` interface (exactly the
 * Python service's real JSON field names — snake_case, matching its
 * Pydantic schemas field-for-field, see flood-engine/src/flood_engine/api/schemas/
 * verbatim) and a public, camelCase DTO this backend's callers actually
 * use (matching every other DTO in this codebase, e.g. models/SimulationRun.ts).
 * Translation between the two is pure renaming — no numeric value is
 * ever recomputed, reinterpreted, or rounded (Part E's own requirement).
 *
 * `SimulationJobStatus`'s five values are copied, not re-derived, from
 * flood_engine.jobs.models.JobStatus (Step 16, frozen) -- this backend
 * treats the Python service as the source of truth for the job lifecycle
 * and never invents a sixth state (Part C's own requirement).
 */

export type SimulationJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Optional solver-parameter overrides. Field-for-field mirror of
 * flood_engine's `SolverParametersOverride` schema -- every field is
 * optional there too (omitted fields fall back to the frozen NMS
 * defaults on the Python side, never re-decided here).
 */
export interface SolverParametersOverride {
  readonly tolDelwlM?: number;
  readonly ignoreWdM?: number;
  readonly alpha?: number;
  readonly timeMindtS?: number;
  readonly timeMaxdtS?: number;
}

export interface TimesteppingParametersOverride {
  readonly infiltrationIntervalS?: number;
}

/**
 * The submission request this backend sends. Every field mirrors
 * `PostgresJobRepository.enqueue()`'s real, current parameters exactly
 * (Part D: "Do not modify the scientific request structure") -- the
 * five `*Path` fields reference already-prepared `.npy` arrays on
 * storage both services can reach; this backend does not upload raw
 * arrays inline (see flood-engine's own `api.routers.simulations`
 * module docstring for why: no `flood_scenario` object exists yet to
 * define an alternative).
 */
/** ``[west, south, east, north]`` in EPSG:4326 -- Step 20 map-display metadata only, never a scientific parameter. */
export type AoiBoundsWgs84 = readonly [west: number, south: number, east: number, north: number];

export interface SubmitSimulationRequest {
  readonly scenarioId: string;
  readonly elevationPath: string;
  readonly buildingMaskPath: string;
  readonly manningNPath: string;
  readonly infiltrationLossPath: string;
  readonly rainfallRatesPath: string;
  readonly solverParameters?: SolverParametersOverride;
  readonly timesteppingParameters?: TimesteppingParametersOverride;
  readonly aoiBoundsWgs84?: AoiBoundsWgs84;
}

export interface SubmitSimulationResult {
  readonly runId: string;
  readonly status: SimulationJobStatus;
}

export interface SimulationRunStatus {
  readonly runId: string;
  readonly scenarioId: string;
  readonly status: SimulationJobStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly errorMessage: string | null;
  readonly aoiBoundsWgs84: AoiBoundsWgs84 | null;
}

/** Field-for-field mirror of flood_engine's MassLedgerSchema -- no unit conversion, no rounding. */
export interface MassLedger {
  readonly rainfallInputM3: number;
  readonly infiltrationLossM3: number;
  readonly boundaryOutflowM3: number;
}

/**
 * Field-for-field mirror of flood_engine's FloodOutputSummarySchema.
 * `arrivalTimeMin` preserves `null` exactly where the Python side wrote
 * it (JSON's own representation of a not-yet-crossed-threshold cell,
 * originally NaN on the Python side) -- never coerced to a number, never
 * dropped.
 */
export interface FloodOutputSummary {
  readonly maxDepthM: readonly (readonly number[])[];
  readonly arrivalTimeMin: readonly (readonly (number | null)[])[];
  readonly durationAboveThresholdMin: readonly (readonly number[])[];
  readonly massLedger: MassLedger;
  readonly stepCount: number;
  readonly simulatedDurationS: number;
}

export type SimulationArtifact = 'max-depth' | 'arrival-time' | 'duration-above-threshold';

export const SIMULATION_ARTIFACTS: readonly SimulationArtifact[] = [
  'max-depth',
  'arrival-time',
  'duration-above-threshold',
];

/** Exactly the raw bytes flood-engine streamed back — never parsed, never modified. */
export interface DownloadedArtifact {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly filename: string | null;
}

// --- Wire shapes (Python's real JSON field names) — internal to this module ---

export interface SolverParametersOverrideWire {
  readonly tol_delwl_m?: number;
  readonly ignore_wd_m?: number;
  readonly alpha?: number;
  readonly time_mindt_s?: number;
  readonly time_maxdt_s?: number;
}

export interface TimesteppingParametersOverrideWire {
  readonly infiltration_interval_s?: number;
}

export interface SubmitSimulationRequestWire {
  readonly scenario_id: string;
  readonly elevation_path: string;
  readonly building_mask_path: string;
  readonly manning_n_path: string;
  readonly infiltration_loss_path: string;
  readonly rainfall_rates_path: string;
  readonly solver_parameters?: SolverParametersOverrideWire;
  readonly timestepping_parameters?: TimesteppingParametersOverrideWire;
  readonly aoi_bounds_wgs84?: AoiBoundsWgs84;
}

export interface SubmitSimulationResponseWire {
  readonly run_id: string;
  readonly status: SimulationJobStatus;
}

export interface SimulationRunStatusWire {
  readonly run_id: string;
  readonly scenario_id: string;
  readonly status: SimulationJobStatus;
  readonly created_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly cancelled_at: string | null;
  readonly error_message: string | null;
  readonly aoi_bounds_wgs84: AoiBoundsWgs84 | null;
}

export interface MassLedgerWire {
  readonly rainfall_input_m3: number;
  readonly infiltration_loss_m3: number;
  readonly boundary_outflow_m3: number;
}

export interface FloodOutputSummaryWire {
  readonly max_depth_m: readonly (readonly number[])[];
  readonly arrival_time_min: readonly (readonly (number | null)[])[];
  readonly duration_above_threshold_min: readonly (readonly number[])[];
  readonly mass_ledger: MassLedgerWire;
  readonly step_count: number;
  readonly simulated_duration_s: number;
}
