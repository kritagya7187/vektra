import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../helpers/testApp';
import {
  type RunningFloodEngineServer,
  startFloodEngineServer,
  stageFloodEngineArrays,
} from '../helpers/floodEngineServer';

/**
 * Step 20 Part 0b: end-to-end tests for the new /api/flood-simulations
 * proxy routes -- real Express app (testApp(), the same in-process
 * supertest wrapper every other tests/api/*.test.ts file uses) talking
 * to a real flood-engine FastAPI service + worker (Step 19's
 * tests/helpers/floodEngineServer.ts, unchanged), against the same
 * disposable test database every flood-engine test already uses. Skips
 * (not fails) when that database is unreachable, same convention as
 * tests/integration/floodEngine.test.ts.
 */

let server: RunningFloodEngineServer | null;
let arraysDir: string;

beforeAll(async () => {
  server = await startFloodEngineServer();
  if (!server) {
    return;
  }
  arraysDir = mkdtempSync(path.join(os.tmpdir(), 'flood-simulations-api-test-'));
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

function newSubmitBody(scenarioId: string) {
  const paths = stageFloodEngineArrays(path.join(arraysDir, scenarioId));
  return {
    scenarioId,
    elevationPath: paths.elevationPath,
    buildingMaskPath: paths.buildingMaskPath,
    manningNPath: paths.manningNPath,
    infiltrationLossPath: paths.infiltrationLossPath,
    rainfallRatesPath: paths.rainfallRatesPath,
  };
}

async function pollUntilTerminal(
  runId: string,
  timeoutMs = 20_000,
): Promise<{ readonly status: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await testApp().get(`/api/flood-simulations/${runId}`);
    const data = res.body.data as { readonly status: string };
    if (data.status === 'completed' || data.status === 'failed') {
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Run ${runId} did not reach a terminal state within ${timeoutMs}ms`);
}

describe('POST /api/flood-simulations', () => {
  it('submits a job and returns 202 with a pending run id', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const res = await testApp().post('/api/flood-simulations').send(newSubmitBody('api-submit-1'));

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.runId).toBeTruthy();
  });

  it('accepts an aoiBoundsWgs84 and echoes it back via status', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const body = { ...newSubmitBody('api-submit-aoi'), aoiBoundsWgs84: [72.8, 18.9, 72.9, 19.0] };

    const submitRes = await testApp().post('/api/flood-simulations').send(body);
    expect(submitRes.status).toBe(202);
    const runId = submitRes.body.data.runId;

    const statusRes = await testApp().get(`/api/flood-simulations/${runId}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.aoiBoundsWgs84).toEqual([72.8, 18.9, 72.9, 19.0]);
  });

  it('rejects a request missing required fields with a 400 validation error', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const res = await testApp().post('/api/flood-simulations').send({ scenarioId: 'incomplete' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/flood-simulations/:runId', () => {
  it('returns 404 with the standard error envelope for an unknown run', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const res = await testApp().get('/api/flood-simulations/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it('rejects a non-UUID runId with a 400 validation error', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const res = await testApp().get('/api/flood-simulations/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/flood-simulations/:runId/summary', () => {
  it('returns 409 for a run that failed instead of completing', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    // Deterministic, not a pending/timing race: the same real
    // WCA2DError-triggering broken-manning-shape scenario
    // tests/integration/floodEngine.test.ts's own "a failed job" test
    // uses -- guarantees the run reaches a real 'failed' terminal state,
    // exercising the exact same "not completed -> 409" Node-proxy code
    // path without depending on beating the worker's claim loop.
    const paths = stageFloodEngineArrays(path.join(arraysDir, 'api-summary-failed'), {
      brokenManningShape: true,
    });
    const submitRes = await testApp().post('/api/flood-simulations').send({
      scenarioId: 'api-summary-failed',
      elevationPath: paths.elevationPath,
      buildingMaskPath: paths.buildingMaskPath,
      manningNPath: paths.manningNPath,
      infiltrationLossPath: paths.infiltrationLossPath,
      rainfallRatesPath: paths.rainfallRatesPath,
    });
    const runId = submitRes.body.data.runId;
    const finalStatus = await pollUntilTerminal(runId);
    expect(finalStatus.status).toBe('failed');

    const res = await testApp().get(`/api/flood-simulations/${runId}/summary`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns the real completed summary with no recomputation', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const submitRes = await testApp()
      .post('/api/flood-simulations')
      .send(newSubmitBody('api-summary-complete'));
    const runId = submitRes.body.data.runId;
    const finalStatus = await pollUntilTerminal(runId);
    expect(finalStatus.status).toBe('completed');

    const res = await testApp().get(`/api/flood-simulations/${runId}/summary`);

    expect(res.status).toBe(200);
    expect(res.body.data.stepCount).toBeGreaterThan(0);
    expect(res.body.data.massLedger.rainfallInputM3).toBeGreaterThan(0);
  });
});

describe('GET /api/flood-simulations/:runId/download/:artifact', () => {
  it('streams the real raw npy bytes for a completed run', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const submitRes = await testApp()
      .post('/api/flood-simulations')
      .send(newSubmitBody('api-download'));
    const runId = submitRes.body.data.runId;
    await pollUntilTerminal(runId);

    const res = await testApp().get(`/api/flood-simulations/${runId}/download/max-depth`);

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body) || res.body instanceof Uint8Array).toBe(true);
    expect(res.headers['content-disposition']).toContain('.npy');
  });

  it('rejects an unknown artifact name with a 400 validation error', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const submitRes = await testApp()
      .post('/api/flood-simulations')
      .send(newSubmitBody('api-download-invalid'));
    const runId = submitRes.body.data.runId;

    const res = await testApp().get(`/api/flood-simulations/${runId}/download/not-a-real-artifact`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/flood-simulations/:runId/cancel', () => {
  it('cancels a pending run', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const submitRes = await testApp()
      .post('/api/flood-simulations')
      .send(newSubmitBody('api-cancel'));
    const runId = submitRes.body.data.runId;

    const res = await testApp().post(`/api/flood-simulations/${runId}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });
});
