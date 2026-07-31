import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/errors';
import { simulationRunService } from '../../../src/services';
import { createSimulationRun } from '../../helpers/fixtures';

describe('SimulationRunService (real DB)', () => {
  it('getById throws NotFoundError for an unknown id', async () => {
    await expect(
      simulationRunService.getById('11111111-1111-1111-1111-111111111111'),
    ).rejects.toThrow(NotFoundError);
  });

  it('getLatestBaselineRun returns null (not a throw) when none exists — normal, not error, state', async () => {
    expect(await simulationRunService.getLatestBaselineRun()).toBeNull();
  });

  it('getLatestBaselineRun returns the completed baseline, ignoring a pending one and a scenario-type run', async () => {
    const pending = await createSimulationRun({ runType: 'baseline', status: 'pending' });
    const completed = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    await createSimulationRun({
      runType: 'scenario',
      status: 'completed',
      baselineRunId: completed.runId,
    });

    const latest = await simulationRunService.getLatestBaselineRun();
    expect(latest?.runId).toBe(completed.runId);
    expect(latest?.runId).not.toBe(pending.runId);
  });

  it('getLatestBaselineRun returns the most recently created completed baseline when several exist', async () => {
    await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const secondBaseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });

    const latest = await simulationRunService.getLatestBaselineRun();
    expect(latest?.runId).toBe(secondBaseline.runId);
  });
});
