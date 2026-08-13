import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { floodRunStore } from '../../../src/state/floodRunState';
import {
  loadRainfallEvents,
  rainfallEventsStore,
  runSelectedRainfallEvent,
  selectRainfallDate,
} from '../../../src/state/rainfallEventsState';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  rainfallEventsStore.set({
    status: 'idle',
    station: null,
    provenance: null,
    days: [],
    selectedDate: null,
    preparing: false,
    error: null,
  });
  floodRunStore.set({ status: 'idle', activeRun: null, summary: null, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadRainfallEvents', () => {
  it('stores the real days, station, and provenance returned by the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            station: { lon: 72.8325, lat: 18.9275 },
            provenance: {
              sourceProductIdentifier: 'era5-land',
              license: 'CC-BY',
              retrievedAt: '2026-01-01T00:00:00Z',
              sourceDisplayName: 'ERA5-Land',
            },
            days: [{ date: '2020-07-14', totalMm: 12.4, maxHourlyMm: 3.1 }],
          },
        }),
      ),
    );
    await loadRainfallEvents();
    const state = rainfallEventsStore.get();
    expect(state.status).toBe('loaded');
    expect(state.days).toEqual([{ date: '2020-07-14', totalMm: 12.4, maxHourlyMm: 3.1 }]);
    expect(state.station).toEqual({ lon: 72.8325, lat: 18.9275 });
    expect(state.provenance?.sourceDisplayName).toBe('ERA5-Land');
  });

  it('sets status to error when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await loadRainfallEvents();
    expect(rainfallEventsStore.get().status).toBe('error');
    expect(rainfallEventsStore.get().error).not.toBeNull();
  });
});

describe('selectRainfallDate', () => {
  it('sets the selected date', () => {
    selectRainfallDate('2020-07-14');
    expect(rainfallEventsStore.get().selectedDate).toBe('2020-07-14');
  });
});

describe('runSelectedRainfallEvent', () => {
  it('does nothing when no date is selected', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await runSelectedRainfallEvent();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prepares the real forcing array then submits it as the simulation rainfall input', async () => {
    selectRainfallDate('2020-07-14');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            rainfallRatesPath: 'run-output/rainfall-events/2020-07-14.npy',
            hours: 24,
            totalMm: 12.4,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { runId: 'r1', status: 'pending' } }))
      .mockResolvedValue(jsonResponse({ data: { runId: 'r1', status: 'pending' } }));
    vi.stubGlobal('fetch', fetchMock);
    await runSelectedRainfallEvent();
    expect(rainfallEventsStore.get().preparing).toBe(false);
    expect(floodRunStore.get().activeRun?.runId).toBe('r1');
    const submitCall = fetchMock.mock.calls[1];
    const submittedBody = JSON.parse((submitCall[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(submittedBody.rainfallRatesPath).toBe('run-output/rainfall-events/2020-07-14.npy');
  });

  it('records an error when preparing the real forcing array fails', async () => {
    selectRainfallDate('2020-07-14');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await runSelectedRainfallEvent();
    expect(rainfallEventsStore.get().preparing).toBe(false);
    expect(rainfallEventsStore.get().error).not.toBeNull();
  });
});
