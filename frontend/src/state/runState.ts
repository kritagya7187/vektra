import { ApiError, getLatestBaselineRun, type SimulationRun } from '../api';
import { AsyncStatus, Store } from './store';
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
