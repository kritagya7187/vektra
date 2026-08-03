import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFloodEngineClient, type FloodEngineClient } from '../../src/floodEngine';
import {
  type RunningFloodEngineServer,
  startFloodEngineServer,
  stageFloodEngineArrays,
} from '../helpers/floodEngineServer';

/**
 * Step 19 Part H: latency measurement against the real flood-engine
 * FastAPI service and worker (same real infrastructure as Part G's
 * tests/integration/floodEngine.test.ts). Per the spec, "no optimization
 * is required, only measurement" -- assertions below only guard against
 * outright hangs/failures, not specific latency budgets. The actual
 * numbers are logged to stdout and transcribed into
 * backend/FLOOD_ENGINE_INTEGRATION.md's Performance section (Part I)
 * as a point-in-time measurement on this development machine, not a
 * committed SLA.
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
  arraysDir = mkdtempSync(path.join(os.tmpdir(), 'flood-engine-perf-test-'));
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

function reportLatency(label: string, samplesMs: number[]): void {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  console.log(
    `[perf] ${label}: n=${sorted.length} min=${min.toFixed(1)}ms p50=${p50.toFixed(1)}ms mean=${mean.toFixed(1)}ms max=${max.toFixed(1)}ms`,
  );
}

describe('FloodEngineClient — performance measurement (Part H, measurement only)', () => {
  it('measures submission latency across several sequential requests', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const request = newSubmitRequest(`perf-submit-${i}`);
      const start = performance.now();
      const result = await client.submitSimulation(request);
      samples.push(performance.now() - start);
      expect(result.status).toBe('pending');
    }
    reportLatency('submission', samples);
    expect(samples).toHaveLength(5);
  });

  it('measures status-polling latency across several sequential requests', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const submitted = await client.submitSimulation(newSubmitRequest('perf-poll'));
    const samples: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();
      await client.getSimulationStatus(submitted.runId);
      samples.push(performance.now() - start);
    }
    reportLatency('status poll', samples);
    expect(samples).toHaveLength(10);
  });

  it('measures download latency for a completed run', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const submitted = await client.submitSimulation(newSubmitRequest('perf-download'));
    const finalStatus = await pollUntilTerminal(submitted.runId);
    expect(finalStatus.status).toBe('completed');

    const samples: number[] = [];
    for (const artifact of ['max-depth', 'arrival-time', 'duration-above-threshold'] as const) {
      const start = performance.now();
      const downloaded = await client.downloadSimulationArtifact(submitted.runId, artifact);
      samples.push(performance.now() - start);
      expect(downloaded.bytes.byteLength).toBeGreaterThan(0);
    }
    reportLatency('artifact download', samples);
    expect(samples).toHaveLength(3);
  });

  it('measures throughput under concurrent submission load', async (ctx) => {
    if (!server) {
      ctx.skip();
      return;
    }
    const concurrency = 5;
    const requests = Array.from({ length: concurrency }, (_, i) =>
      newSubmitRequest(`perf-concurrent-${i}`),
    );

    const start = performance.now();
    const perRequestSamples: number[] = [];
    const results = await Promise.all(
      requests.map(async (request) => {
        const requestStart = performance.now();
        const result = await client.submitSimulation(request);
        perRequestSamples.push(performance.now() - requestStart);
        return result;
      }),
    );
    const totalWallClockMs = performance.now() - start;

    reportLatency('concurrent submission (per-request)', perRequestSamples);
    console.log(
      `[perf] concurrent submission (aggregate): n=${concurrency} totalWallClockMs=${totalWallClockMs.toFixed(1)} impliedThroughputReqPerSec=${(concurrency / (totalWallClockMs / 1000)).toFixed(2)}`,
    );

    expect(results).toHaveLength(concurrency);
    expect(new Set(results.map((r) => r.runId)).size).toBe(concurrency);
  });
});
