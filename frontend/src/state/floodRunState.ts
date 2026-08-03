import {
  ApiError,
  cancelFloodSimulation,
  getFloodSimulationStatus,
  getFloodSimulationSummary,
  submitFloodSimulation,
  type FloodOutputSummary,
  type FloodSimulationRunStatus,
} from '../api';
import { DEMO_FLOOD_SIMULATION_REQUEST } from '../domain/demoScenario';
import { AsyncStatus, Store } from './store';

/**
 * Step 20 §5/§9: the flood-engine job lifecycle — a distinct store from
 * state/runState.ts (the older, unrelated heat-exposure engine). Treats
 * the Python engine as the sole source of truth for job status (Step 19's
 * own rule, carried forward): this store never invents a state beyond
 * the five FloodSimulationStatus values a real API response reports.
 *
 * Polling, not a push mechanism — matches the "no polling redesign,
 * reuse Step 19 APIs exactly" instruction; this is the same polling
 * pattern the backend's own integration tests already use, just with a
 * UI-appropriate interval instead of a test's tight loop.
 */
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

/** Guards a stale poll loop (from a superseded run) from overwriting state after a newer submission. */
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
    return; // superseded by a newer submission — stop silently
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

/** §5 Job Integration's "Submit" trigger — a labeled demo action (AskUserQuestion, this step), not a real scenario picker. See domain/demoScenario.ts. */
export async function submitDemoFloodSimulation(): Promise<void> {
  floodRunStore.set({ status: 'loading', activeRun: null, summary: null, error: null });
  try {
    const result = await submitFloodSimulation(DEMO_FLOOD_SIMULATION_REQUEST);
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
    // Always applied, unlike the poll loop's own staleness guard: this
    // acts on whatever runId is currently displayed in activeRun, which
    // is by definition "the current one" regardless of whether a poll
    // loop happens to be tracking it too.
    floodRunStore.set((previous) => ({ ...previous, activeRun: run, status: 'loaded' }));
  } catch (err) {
    floodRunStore.set((previous) => ({
      ...previous,
      error: toApiError(err, 'Failed to cancel the flood simulation run.'),
    }));
  }
}
