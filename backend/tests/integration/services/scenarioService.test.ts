import { describe, expect, it } from 'vitest';
import { database } from '../../../src/database';
import { NotFoundError, ValidationError } from '../../../src/errors';
import { scenarioService } from '../../../src/services';
import {
  createBuilding,
  createHeatExposureResult,
  createSimulationRun,
} from '../../helpers/fixtures';

/**
 * The deepest test file in this subsystem — ScenarioService.createScenario
 * is the one place this backend has real, EDD-grounded business rules
 * (Subsystem 9's review), each asserted here against the real database,
 * in the same order the service validates them.
 */
describe('ScenarioService.createScenario (real DB — business rule enforcement)', () => {
  it('rejects an empty override set (FR-8: "a set of attribute overrides")', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    await expect(
      scenarioService.createScenario({
        baselineRunId: baseline.runId,
        name: 'empty',
        overrides: [],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects duplicate (buildingId, attributeName) pairs within one request (conflict detection)', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const building = await createBuilding();
    await expect(
      scenarioService.createScenario({
        baselineRunId: baseline.runId,
        name: 'dup',
        overrides: [
          { buildingId: building.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
          { buildingId: building.buildingId, attributeName: 'roof_albedo', overrideValue: '0.9' },
        ],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a nonexistent baselineRunId (existence validation)', async () => {
    const building = await createBuilding();
    await expect(
      scenarioService.createScenario({
        baselineRunId: '11111111-1111-1111-1111-111111111111',
        name: 'missing-baseline',
        overrides: [
          { buildingId: building.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
        ],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects a baseline run that is actually run_type=scenario (closes DB review Critical C1)', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const scenarioRun = await createSimulationRun({
      runType: 'scenario',
      status: 'completed',
      baselineRunId: baseline.runId,
    });
    const building = await createBuilding();

    await expect(
      scenarioService.createScenario({
        baselineRunId: scenarioRun.runId,
        name: 'wrong-run-type',
        overrides: [
          { buildingId: building.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
        ],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a baseline run that has not completed', async () => {
    const pending = await createSimulationRun({ runType: 'baseline', status: 'pending' });
    const building = await createBuilding();

    await expect(
      scenarioService.createScenario({
        baselineRunId: pending.runId,
        name: 'not-completed',
        overrides: [
          { buildingId: building.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
        ],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a nonexistent building referenced by an override', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    await expect(
      scenarioService.createScenario({
        baselineRunId: baseline.runId,
        name: 'missing-building',
        overrides: [
          {
            buildingId: '11111111-1111-1111-1111-111111111111',
            attributeName: 'roof_albedo',
            overrideValue: '0.8',
          },
        ],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('succeeds and creates the scenario + every override atomically, with auto-assigned sequence numbers', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const buildingA = await createBuilding();
    const buildingB = await createBuilding();

    const created = await scenarioService.createScenario({
      baselineRunId: baseline.runId,
      name: 'Cool roof pilot',
      overrides: [
        { buildingId: buildingA.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
        { buildingId: buildingB.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
      ],
    });

    expect(created.overrides).toHaveLength(2);
    expect(created.overrides[0]?.sequenceNumber).toBe(0);
    expect(created.overrides[1]?.sequenceNumber).toBe(1);

    // Independently re-read via a fresh query (not the service's own
    // return value) to prove the transaction really committed.
    const persisted = await database.query<{ count: string }>(
      'SELECT count(*)::text FROM scenario_override WHERE scenario_id = $1',
      [created.scenario.scenarioId],
    );
    expect(persisted.rows[0]?.count).toBe('2');
  });

  it('leaves no partial rows when a later validation step rejects the request (atomicity)', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const validBuilding = await createBuilding();

    await expect(
      scenarioService.createScenario({
        baselineRunId: baseline.runId,
        name: 'partial-should-not-persist',
        overrides: [
          {
            buildingId: validBuilding.buildingId,
            attributeName: 'roof_albedo',
            overrideValue: '0.8',
          },
          {
            buildingId: '11111111-1111-1111-1111-111111111111',
            attributeName: 'roof_albedo',
            overrideValue: '0.8',
          },
        ],
      }),
    ).rejects.toThrow(NotFoundError);

    const scenarioCount = await database.query<{ count: string }>(
      "SELECT count(*)::text FROM scenario WHERE name = 'partial-should-not-persist'",
    );
    expect(scenarioCount.rows[0]?.count).toBe('0');
  });
});

describe('ScenarioService.getComparison (real DB — lifecycle reporting)', () => {
  it('reports scenarioResults=null for a not-yet-executed scenario (normal state, not an error)', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const building = await createBuilding();
    await createHeatExposureResult(baseline.runId, building.buildingId, 0.5);

    const created = await scenarioService.createScenario({
      baselineRunId: baseline.runId,
      name: 'Comparison test',
      overrides: [
        { buildingId: building.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
      ],
    });

    const comparison = await scenarioService.getComparison(created.scenario.scenarioId);
    expect(comparison.baselineResults).toHaveLength(1);
    expect(comparison.scenarioResults).toBeNull();
  });

  it('getById throws NotFoundError for an unknown scenario', async () => {
    await expect(scenarioService.getById('11111111-1111-1111-1111-111111111111')).rejects.toThrow(
      NotFoundError,
    );
  });
});
