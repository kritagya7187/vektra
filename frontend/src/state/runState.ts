import { ApiError, getLatestBaselineRun, type SimulationRun } from '../api';
import { AsyncStatus, Store } from './store';

/**
 * Run state (design review §8): which SimulationRun is currently driving
 * the Twin View. Only the active baseline run is tracked here — the
 * design review's default workflow (§5A) always starts from
 * GET /simulation-runs/latest-baseline; there is no run-switcher UI
 * beyond that in the approved screen inventory.
 */
export interface RunState {
  readonly status: AsyncStatus;
  readonly activeRun: SimulationRun | null;
  readonly error: ApiError | null;
}

const initialState: RunState = {
  status: 'idle',
  activeRun: null,
  error: null,
};

export const runStore = new Store<RunState>(initialState);

/**
 * Loads the latest completed baseline run. A null result (no completed
 * baseline exists yet) is a real, non-error state (§5A) — the caller
 * (buildingState's loadTwin) is responsible for rendering the honest
 * empty scene, not this action.
 */
export async function loadLatestBaselineRun(): Promise<SimulationRun | null> {
  runStore.set((previous) => ({ ...previous, status: 'loading', error: null }));
  try {
    const run = await getLatestBaselineRun();
    runStore.set({ status: 'loaded', activeRun: run, error: null });
    return run;
  } catch (err) {
    const apiError =
      err instanceof ApiError
        ? err
        : new ApiError({
            code: 'UNKNOWN_ERROR',
            message: 'Failed to load the active run.',
            status: null,
          });
    runStore.set({ status: 'error', activeRun: null, error: apiError });
    throw apiError;
  }
}
