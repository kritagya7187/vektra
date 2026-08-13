import {
  ApiError,
  cancelFloodSimulation,
  getFloodSimulationStatus,
  getFloodSimulationSummary,
  submitFloodSimulation,
  type FloodOutputSummary,
  type FloodSimulationRunStatus,
  type SolverParametersOverride,
  type TimesteppingParametersOverride,
} from '../api';
import { DEMO_FLOOD_SIMULATION_REQUEST } from '../domain/demoScenario';
import { AsyncStatus, Store } from './store';
export interface FloodRunState {
  readonly status: AsyncStatus;
  readonly activeRun: FloodSimulationRunStatus | null;
  readonly summary: FloodOutputSummary | null;
  readonly error: ApiError | null;
}
const initialState: FloodRunState = {
  status: 'idle',
  activeRun: null,
  summary: null,
  error: null,
};
export const floodRunStore = new Store<FloodRunState>(initialState);
const POLL_INTERVAL_MS = 2000;
let currentPollRunId: string | null = null;
function toApiError(err: unknown, fallbackMessage: string): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError({ code: 'UNKNOWN_ERROR', message: fallbackMessage, status: null, cause: err });
}
function isTerminal(status: FloodSimulationRunStatus['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
async function pollOnce(runId: string): Promise<void> {
  if (currentPollRunId !== runId) {
    return;
  }
  try {
    const run = await getFloodSimulationStatus(runId);
    if (currentPollRunId !== runId) {
      return;
    }
    floodRunStore.set((previous) => ({ ...previous, activeRun: run }));
    if (!isTerminal(run.status)) {
      setTimeout(() => void pollOnce(runId), POLL_INTERVAL_MS);
      return;
    }
    if (run.status !== 'completed') {
      floodRunStore.set((previous) => ({ ...previous, status: 'loaded' }));
      return;
    }
    const summary = await getFloodSimulationSummary(runId);
    if (currentPollRunId !== runId) {
      return;
    }
    floodRunStore.set((previous) => ({ ...previous, status: 'loaded', summary }));
  } catch (err) {
    if (currentPollRunId !== runId) {
      return;
    }
    floodRunStore.set((previous) => ({
      ...previous,
      status: 'error',
      error: toApiError(err, 'Failed to poll the flood simulation run.'),
    }));
  }
}
export async function submitDemoFloodSimulation(overrides?: {
  readonly solverParameters?: SolverParametersOverride;
  readonly timesteppingParameters?: TimesteppingParametersOverride;
  readonly rainfallRatesPath?: string;
}): Promise<void> {
  floodRunStore.set({ status: 'loading', activeRun: null, summary: null, error: null });
  try {
    const result = await submitFloodSimulation({
      ...DEMO_FLOOD_SIMULATION_REQUEST,
      rainfallRatesPath: overrides?.rainfallRatesPath ?? DEMO_FLOOD_SIMULATION_REQUEST.rainfallRatesPath,
      solverParameters: overrides?.solverParameters,
      timesteppingParameters: overrides?.timesteppingParameters,
    });
    currentPollRunId = result.runId;
    floodRunStore.set((previous) => ({
      ...previous,
      activeRun: {
        runId: result.runId,
        scenarioId: DEMO_FLOOD_SIMULATION_REQUEST.scenarioId,
        status: result.status,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        errorMessage: null,
        aoiBoundsWgs84: DEMO_FLOOD_SIMULATION_REQUEST.aoiBoundsWgs84 ?? null,
      },
    }));
    void pollOnce(result.runId);
  } catch (err) {
    floodRunStore.set((previous) => ({
      ...previous,
      status: 'error',
      error: toApiError(err, 'Failed to submit the demo flood simulation.'),
    }));
  }
}
export async function cancelActiveFloodRun(): Promise<void> {
  const runId = floodRunStore.get().activeRun?.runId;
  if (!runId) {
    return;
  }
  try {
    const run = await cancelFloodSimulation(runId);
    floodRunStore.set((previous) => ({ ...previous, activeRun: run, status: 'loaded' }));
  } catch (err) {
    floodRunStore.set((previous) => ({
      ...previous,
      error: toApiError(err, 'Failed to cancel the flood simulation run.'),
    }));
  }
}
