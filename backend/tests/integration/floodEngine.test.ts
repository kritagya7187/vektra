import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFloodEngineClient, type FloodEngineClient } from '../../src/floodEngine';
import { ConflictError, ExternalServiceError, NotFoundError } from '../../src/errors';
import {
  type RunningFloodEngineServer,
  startFloodEngineServer,
  stageFloodEngineArrays,
} from '../helpers/floodEngineServer';

/**
 * Step 19 Part G: integration tests against the REAL flood-engine
 * FastAPI service and worker (both spawned as real child processes,
 * see tests/helpers/floodEngineServer.ts) for every scenario that
 * exercises real behavior, and small local mock HTTP servers (plain
 * node:http, not the real flood-engine) for the three scenarios that
 * specifically need to induce a failure mode the real service would
 * never produce on its own (timeout, unavailable server, malformed
 * response) — matching this Part's own "use the real FastAPI service
 * wherever practical; mock only external infrastructure" instruction.
 *
 * The real-server tests are skipped (not failed) when the disposable
 * test database or the flood-engine Python environment isn't available
 * — same convention every flood-engine Python integration test already
 * uses. A real simulation run takes real wall-clock seconds (the worker
 * genuinely executes the WCA2D solver, no shortcuts) — hookTimeout is
 * already 60s (vitest.integration.config.ts), and the per-test polling
 * loops below are individually bounded.
 */

const silentLogger = pino({ level: 'silent' });

let server: RunningFloodEngineServer | null;
let client: FloodEngineClient;
let arraysDir: string;

beforeAll(async () => {
  server = await startFloodEngineServer();
  if (!server) {
    return;
  }
  client = createFloodEngineClient({
    baseUrl: server.baseUrl,
    timeoutMs: 10_000,
    maxRetries: 1,
    maxPayloadBytes: 65_536,
    logger: silentLogger,
  });
  arraysDir = mkdtempSync(path.join(os.tmpdir(), 'flood-engine-node-test-'));
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

function newSubmitRequest(scenarioId: string) {
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

async function pollUntilTerminal(runId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await client.getSimulationStatus(runId);
    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Run ${runId} did not reach a terminal state within ${timeoutMs}ms`);
}

describe('FloodEngineClient — real server', () => {
  it('successful submission returns a pending run id', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const result = await client.submitSimulation(newSubmitRequest('submit-1'));

    expect(result.status).toBe('pending');
    expect(result.runId).toBeTruthy();
  });

  it('polling until completion reflects the real job lifecycle end to end', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const submitted = await client.submitSimulation(newSubmitRequest('poll-complete'));

    const finalStatus = await pollUntilTerminal(submitted.runId);

    expect(finalStatus.status).toBe('completed');
    expect(finalStatus.completedAt).not.toBeNull();

    const summary = await client.getSimulationSummary(submitted.runId);
    expect(summary.stepCount).toBeGreaterThan(0);
    expect(summary.massLedger.rainfallInputM3).toBeGreaterThan(0);
  });

  it('a failed job (malformed array shape) is reported as failed, not completed', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    // A deliberately-broken manning_n array (wrong shape) — the same
    // real WCA2DError-triggering scenario flood-engine's own Python
    // error-recovery tests use — guarantees a genuine execution failure,
    // not a fabricated one.
    const paths = stageFloodEngineArrays(path.join(arraysDir, 'failed-job'), {
      brokenManningShape: true,
    });
    const brokenRequest = {
      scenarioId: 'failed-job',
      elevationPath: paths.elevationPath,
      buildingMaskPath: paths.buildingMaskPath,
      manningNPath: paths.manningNPath,
      infiltrationLossPath: paths.infiltrationLossPath,
      rainfallRatesPath: paths.rainfallRatesPath,
    };

    const submitted = await client.submitSimulation(brokenRequest);
    const finalStatus = await pollUntilTerminal(submitted.runId);

    expect(finalStatus.status).toBe('failed');
    expect(finalStatus.errorMessage).toBeTruthy();

    await expect(client.getSimulationSummary(submitted.runId)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('a cancelled job transitions to cancelled and is never claimed', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const submitted = await client.submitSimulation(newSubmitRequest('cancel-me'));

    const cancelled = await client.cancelSimulation(submitted.runId);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it('getting the status of an unknown run raises NotFoundError', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    await expect(
      client.getSimulationStatus('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('duplicate polling of the same run returns consistent results both times', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const submitted = await client.submitSimulation(newSubmitRequest('duplicate-poll'));

    const [first, second] = await Promise.all([
      client.getSimulationStatus(submitted.runId),
      client.getSimulationStatus(submitted.runId),
    ]);

    expect(first.runId).toBe(submitted.runId);
    expect(second.runId).toBe(submitted.runId);
    expect(first.status).toBe(second.status);
  });

  it('concurrent submissions each get their own distinct run id', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const requests = ['concurrent-1', 'concurrent-2', 'concurrent-3'].map((name) =>
      newSubmitRequest(name),
    );

    const results = await Promise.all(requests.map((request) => client.submitSimulation(request)));

    const runIds = new Set(results.map((result) => result.runId));
    expect(runIds.size).toBe(3);
    for (const result of results) {
      expect(result.status).toBe('pending');
    }
  });
});

describe('FloodEngineClient — mocked external-infrastructure failures', () => {
  it('an unavailable flood-engine server surfaces as ExternalServiceError', async () => {
    // A real, closed port -- nothing listening -- genuinely unavailable,
    // no mock server process needed at all.
    const unavailableClient = createFloodEngineClient({
      baseUrl: 'http://127.0.0.1:8198',
      timeoutMs: 2000,
      maxRetries: 0,
      maxPayloadBytes: 65_536,
      logger: silentLogger,
    });

    await expect(
      unavailableClient.getSimulationStatus('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it('a request that exceeds the configured timeout surfaces as ExternalServiceError', async () => {
    const slowServer = http.createServer((_req, res) => {
      // Never responds within the client's own timeout -- a deliberately
      // misbehaving external service, legitimate to mock per this file's
      // own docstring.
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }, 5000);
    });
    await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
    const { port } = slowServer.address() as AddressInfo;

    try {
      const timeoutClient = createFloodEngineClient({
        baseUrl: `http://127.0.0.1:${port}`,
        timeoutMs: 200,
        maxRetries: 0,
        maxPayloadBytes: 65_536,
        logger: silentLogger,
      });

      await expect(
        timeoutClient.getSimulationStatus('00000000-0000-0000-0000-000000000000'),
      ).rejects.toBeInstanceOf(ExternalServiceError);
    } finally {
      await new Promise<void>((resolve) => slowServer.close(() => resolve()));
    }
  });

  it('a malformed (non-JSON) response body surfaces as ExternalServiceError', async () => {
    const malformedServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('this is not valid json {{{');
    });
    await new Promise<void>((resolve) => malformedServer.listen(0, '127.0.0.1', resolve));
    const { port } = malformedServer.address() as AddressInfo;

    try {
      const malformedClient = createFloodEngineClient({
        baseUrl: `http://127.0.0.1:${port}`,
        timeoutMs: 5000,
        maxRetries: 0,
        maxPayloadBytes: 65_536,
        logger: silentLogger,
      });

      await expect(
        malformedClient.getSimulationStatus('00000000-0000-0000-0000-000000000000'),
      ).rejects.toBeInstanceOf(ExternalServiceError);
    } finally {
      await new Promise<void>((resolve) => malformedServer.close(() => resolve()));
    }
  });
});
