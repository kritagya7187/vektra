import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelActiveFloodRun,
  floodRunStore,
  submitDemoFloodSimulation,
} from '../../../src/state/floodRunState';

const POLL_INTERVAL_MS = 2000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function statusBody(status: string, overrides: Record<string, unknown> = {}) {
  return {
    data: {
      runId: 'r1',
      scenarioId: 'vektra-demo',
      status,
      createdAt: '2026-01-01T00:00:00Z',
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      errorMessage: null,
      aoiBoundsWgs84: [72.8, 18.9, 72.9, 19.0],
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  floodRunStore.set({ status: 'idle', activeRun: null, summary: null, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('submitDemoFloodSimulation', () => {
  it('records the pending run immediately after a successful submit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { runId: 'r1', status: 'pending' } }))
      // the poll loop's own first status check, fired asynchronously
      .mockResolvedValue(jsonResponse(statusBody('pending')));
    vi.stubGlobal('fetch', fetchMock);

    await submitDemoFloodSimulation();

    expect(floodRunStore.get().activeRun?.runId).toBe('r1');
    expect(floodRunStore.get().activeRun?.status).toBe('pending');
  });

  it('sets status to error when submission itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await submitDemoFloodSimulation();

    expect(floodRunStore.get().status).toBe('error');
    expect(floodRunStore.get().error).not.toBeNull();
    expect(floodRunStore.get().activeRun).toBeNull();
  });

  it('polls until completed, then fetches and stores the real summary', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { runId: 'r1', status: 'pending' } }))
      .mockResolvedValueOnce(jsonResponse(statusBody('running')))
      .mockResolvedValueOnce(jsonResponse(statusBody('completed')))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            maxDepthM: [[1]],
            arrivalTimeMin: [[null]],
            durationAboveThresholdMin: [[0]],
            massLedger: { rainfallInputM3: 1, infiltrationLossM3: 0, boundaryOutflowM3: 0 },
            stepCount: 3,
            simulatedDurationS: 60,
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await submitDemoFloodSimulation();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // running -> completed poll
    await vi.advanceTimersByTimeAsync(0); // let the summary fetch's promise chain settle

    expect(floodRunStore.get().activeRun?.status).toBe('completed');
    expect(floodRunStore.get().summary?.stepCount).toBe(3);
    expect(floodRunStore.get().status).toBe('loaded');
  });

  it('stops polling (without a summary fetch) when the run fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { runId: 'r1', status: 'pending' } }))
      .mockResolvedValueOnce(
        jsonResponse(statusBody('failed', { errorMessage: 'WCA2DError: bad input' })),
      );
    vi.stubGlobal('fetch', fetchMock);

    await submitDemoFloodSimulation();
    await vi.advanceTimersByTimeAsync(0);

    expect(floodRunStore.get().activeRun?.status).toBe('failed');
    expect(floodRunStore.get().activeRun?.errorMessage).toBe('WCA2DError: bad input');
    expect(floodRunStore.get().summary).toBeNull();
    // No further polls scheduled once terminal.
    const callCountAtTerminal = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(fetchMock.mock.calls.length).toBe(callCountAtTerminal);
  });

  it('a second submission supersedes polling for the first (no stale overwrite)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { runId: 'r1', status: 'pending' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { runId: 'r2', status: 'pending' } }))
      // any further status polls just report r2 as still pending
      .mockResolvedValue(jsonResponse(statusBody('pending', { runId: 'r2' })));
    vi.stubGlobal('fetch', fetchMock);

    await submitDemoFloodSimulation();
    await submitDemoFloodSimulation();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(floodRunStore.get().activeRun?.runId).toBe('r2');
  });
});

describe('cancelActiveFloodRun', () => {
  it('cancels the active run and updates its status', async () => {
    floodRunStore.set({
      status: 'loaded',
      activeRun: {
        runId: 'r1',
        scenarioId: 'demo',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00Z',
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        errorMessage: null,
        aoiBoundsWgs84: null,
      },
      summary: null,
      error: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(statusBody('cancelled'))));

    await cancelActiveFloodRun();

    expect(floodRunStore.get().activeRun?.status).toBe('cancelled');
  });

  it('does nothing when there is no active run', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await cancelActiveFloodRun();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
