import { describe, expect, it } from 'vitest';
import { database } from '../../../src/database';
import { scenarioOverrideRepository, scenarioRepository } from '../../../src/repositories';
import { createBuilding, createSimulationRun } from '../../helpers/fixtures';

describe('ScenarioRepository / ScenarioOverrideRepository (real DB)', () => {
  it('create() returns the server-generated row via RETURNING', async () => {
    const baseline = await createSimulationRun();
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Repo-level scenario',
      description: null,
      createdBy: null,
    });
    expect(scenario.scenarioId).toBeTruthy();
    expect(scenario.derivedRunId).toBeNull();
    expect(scenario.createdAt).toBeInstanceOf(Date);
  });

  it('create() accepts an executor — participates in an external transaction (Database.withTransaction)', async () => {
    const baseline = await createSimulationRun();

    const scenario = await database.withTransaction((tx) =>
      scenarioRepository.create(
        { baselineRunId: baseline.runId, name: 'Transactional scenario' },
        tx,
      ),
    );

    const reread = await scenarioRepository.findById(scenario.scenarioId);
    expect(reread?.scenarioId).toBe(scenario.scenarioId);
  });

  it('listByScenarioId preserves sequence_number ordering, not insertion order', async () => {
    const baseline = await createSimulationRun();
    const scenario = await scenarioRepository.create({
      baselineRunId: baseline.runId,
      name: 'Ordering test',
    });
    const buildingA = await createBuilding();
    const buildingB = await createBuilding();

    // Inserted out of sequence order on purpose.
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: buildingB.buildingId,
      sequenceNumber: 1,
      attributeName: 'roof_albedo',
      overrideValue: '0.9',
    });
    await scenarioOverrideRepository.create({
      scenarioId: scenario.scenarioId,
      buildingId: buildingA.buildingId,
      sequenceNumber: 0,
      attributeName: 'roof_albedo',
      overrideValue: '0.7',
    });

    const overrides = await scenarioOverrideRepository.listByScenarioId(scenario.scenarioId);
    expect(overrides.map((o) => o.sequenceNumber)).toEqual([0, 1]);
    expect(overrides[0]?.buildingId).toBe(buildingA.buildingId);
  });

  it('findById returns null for a nonexistent scenario', async () => {
    expect(await scenarioRepository.findById('11111111-1111-1111-1111-111111111111')).toBeNull();
  });
});
