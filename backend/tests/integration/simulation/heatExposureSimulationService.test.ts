import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import { database } from '../../../src/database';
import { ConflictError, ValidationError } from '../../../src/errors';
import { HeatExposureSimulationService } from '../../../src/simulation/HeatExposureSimulationService';
import {
  heatExposureFactorValueRepository,
  heatExposureResultRepository,
} from '../../../src/repositories';
import type { HeatExposureFactorValueRepository } from '../../../src/types';
import { superuserPool } from '../../helpers/superuserPool';
import {
  createBuilding,
  createDataProvenanceRecord,
  createMeteorologicalObservation,
} from '../../helpers/fixtures';

/**
 * Real database (shared disposable test container), REAL repository/
 * service/transaction layers throughout — this subsystem makes no
 * external calls at all (EDD Section 17: "no dependency on the API
 * layer... invoked manually"), so unlike ingestion there is nothing to
 * stub here; every test exercises the genuine engine end to end.
 */

function createCapturingLogger(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ level: 'info' }, stream);
  return {
    logger,
    lines: () =>
      chunks
        .filter((c) => c.trim().length > 0)
        .map((c) => JSON.parse(c) as Record<string, unknown>),
  };
}

async function fetchRunRow(runId: string) {
  const result = await database.query<{
    status: string;
    started_at: Date | null;
    completed_at: Date | null;
    error_message: string | null;
    code_version: string;
    configuration_version: string;
    run_type: string;
  }>(
    'SELECT status, started_at, completed_at, error_message, code_version, configuration_version, run_type FROM simulation_run WHERE run_id = $1',
    [runId],
  );
  return result.rows[0] ?? null;
}

