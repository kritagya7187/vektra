import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelFloodSimulation,
  floodSimulationDownloadUrl,
  getFloodSimulationStatus,
  getFloodSimulationSummary,
  submitFloodSimulation,
} from '../../../src/api/floodSimulations';
import type { SubmitFloodSimulationRequest } from '../../../src/api/types';

/**
 * floodSimulations.ts is a thin wrapper over the already-thoroughly-tested
 * getJson/postJson/exportUrl (client.test.ts) — these tests check only
 * what's specific to this module: the right path, method, and body are
 * sent, and the {data} envelope is unwrapped, not the full envelope/error
 * taxonomy (already covered elsewhere).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const REQUEST: SubmitFloodSimulationRequest = {
  scenarioId: 'demo',
  elevationPath: '/data/elevation.npy',
  buildingMaskPath: '/data/building_mask.npy',
  manningNPath: '/data/manning_n.npy',
  infiltrationLossPath: '/data/infiltration.npy',
  rainfallRatesPath: '/data/rainfall.npy',
};

describe('submitFloodSimulation', () => {
  it('POSTs to /api/flood-simulations with the request as JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { runId: 'r1', status: 'pending' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitFloodSimulation(REQUEST);

    expect(result).toEqual({ runId: 'r1', status: 'pending' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/flood-simulations');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(REQUEST));
  });
});

describe('getFloodSimulationStatus', () => {
  it('GETs /api/flood-simulations/:runId and unwraps the envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          runId: 'r1',
          scenarioId: 'demo',
          status: 'running',
          createdAt: '2026-01-01T00:00:00Z',
          startedAt: '2026-01-01T00:00:01Z',
          completedAt: null,
          cancelledAt: null,
          errorMessage: null,
          aoiBoundsWgs84: null,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getFloodSimulationStatus('r1');

    expect(result.status).toBe('running');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/api/flood-simulations/r1');
  });
});

describe('getFloodSimulationSummary', () => {
  it('GETs /api/flood-simulations/:runId/summary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          maxDepthM: [[1]],
          arrivalTimeMin: [[null]],
          durationAboveThresholdMin: [[0]],
          massLedger: { rainfallInputM3: 1, infiltrationLossM3: 0, boundaryOutflowM3: 0 },
          stepCount: 5,
          simulatedDurationS: 100,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getFloodSimulationSummary('r1');

    expect(result.stepCount).toBe(5);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/api/flood-simulations/r1/summary');
  });
});

describe('floodSimulationDownloadUrl', () => {
  it('builds a direct URL (not fetched) for the requested artifact', () => {
    const url = floodSimulationDownloadUrl('r1', 'max-depth');
    expect(url).toContain('/api/flood-simulations/r1/download/max-depth');
  });
});

describe('cancelFloodSimulation', () => {
  it('POSTs to /api/flood-simulations/:runId/cancel', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          runId: 'r1',
          scenarioId: 'demo',
          status: 'cancelled',
          createdAt: '2026-01-01T00:00:00Z',
          startedAt: null,
          completedAt: null,
          cancelledAt: '2026-01-01T00:00:02Z',
          errorMessage: null,
          aoiBoundsWgs84: null,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await cancelFloodSimulation('r1');

    expect(result.status).toBe('cancelled');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/flood-simulations/r1/cancel');
    expect(init.method).toBe('POST');
  });
});
