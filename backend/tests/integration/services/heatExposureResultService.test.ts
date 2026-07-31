import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/errors';
import { heatExposureResultService } from '../../../src/services';
import {
  createBuilding,
  createHeatExposureFactorValue,
  createHeatExposureResult,
  createSimulationRun,
} from '../../helpers/fixtures';

describe('HeatExposureResultService (real DB)', () => {
  it('listForRun(runId) returns exactly that run’s results', async () => {
    const run = await createSimulationRun();
    const building = await createBuilding();
    await createHeatExposureResult(run.runId, building.buildingId);

    const results = await heatExposureResultService.listForRun(run.runId);
    expect(results).toHaveLength(1);
    expect(results[0]?.runId).toBe(run.runId);
  });

  it('listForRun() with no runId defaults to the latest completed baseline (EDD Section 21)', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const building = await createBuilding();
    await createHeatExposureResult(baseline.runId, building.buildingId);

    const results = await heatExposureResultService.listForRun();
    expect(results).toHaveLength(1);
    expect(results[0]?.runId).toBe(baseline.runId);
  });

  it('listForRun() throws NotFoundError when no runId is given and no baseline run exists', async () => {
    await expect(heatExposureResultService.listForRun()).rejects.toThrow(NotFoundError);
  });

  it('getWithFactors composes the result and its per-factor breakdown', async () => {
    const run = await createSimulationRun();
    const building = await createBuilding();
    const result = await createHeatExposureResult(run.runId, building.buildingId);
    await createHeatExposureFactorValue(result.resultId, 'morphology_density', 12);
    await createHeatExposureFactorValue(result.resultId, 'thermal_signature', null);

    const { result: fetched, factors } = await heatExposureResultService.getWithFactors(
      result.resultId,
    );
    expect(fetched.resultId).toBe(result.resultId);
    expect(factors).toHaveLength(2);
    expect(factors.find((f) => f.factorKey === 'thermal_signature')?.factorValue).toBeNull();
  });

  it('getById throws NotFoundError for an unknown result', async () => {
    await expect(
      heatExposureResultService.getById('11111111-1111-1111-1111-111111111111'),
    ).rejects.toThrow(NotFoundError);
  });
});