describe('HeatExposureSimulationService (real DB, full engine)', () => {
  it('runs a successful baseline simulation: one HeatExposureResult + 5 HeatExposureFactorValue rows per building, only meteorological_context computable', async () => {
    const service = new HeatExposureSimulationService();
    const provenance = await createDataProvenanceRecord({ sourceCode: 'osm_overpass' });
    const buildingA = await createBuilding({ provenanceId: provenance.provenanceId });
    const buildingB = await createBuilding({ provenanceId: provenance.provenanceId });
    const met = await createMeteorologicalObservation({
      variableName: 'temperature_2m',
      variableValue: 30,
    });

    const summary = await service.run({
      osmProvenanceId: provenance.provenanceId,
      meteorologicalProvenanceId: met.provenanceId,
      meteorologicalVariableName: 'temperature_2m',
    });

    expect(summary.status).toBe('completed');
    expect(summary.buildingCount).toBe(2);
    expect(summary.resultCount).toBe(2);

    const results = await heatExposureResultRepository.listByRunId(summary.runId);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.indexValue === null)).toBe(true); // Section 18: never computed

    const [firstResult] = results;
    const factors = await heatExposureFactorValueRepository.listByResultId(firstResult.resultId);
    expect(factors).toHaveLength(5);
    const computable = factors.filter((f) => f.isComputable);
    expect(computable.map((f) => f.factorKey)).toEqual(['meteorological_context']);
    expect(computable.every((f) => f.factorValue !== null && f.notes !== null)).toBe(true);
    const notComputable = factors.filter((f) => !f.isComputable);
    expect(notComputable).toHaveLength(4);
    expect(notComputable.every((f) => f.factorValue === null)).toBe(true);

    expect(buildingA.buildingId).not.toBe(buildingB.buildingId); // sanity: two distinct fixtures used
  });

  it('is deterministic: two separate runs against the identical pinned inputs produce identical factor computations', async () => {
    const service = new HeatExposureSimulationService();
    const provenance = await createDataProvenanceRecord({ sourceCode: 'osm_overpass' });
    await createBuilding({ provenanceId: provenance.provenanceId, heightM: 15, buildingLevels: 4 });
    const met = await createMeteorologicalObservation({
      variableName: 'temperature_2m',
      variableValue: 28.6,
    });

    const input = {
      osmProvenanceId: provenance.provenanceId,
      meteorologicalProvenanceId: met.provenanceId,
      meteorologicalVariableName: 'temperature_2m',
    };

    const first = await service.run(input);
    const second = await service.run(input);

    const firstResults = await heatExposureResultRepository.listByRunId(first.runId);
    const secondResults = await heatExposureResultRepository.listByRunId(second.runId);
    expect(firstResults).toHaveLength(1);
    expect(secondResults).toHaveLength(1);

    const firstFactors = await heatExposureFactorValueRepository.listByResultId(
      firstResults[0].resultId,
    );
    const secondFactors = await heatExposureFactorValueRepository.listByResultId(
      secondResults[0].resultId,
    );

    const normalize = (factors: typeof firstFactors) =>
      factors
        .map((f) => ({
          factorKey: f.factorKey,
          isComputable: f.isComputable,
          factorValue: f.factorValue,
        }))
        .sort((a, b) => a.factorKey.localeCompare(b.factorKey));
    expect(normalize(firstFactors)).toEqual(normalize(secondFactors));
  });

  it('rolls back the ENTIRE run atomically on a genuine per-building persistence failure — zero partial results, run marked failed', async () => {
    const provenance = await createDataProvenanceRecord({ sourceCode: 'osm_overpass' });
    const buildingA = await createBuilding({ provenanceId: provenance.provenanceId });
    const buildingB = await createBuilding({ provenanceId: provenance.provenanceId });

    let callCount = 0;
    const flakyFactorValueRepository: HeatExposureFactorValueRepository = {
      listByResultId: heatExposureFactorValueRepository.listByResultId.bind(
        heatExposureFactorValueRepository,
      ),
      create: async (input, executor) => {
        callCount += 1;
        // Fail on the SECOND building's very first factor row, well after
        // the first building has already been fully inserted within the
        // same transaction — proving the first building's rows do NOT
        // survive (whole-transaction atomicity, not per-item isolation).
        if (callCount === 6) {
          throw new ConflictError('simulated persistence failure');
        }
        return heatExposureFactorValueRepository.create(input, executor);
      },
    };

    const service = new HeatExposureSimulationService({
      heatExposureFactorValueRepository: flakyFactorValueRepository,
    });

    await expect(service.run({ osmProvenanceId: provenance.provenanceId })).rejects.toThrow(
      ConflictError,
    );

    // The run row was created (and its status updated to 'failed') before
    // the failing transaction rolled back — that row survives independent
    // of the atomic results transaction (see this subsystem's design
    // review, transaction boundaries). vitest.integration.config.ts runs
    // this file's tests sequentially (fileParallelism: false), so "most
    // recently created run" unambiguously means this test's own run.
    const runs = await database.query<{
      run_id: string;
      status: string;
      error_message: string | null;
    }>('SELECT run_id, status, error_message FROM simulation_run ORDER BY created_at DESC LIMIT 1');
    const run = runs.rows[0];
    expect(run.status).toBe('failed');
    expect(run.error_message).toBe('simulated persistence failure');

    const results = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM heat_exposure_result WHERE run_id = $1',
      [run.run_id],
    );
    expect(results.rows[0]?.count).toBe('0'); // building A's rows rolled back too

    expect(buildingA.buildingId).not.toBe(buildingB.buildingId);
  });

  it('transitions status pending -> running -> completed with started_at/completed_at set in order', async () => {
    const service = new HeatExposureSimulationService();
    const provenance = await createDataProvenanceRecord({ sourceCode: 'osm_overpass' });
    await createBuilding({ provenanceId: provenance.provenanceId });

    const summary = await service.run({ osmProvenanceId: provenance.provenanceId });
    const run = await fetchRunRow(summary.runId);

    expect(run?.status).toBe('completed');
    expect(run?.started_at).not.toBeNull();
    expect(run?.completed_at).not.toBeNull();
    if (!run || !run.started_at || !run.completed_at) {
      throw new Error('expected a completed run with started_at/completed_at set');
    }
    expect(run.started_at.getTime()).toBeLessThanOrEqual(run.completed_at.getTime());
    expect(run.run_type).toBe('baseline');
  });

  it('records simulation_run_input_dataset for exactly the resolved OSM and Open-Meteo provenance ids', async () => {
    const service = new HeatExposureSimulationService();
    const osmProvenance = await createDataProvenanceRecord({ sourceCode: 'osm_overpass' });
    await createBuilding({ provenanceId: osmProvenance.provenanceId });
    const met = await createMeteorologicalObservation({ variableName: 'temperature_2m' });

    const summary = await service.run({
      osmProvenanceId: osmProvenance.provenanceId,
      meteorologicalProvenanceId: met.provenanceId,
      meteorologicalVariableName: 'temperature_2m',
    });

    const rows = await database.query<{ provenance_id: string }>(
      'SELECT provenance_id FROM simulation_run_input_dataset WHERE run_id = $1',
      [summary.runId],
    );
    expect(rows.rows.map((r) => r.provenance_id).sort()).toEqual(
      [osmProvenance.provenanceId, met.provenanceId].sort(),
    );
  });

  it('version selection: with no explicit provenance id, resolves the MOST RECENTLY retrieved osm_overpass batch, not just any batch', async () => {
    const older = await createDataProvenanceRecord({
      sourceCode: 'osm_overpass',
      retrievalTimestamp: new Date('2025-01-01T00:00:00Z'),
    });
    await createBuilding({ provenanceId: older.provenanceId, name: 'Old Batch Building' });

    const newer = await createDataProvenanceRecord({
      sourceCode: 'osm_overpass',
      retrievalTimestamp: new Date('2025-06-01T00:00:00Z'),
    });
    await createBuilding({ provenanceId: newer.provenanceId, name: 'New Batch Building A' });
    await createBuilding({ provenanceId: newer.provenanceId, name: 'New Batch Building B' });

    const service = new HeatExposureSimulationService();
    const summary = await service.run({});

    expect(summary.buildingCount).toBe(2); // the newer batch's 2 buildings, not the older batch's 1
    expect(summary.inputDatasetProvenanceIds).toContain(newer.provenanceId);
    expect(summary.inputDatasetProvenanceIds).not.toContain(older.provenanceId);
  });

  it('version selection: an explicit provenance id pins a specific (non-latest) batch even when a newer one exists', async () => {
    const older = await createDataProvenanceRecord({
      sourceCode: 'osm_overpass',
      retrievalTimestamp: new Date('2025-01-01T00:00:00Z'),
    });
    await createBuilding({ provenanceId: older.provenanceId });

    const newer = await createDataProvenanceRecord({
      sourceCode: 'osm_overpass',
      retrievalTimestamp: new Date('2025-06-01T00:00:00Z'),
    });
    await createBuilding({ provenanceId: newer.provenanceId });
    await createBuilding({ provenanceId: newer.provenanceId });

    const service = new HeatExposureSimulationService();
    const summary = await service.run({ osmProvenanceId: older.provenanceId });

    expect(summary.buildingCount).toBe(1);
    expect(summary.inputDatasetProvenanceIds).toEqual([older.provenanceId]);
  });

  it('simulation failure handling: throws ValidationError and creates no run row at all when no OSM data has ever been ingested', async () => {
    // A fresh provenance/building-free slice: use a source code with
    // certainly no rows (a nonsense but schema-valid identifier collides
    // with nothing real).
    const service = new HeatExposureSimulationService();
    const before = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM simulation_run',
    );

    await expect(
      service.run({ osmProvenanceId: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toThrow(ValidationError);

    const after = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM simulation_run',
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count); // no run row created — failed before createRun()
  });

  it('emits real structured JSON logs for start, input resolution, and completion, carrying the run id', async () => {
    const { logger, lines } = createCapturingLogger();
    const service = new HeatExposureSimulationService({ logger });
    const provenance = await createDataProvenanceRecord({ sourceCode: 'osm_overpass' });
    await createBuilding({ provenanceId: provenance.provenanceId });

    const summary = await service.run({ osmProvenanceId: provenance.provenanceId });

    const logLines = lines();
    const started = logLines.find((l) => l.msg === 'simulation started');
    const resolved = logLines.find((l) => l.msg === 'input datasets resolved');
    const completed = logLines.find((l) => l.msg === 'simulation completed');

    expect(started).toBeDefined();
    expect(resolved?.runId).toBe(summary.runId);
    expect(resolved?.osmProvenanceId).toBe(provenance.provenanceId);
    expect(completed?.runId).toBe(summary.runId);
    expect(completed?.status).toBe('completed');
    expect(logLines.every((l) => l.level === 30)).toBe(true); // pino info, no console.log/raw text
  });

  it('immutable historical outputs: a completed HeatExposureResult and HeatExposureFactorValue row reject UPDATE at the database level', async () => {
    const service = new HeatExposureSimulationService();
    const provenance = await createDataProvenanceRecord({ sourceCode: 'osm_overpass' });
    await createBuilding({ provenanceId: provenance.provenanceId });
    const summary = await service.run({ osmProvenanceId: provenance.provenanceId });
    const [result] = await heatExposureResultRepository.listByRunId(summary.runId);
    const [factor] = await heatExposureFactorValueRepository.listByResultId(result.resultId);

    await expect(
      superuserPool.query(
        'UPDATE heat_exposure_result SET index_value = 0.99 WHERE result_id = $1',
        [result.resultId],
      ),
    ).rejects.toThrow();

    await expect(
      superuserPool.query(
        'UPDATE heat_exposure_factor_value SET factor_value = 999 WHERE factor_value_id = $1',
        [factor.factorValueId],
      ),
    ).rejects.toThrow();
  });

  it('reproducibility: re-running with the EXACT provenance ids recorded by a past run reconstructs identical results, even after newer data has since been ingested', async () => {
    const service = new HeatExposureSimulationService();

    const historicalProvenance = await createDataProvenanceRecord({
      sourceCode: 'osm_overpass',
      retrievalTimestamp: new Date('2025-01-01T00:00:00Z'),
    });
    await createBuilding({
      provenanceId: historicalProvenance.provenanceId,
      heightM: 12,
      buildingLevels: 3,
    });
    const historicalMet = await createMeteorologicalObservation({
      variableName: 'temperature_2m',
      variableValue: 27.1,
      observationTimestamp: new Date('2025-01-01T10:00:00Z'),
    });

    const historicalRun = await service.run({
      osmProvenanceId: historicalProvenance.provenanceId,
      meteorologicalProvenanceId: historicalMet.provenanceId,
      meteorologicalVariableName: 'temperature_2m',
    });

    // Simulate time passing: a NEW OSM batch and a NEW meteorological
    // reading are ingested after the historical run — "latest" now
    // points somewhere else entirely.
    const laterProvenance = await createDataProvenanceRecord({
      sourceCode: 'osm_overpass',
      retrievalTimestamp: new Date('2025-07-01T00:00:00Z'),
    });
    await createBuilding({ provenanceId: laterProvenance.provenanceId });
    await createBuilding({ provenanceId: laterProvenance.provenanceId });
    await createMeteorologicalObservation({
      variableName: 'temperature_2m',
      variableValue: 40,
      observationTimestamp: new Date('2025-07-01T10:00:00Z'),
    });

    // Reconstruct: read back exactly which provenance ids the historical
    // run actually used (simulation_run_input_dataset — the reproduction
    // mechanism, FR-12) and pin them explicitly.
    const recordedInputs = await database.query<{ provenance_id: string }>(
      'SELECT provenance_id FROM simulation_run_input_dataset WHERE run_id = $1',
      [historicalRun.runId],
    );
    const recordedIds = recordedInputs.rows.map((r) => r.provenance_id);
    expect(recordedIds.sort()).toEqual(
      [historicalProvenance.provenanceId, historicalMet.provenanceId].sort(),
    );

    const reproducedRun = await service.run({
      osmProvenanceId: historicalProvenance.provenanceId,
      meteorologicalProvenanceId: historicalMet.provenanceId,
      meteorologicalVariableName: 'temperature_2m',
    });

    expect(reproducedRun.buildingCount).toBe(historicalRun.buildingCount); // NOT the later batch's 2 buildings

    const historicalResults = await heatExposureResultRepository.listByRunId(historicalRun.runId);
    const reproducedResults = await heatExposureResultRepository.listByRunId(reproducedRun.runId);
    const historicalFactors = await heatExposureFactorValueRepository.listByResultId(
      historicalResults[0].resultId,
    );
    const reproducedFactors = await heatExposureFactorValueRepository.listByResultId(
      reproducedResults[0].resultId,
    );

    const normalize = (factors: typeof historicalFactors) =>
      factors
        .map((f) => ({
          factorKey: f.factorKey,
          isComputable: f.isComputable,
          factorValue: f.factorValue,
        }))
        .sort((a, b) => a.factorKey.localeCompare(b.factorKey));
    expect(normalize(reproducedFactors)).toEqual(normalize(historicalFactors));
  });
});
