import { describe, expect, it } from 'vitest';
import { heatExposureResultRepository } from '../../../src/repositories';
import {
  createBuilding,
  createHeatExposureResult,
  createSimulationRun,
} from '../../helpers/fixtures';

describe('HeatExposureResultRepository (real DB)', () => {
  it('listByRunId returns every result for one run, ordered by building_id', async () => {
    const run = await createSimulationRun();
    const otherRun = await createSimulationRun();
    const buildingA = await createBuilding();
    const buildingB = await createBuilding();

    await createHeatExposureResult(run.runId, buildingA.buildingId, 0.3);
    await createHeatExposureResult(run.runId, buildingB.buildingId, 0.7);
    await createHeatExposureResult(otherRun.runId, buildingA.buildingId, 0.9);

    const results = await heatExposureResultRepository.listByRunId(run.runId);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.runId === run.runId)).toBe(true);
  });

  it('converts nullable NUMERIC index_value correctly (present and NULL cases)', async () => {
    const run = await createSimulationRun();
    const building = await createBuilding();
    const withValue = await createHeatExposureResult(run.runId, building.buildingId, 0.42);
    const buildingB = await createBuilding();
    const withNull = await createHeatExposureResult(run.runId, buildingB.buildingId, null);

    const a = await heatExposureResultRepository.findById(withValue.resultId);
    const b = await heatExposureResultRepository.findById(withNull.resultId);

    expect(a?.indexValue).toBe(0.42);
    expect(typeof a?.indexValue).toBe('number');
    expect(b?.indexValue).toBeNull();
  });

  it('listByRunId returns an empty array for a run with no results', async () => {
    const run = await createSimulationRun();
    expect(await heatExposureResultRepository.listByRunId(run.runId)).toEqual([]);
  });
});
