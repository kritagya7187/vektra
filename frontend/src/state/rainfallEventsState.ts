import {
  ApiError,
  listRainfallEvents,
  prepareRainfallEvent,
  type RainfallDay,
  type RainfallProvenance,
} from '../api';
import { submitDemoFloodSimulation } from './floodRunState';
import { AsyncStatus, Store } from './store';

export interface RainfallEventsState {
  readonly status: AsyncStatus;
  readonly station: { readonly lon: number; readonly lat: number } | null;
  readonly provenance: RainfallProvenance | null;
  readonly days: readonly RainfallDay[];
  readonly selectedDate: string | null;
  readonly preparing: boolean;
  readonly error: ApiError | null;
}

const initialState: RainfallEventsState = {
  status: 'idle',
  station: null,
  provenance: null,
  days: [],
  selectedDate: null,
  preparing: false,
  error: null,
};

export const rainfallEventsStore = new Store<RainfallEventsState>(initialState);

function toApiError(err: unknown, fallbackMessage: string): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError({ code: 'UNKNOWN_ERROR', message: fallbackMessage, status: null, cause: err });
}

export async function loadRainfallEvents(): Promise<void> {
  if (rainfallEventsStore.get().status === 'loading') {
    return;
  }
  rainfallEventsStore.set((previous) => ({ ...previous, status: 'loading', error: null }));
  try {
    const result = await listRainfallEvents();
    rainfallEventsStore.set((previous) => ({
      ...previous,
      status: 'loaded',
      station: result.station,
      provenance: result.provenance,
      days: result.days,
    }));
  } catch (err) {
    rainfallEventsStore.set((previous) => ({
      ...previous,
      status: 'error',
      error: toApiError(err, 'Failed to load rainfall events.'),
    }));
  }
}

export function selectRainfallDate(date: string | null): void {
  rainfallEventsStore.set((previous) => ({ ...previous, selectedDate: date }));
}

export async function runSelectedRainfallEvent(): Promise<void> {
  const { selectedDate } = rainfallEventsStore.get();
  if (!selectedDate) {
    return;
  }
  rainfallEventsStore.set((previous) => ({ ...previous, preparing: true, error: null }));
  try {
    const prepared = await prepareRainfallEvent(selectedDate);
    rainfallEventsStore.set((previous) => ({ ...previous, preparing: false }));
    await submitDemoFloodSimulation({ rainfallRatesPath: prepared.rainfallRatesPath });
  } catch (err) {
    rainfallEventsStore.set((previous) => ({
      ...previous,
      preparing: false,
      error: toApiError(err, 'Failed to run the simulation for the selected rainfall event.'),
    }));
  }
}
