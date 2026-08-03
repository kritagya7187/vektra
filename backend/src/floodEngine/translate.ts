/**
 * Step 19 Part D/E: pure translation functions between this backend's
 * camelCase DTOs and flood-engine's real snake_case wire shapes.
 *
 * Every function here is a rename-only transformation -- no numeric
 * value is ever computed, rounded, or reinterpreted (Part E: "Preserve
 * ... No recomputation"; Part D: "Do not alter simulation parameters").
 * Optional fields are copied through with `undefined` collapsed to
 * "field omitted" (matching Pydantic's own `Optional[...] = None`
 * semantics on the receiving end) -- never defaulted to a concrete
 * value here, since only flood-engine's own frozen `SolverParameters`/
 * `TimesteppingParameters` classes own those defaults.
 */

import type {
  FloodOutputSummary,
  FloodOutputSummaryWire,
  SimulationRunStatus,
  SimulationRunStatusWire,
  SolverParametersOverride,
  SolverParametersOverrideWire,
  SubmitSimulationRequest,
  SubmitSimulationRequestWire,
  SubmitSimulationResult,
  SubmitSimulationResponseWire,
  TimesteppingParametersOverride,
  TimesteppingParametersOverrideWire,
} from './types';

function toSolverParametersWire(
  overrides: SolverParametersOverride | undefined,
): SolverParametersOverrideWire | undefined {
  if (!overrides) {
    return undefined;
  }
  return {
    tol_delwl_m: overrides.tolDelwlM,
    ignore_wd_m: overrides.ignoreWdM,
    alpha: overrides.alpha,
    time_mindt_s: overrides.timeMindtS,
    time_maxdt_s: overrides.timeMaxdtS,
  };
}

function toTimesteppingParametersWire(
  overrides: TimesteppingParametersOverride | undefined,
): TimesteppingParametersOverrideWire | undefined {
  if (!overrides) {
    return undefined;
  }
  return { infiltration_interval_s: overrides.infiltrationIntervalS };
}

/** Part D: this backend's request DTO -> the exact JSON body flood-engine's POST /api/v1/simulations expects. */
export function toSubmitSimulationRequestWire(
  request: SubmitSimulationRequest,
): SubmitSimulationRequestWire {
  return {
    scenario_id: request.scenarioId,
    elevation_path: request.elevationPath,
    building_mask_path: request.buildingMaskPath,
    manning_n_path: request.manningNPath,
    infiltration_loss_path: request.infiltrationLossPath,
    rainfall_rates_path: request.rainfallRatesPath,
    solver_parameters: toSolverParametersWire(request.solverParameters),
    timestepping_parameters: toTimesteppingParametersWire(request.timesteppingParameters),
    aoi_bounds_wgs84: request.aoiBoundsWgs84,
  };
}

/** Part E: flood-engine's real submission response -> this backend's DTO. */
export function fromSubmitSimulationResponseWire(
  wire: SubmitSimulationResponseWire,
): SubmitSimulationResult {
  return { runId: wire.run_id, status: wire.status };
}

/** Part E: flood-engine's real status response -> this backend's DTO. Timestamps pass through verbatim (ISO 8601 strings both sides). */
export function fromSimulationRunStatusWire(wire: SimulationRunStatusWire): SimulationRunStatus {
  return {
    runId: wire.run_id,
    scenarioId: wire.scenario_id,
    status: wire.status,
    createdAt: wire.created_at,
    startedAt: wire.started_at,
    completedAt: wire.completed_at,
    cancelledAt: wire.cancelled_at,
    errorMessage: wire.error_message,
    aoiBoundsWgs84: wire.aoi_bounds_wgs84,
  };
}

/**
 * Part E: flood-engine's real output summary -> this backend's DTO.
 *
 * `max_depth_m`/`arrival_time_min`/`duration_above_threshold_min` are
 * copied by reference/structure only (the arrays JSON.parse already
 * built) -- iterating to "convert" them would risk introducing a
 * transcription bug for zero benefit, since JSON numbers and `null`
 * already match this DTO's own field types exactly.
 */
export function fromFloodOutputSummaryWire(wire: FloodOutputSummaryWire): FloodOutputSummary {
  return {
    maxDepthM: wire.max_depth_m,
    arrivalTimeMin: wire.arrival_time_min,
    durationAboveThresholdMin: wire.duration_above_threshold_min,
    massLedger: {
      rainfallInputM3: wire.mass_ledger.rainfall_input_m3,
      infiltrationLossM3: wire.mass_ledger.infiltration_loss_m3,
      boundaryOutflowM3: wire.mass_ledger.boundary_outflow_m3,
    },
    stepCount: wire.step_count,
    simulatedDurationS: wire.simulated_duration_s,
  };
}
