import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import { database } from '../../../src/database';
import { ConflictError } from '../../../src/errors';
import { HeatExposureSimulationService } from '../../../src/simulation/HeatExposureSimulationService';
import { ScenarioSimulationService } from '../../../src/simulation/ScenarioSimulationService';
import {
  heatExposureFactorValueRepository,
  heatExposureResultRepository,
  scenarioOverrideRepository,
  scenarioRepository,
} from '../../../src/repositories';
import type { HeatExposureFactorValueRepository } from '../../../src/types';
import { superuserPool } from '../../helpers/superuserPool';
import {
  createBuilding,
  createDataProvenanceRecord,
  createMeteorologicalObservation,
} from '../../helpers/fixtures';

/**
 * Real database, REAL repository/service/transaction layers throughout
 * — this subsystem makes no external calls at all, same as the Heat
 * Exposure Engine. Baselines used here are produced by genuinely
 * running HeatExposureSimulationService first (not hand-crafted rows),
 * so simulation_run_input_dataset reflects exactly what that engine
 * really records — the same reproduction mechanism this subsystem's
 * own design depends on.
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
    run_type: string;
    baseline_run_id: string | null;
    started_at: Date | null;
    completed_at: Date | null;
    error_message: string | null;
  }>(
    'SELECT status, run_type, baseline_run_id, started_at, completed_at, error_message FROM simulation_run WHERE run_id = $1',
    [runId],
  );
  return result.rows[0] ?? null;
}

async function runRealBaseline(options: {
  buildingCount?: number;
  withMeteorology?: boolean;
}): Promise<{ runId: string; buildingIds: string[]; osmProvenanceId: string }> {
  const osmProvenance = await createDataProvenanceRecord({ sourceCode: 'osm_overpass' });
  const buildingIds: string[] = [];
  for (let i = 0; i < (options.buildingCount ?? 1); i += 1) {
    const building = await createBuilding({ provenanceId: osmProvenance.provenanceId });
    buildingIds.push(building.buildingId);
  }

  let met: { provenanceId: string } | undefined;
  if (options.withMeteorology) {
    met = await createMeteorologicalObservation({
      variableName: 'temperature_2m',
      variableValue: 29.5,
    });
  }

  const baselineService = new HeatExposureSimulationService();
  const summary = await baselineService.run({
    osmProvenanceId: osmProvenance.provenanceId,
    meteorologicalProvenanceId: met?.provenanceId,
    meteorologicalVariableName: options.withMeteorology ? 'temperature_2m' : undefined,
  });

  return { runId: summary.runId, buildingIds, osmProvenanceId: osmProvenance.provenanceId };
}

describe('ScenarioSimulationService (real DB, full engine, real baseline)', () => {
  it('executes successfully: creates a scenario-type run, results for every baseline building, and sets Scenario.derived_run_id', async () => {
    const baseline = await runRealBaseline({ buildingCount: 2 });
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Cool Roof Scenario',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });

    const service = new ScenarioSimulationService();
    const summary = await service.run({ scenarioId: scenario.scenarioId });

    expect(summary.status).toBe('completed');
    expect(summary.baselineRunId).toBe(baseline.runId);
    expect(summary.buildingCount).toBe(2);
    expect(summary.resultCount).toBe(2);
    expect(summary.overrideCount).toBe(1);
    expect(summary.buildingsWithOverridesCount).toBe(1);

    const updatedScenario = await scenarioRepository.findById(scenario.scenarioId);
    expect(updatedScenario?.derivedRunId).toBe(summary.runId);

    const results = await heatExposureResultRepository.listByRunId(summary.runId);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.indexValue === null)).toBe(true);
    expect(new Set(results.map((r) => r.buildingId))).toEqual(new Set(baseline.buildingIds));
  });

  it('leaves the baseline completely unchanged: same building rows, same baseline run row, same baseline results', async () => {
    const baseline = await runRealBaseline({ buildingCount: 1 });
    const beforeBuilding = await database.query<{ height_m: string | null; name: string }>(
      'SELECT height_m, name FROM building WHERE building_id = $1',
      [baseline.buildingIds[0]],
    );
    const beforeBaselineRun = await fetchRunRow(baseline.runId);
    const beforeBaselineResults = await heatExposureResultRepository.listByRunId(baseline.runId);

    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario A',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'height_m',
      overrideValue: '999',
    });

    await new ScenarioSimulationService().run({ scenarioId: scenario.scenarioId });

    const afterBuilding = await database.query<{ height_m: string | null; name: string }>(
      'SELECT height_m, name FROM building WHERE building_id = $1',
      [baseline.buildingIds[0]],
    );
    expect(afterBuilding.rows[0]).toEqual(beforeBuilding.rows[0]); // the override never reached the real row

    const afterBaselineRun = await fetchRunRow(baseline.runId);
    expect(afterBaselineRun).toEqual(beforeBaselineRun);

    const afterBaselineResults = await heatExposureResultRepository.listByRunId(baseline.runId);
    expect(afterBaselineResults).toEqual(beforeBaselineResults); // baseline's own results untouched
  });

  it('applies overrides correctly: they are loaded from real ScenarioOverride rows and reflected in the execution summary, in memory only', async () => {
    const baseline = await runRealBaseline({ buildingCount: 2 });
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario B',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 1,
      attributeName: 'vegetation_context',
      overrideValue: 'tree_cover',
    });

    const summary = await new ScenarioSimulationService().run({ scenarioId: scenario.scenarioId });

    expect(summary.overrideCount).toBe(2); // both real override rows were loaded
    expect(summary.buildingsWithOverridesCount).toBe(1); // both target the same building

    // Independently confirm the real rows still exist exactly as created —
    // this subsystem never mutates or consumes them destructively.
    const overrides = await scenarioOverrideRepository.listByScenarioId(scenario.scenarioId);
    expect(overrides).toHaveLength(2);
  });

  it('is deterministic: two separately-defined scenarios with identical overrides against the same baseline produce identical results, factors, provenance, and run metadata', async () => {
    const baseline = await runRealBaseline({ buildingCount: 2, withMeteorology: true });

    const scenarioA = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario A',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenarioA.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });
    const scenarioB = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario B',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenarioB.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });

    const service = new ScenarioSimulationService();
    const summaryA = await service.run({
      scenarioId: scenarioA.scenarioId,
      meteorologicalVariableName: 'temperature_2m',
    });
    const summaryB = await service.run({
      scenarioId: scenarioB.scenarioId,
      meteorologicalVariableName: 'temperature_2m',
    });

    // Run metadata: same code/configuration version, same run_type, same
    // baseline reference — the only thing allowed to differ is identity
    // (run_id) and timing (started_at/completed_at/created_at/updated_at).
    const runA = await fetchRunRow(summaryA.runId);
    const runB = await fetchRunRow(summaryB.runId);
    expect(runA?.run_type).toBe(runB?.run_type);
    expect(runA?.baseline_run_id).toBe(runB?.baseline_run_id);
    const codeVersions = await database.query<{
      run_id: string;
      code_version: string;
      configuration_version: string;
    }>(
      'SELECT run_id, code_version, configuration_version FROM simulation_run WHERE run_id = ANY($1)',
      [[summaryA.runId, summaryB.runId]],
    );
    expect(codeVersions.rows[0].code_version).toBe(codeVersions.rows[1].code_version);
    expect(codeVersions.rows[0].configuration_version).toBe(
      codeVersions.rows[1].configuration_version,
    );

    // Recorded provenance: the exact SET of input dataset ids must match
    // between the two independently-executed scenario runs.
    const inputsA = await database.query<{ provenance_id: string }>(
      'SELECT provenance_id FROM simulation_run_input_dataset WHERE run_id = $1',
      [summaryA.runId],
    );
    const inputsB = await database.query<{ provenance_id: string }>(
      'SELECT provenance_id FROM simulation_run_input_dataset WHERE run_id = $1',
      [summaryB.runId],
    );
    expect(inputsA.rows.map((r) => r.provenance_id).sort()).toEqual(
      inputsB.rows.map((r) => r.provenance_id).sort(),
    );

    // EVERY HeatExposureResult and EVERY HeatExposureFactorValue for both
    // buildings, not just the first result — normalized by building's
    // position in the (identical) baseline building set so the two runs'
    // independently-generated result/factor ids don't block comparison.
    const resultsA = await heatExposureResultRepository.listByRunId(summaryA.runId);
    const resultsB = await heatExposureResultRepository.listByRunId(summaryB.runId);
    expect(resultsA).toHaveLength(2);
    expect(resultsB).toHaveLength(2);
    expect(resultsA.map((r) => r.buildingId).sort()).toEqual(
      resultsB.map((r) => r.buildingId).sort(),
    );
    expect(resultsA.every((r) => r.indexValue === null)).toBe(true);
    expect(resultsB.every((r) => r.indexValue === null)).toBe(true);

    const factorsByBuilding = async (results: typeof resultsA) => {
      const byBuilding = new Map<string, unknown>();
      for (const result of results) {
        const factors = await heatExposureFactorValueRepository.listByResultId(result.resultId);
        byBuilding.set(
          result.buildingId,
          factors
            .map((f) => ({
              factorKey: f.factorKey,
              isComputable: f.isComputable,
              factorValue: f.factorValue,
            }))
            .sort((a, b) => a.factorKey.localeCompare(b.factorKey)),
        );
      }
      return byBuilding;
    };
    const factorsA = await factorsByBuilding(resultsA);
    const factorsB = await factorsByBuilding(resultsB);
    expect(factorsA.size).toBe(2);
    for (const buildingId of baseline.buildingIds) {
      expect(factorsA.get(buildingId)).toEqual(factorsB.get(buildingId));
    }
  });

  it('records simulation_run_input_dataset for exactly the SAME provenance ids the baseline itself recorded', async () => {
    const baseline = await runRealBaseline({ buildingCount: 1, withMeteorology: true });
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario C',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });

    const baselineInputs = await database.query<{ provenance_id: string }>(
      'SELECT provenance_id FROM simulation_run_input_dataset WHERE run_id = $1',
      [baseline.runId],
    );

    const summary = await new ScenarioSimulationService().run({
      scenarioId: scenario.scenarioId,
      meteorologicalVariableName: 'temperature_2m',
    });

    const scenarioInputs = await database.query<{ provenance_id: string }>(
      'SELECT provenance_id FROM simulation_run_input_dataset WHERE run_id = $1',
      [summary.runId],
    );
    expect(scenarioInputs.rows.map((r) => r.provenance_id).sort()).toEqual(
      baselineInputs.rows.map((r) => r.provenance_id).sort(),
    );
  });

  it('transitions status pending -> running -> completed with started_at/completed_at set in order, run_type=scenario, baseline_run_id set', async () => {
    const baseline = await runRealBaseline({ buildingCount: 1 });
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario D',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });

    const summary = await new ScenarioSimulationService().run({ scenarioId: scenario.scenarioId });
    const run = await fetchRunRow(summary.runId);

    expect(run?.status).toBe('completed');
    expect(run?.run_type).toBe('scenario');
    expect(run?.baseline_run_id).toBe(baseline.runId);
    if (!run || !run.started_at || !run.completed_at) {
      throw new Error('expected a completed run with started_at/completed_at set');
    }
    expect(run.started_at.getTime()).toBeLessThanOrEqual(run.completed_at.getTime());
  });

  it('Scenario.derived_run_id transitions from NULL to the new run id exactly once, matching fn_guard_scenario_update', async () => {
    const baseline = await runRealBaseline({ buildingCount: 1 });
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario E',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });
    expect((await scenarioRepository.findById(scenario.scenarioId))?.derivedRunId).toBeNull();

    const summary = await new ScenarioSimulationService().run({ scenarioId: scenario.scenarioId });

    const updated = await scenarioRepository.findById(scenario.scenarioId);
    expect(updated?.derivedRunId).toBe(summary.runId);

    // Re-executing the same, now-already-executed scenario is rejected
    // cleanly before ever touching the database's own one-time guard.
    await expect(
      new ScenarioSimulationService().run({ scenarioId: scenario.scenarioId }),
    ).rejects.toThrow();
  });

  it('rolls back the ENTIRE scenario execution atomically on a genuine persistence failure — zero results, derived_run_id stays NULL, run marked failed', async () => {
    const baseline = await runRealBaseline({ buildingCount: 2 });
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario F',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });

    let callCount = 0;
    const flakyFactorValueRepository: HeatExposureFactorValueRepository = {
      listByResultId: heatExposureFactorValueRepository.listByResultId.bind(
        heatExposureFactorValueRepository,
      ),
      listByRunId: heatExposureFactorValueRepository.listByRunId.bind(
        heatExposureFactorValueRepository,
      ),
      create: async (input, executor) => {
        callCount += 1;
        // Fail on the second building's first factor row — well after the
        // first building's rows were already inserted in the same
        // transaction, proving they do not survive.
        if (callCount === 6) {
          throw new ConflictError('simulated persistence failure');
        }
        return heatExposureFactorValueRepository.create(input, executor);
      },
    };

    const service = new ScenarioSimulationService({
      heatExposureFactorValueRepository: flakyFactorValueRepository,
    });

    await expect(service.run({ scenarioId: scenario.scenarioId })).rejects.toThrow(ConflictError);

    expect(callCount).toBe(6);

    const updatedScenario = await scenarioRepository.findById(scenario.scenarioId);
    expect(updatedScenario?.derivedRunId).toBeNull(); // never committed

    const runs = await database.query<{
      run_id: string;
      status: string;
      error_message: string | null;
    }>(
      'SELECT run_id, status, error_message FROM simulation_run WHERE run_type = $1 ORDER BY created_at DESC LIMIT 1',
      ['scenario'],
    );
    expect(runs.rows[0].status).toBe('failed');
    expect(runs.rows[0].error_message).toBe('simulated persistence failure');

    const results = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM heat_exposure_result WHERE run_id = $1',
      [runs.rows[0].run_id],
    );
    expect(results.rows[0]?.count).toBe('0'); // building A's own result row rolled back too

    // Explicitly re-query every table written inside the transaction —
    // not inferred from Postgres's single-transaction guarantee alone.
    // callCount reached 6 before failing: building A's HeatExposureResult
    // + all 5 of its HeatExposureFactorValue rows, plus building B's
    // HeatExposureResult row, were all inserted (uncommitted) on this
    // same tx before the 6th factor-value insert threw.
    const factorValues = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM heat_exposure_factor_value hefv JOIN heat_exposure_result her ON her.result_id = hefv.result_id WHERE her.run_id = $1',
      [runs.rows[0].run_id],
    );
    expect(factorValues.rows[0]?.count).toBe('0');

    const inputDatasets = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM simulation_run_input_dataset WHERE run_id = $1',
      [runs.rows[0].run_id],
    );
    expect(inputDatasets.rows[0]?.count).toBe('0');

    // SimulationRun itself is NOT rolled back — by design, it is created
    // and updated OUTSIDE the results transaction so it survives to be
    // marked 'failed' (see this subsystem's design review, transaction
    // boundaries). Confirmed as a real, queryable row above (status/
    // error_message assertions), distinct from the tables that DO roll
    // back together.
  });

  it('emits real structured JSON logs for start, baseline selection, overrides, and completion, carrying the scenario and run ids', async () => {
    const baseline = await runRealBaseline({ buildingCount: 1 });
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario G',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });

    const { logger, lines } = createCapturingLogger();
    const service = new ScenarioSimulationService({ logger });
    const summary = await service.run({ scenarioId: scenario.scenarioId });

    const logLines = lines();
    const started = logLines.find((l) => l.msg === 'scenario execution started');
    const baselineSelected = logLines.find((l) => l.msg === 'baseline selected');
    const overridesApplied = logLines.find((l) => l.msg === 'overrides applied');
    const completed = logLines.find((l) => l.msg === 'scenario execution completed');

    expect(started?.scenarioId).toBe(scenario.scenarioId);
    expect(baselineSelected?.baselineRunId).toBe(baseline.runId);
    expect(overridesApplied?.overrideCount).toBe(1);
    expect(completed?.runId).toBe(summary.runId);
    expect(completed?.scenarioId).toBe(scenario.scenarioId);
    expect(logLines.every((l) => l.level === 30)).toBe(true);
  });

  it("immutable historical outputs: a scenario run's HeatExposureResult/HeatExposureFactorValue rows reject UPDATE at the database level", async () => {
    const baseline = await runRealBaseline({ buildingCount: 1 });
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario H',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });

    const summary = await new ScenarioSimulationService().run({ scenarioId: scenario.scenarioId });
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

  it("reproducibility: the scenario run's own recorded provenance can independently reconstruct the exact building set it used", async () => {
    const baseline = await runRealBaseline({ buildingCount: 3 });
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Scenario I',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: baseline.buildingIds[0],
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.8',
    });

    const summary = await new ScenarioSimulationService().run({ scenarioId: scenario.scenarioId });

    const recordedInputs = await database.query<{ provenance_id: string }>(
      'SELECT provenance_id FROM simulation_run_input_dataset WHERE run_id = $1',
      [summary.runId],
    );
    expect(recordedInputs.rows).toHaveLength(1);
    expect(recordedInputs.rows[0].provenance_id).toBe(baseline.osmProvenanceId);

    const reconstructedBuildings = await database.query<{ building_id: string }>(
      'SELECT building_id FROM building WHERE provenance_id = $1',
      [recordedInputs.rows[0].provenance_id],
    );
    expect(new Set(reconstructedBuildings.rows.map((r) => r.building_id))).toEqual(
      new Set(baseline.buildingIds),
    );

    const results = await heatExposureResultRepository.listByRunId(summary.runId);
    expect(new Set(results.map((r) => r.buildingId))).toEqual(new Set(baseline.buildingIds));
  });
});
