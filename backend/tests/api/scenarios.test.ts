import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/testApp';
import { createBuilding, createHeatExposureResult, createSimulationRun } from '../helpers/fixtures';

const NONEXISTENT_UUID = '11111111-1111-1111-1111-111111111111';

describe('POST /api/scenarios (full HTTP-level business rule matrix)', () => {
  it('malformed body (missing required fields) -> 400 with field-level details', async () => {
    const res = await testApp().post('/api/scenarios').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('body.baselineRunId');
    expect(paths).toContain('body.overrides');
  });

  it('structurally valid but empty overrides array -> 400, business-rule message (details: null)', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const res = await testApp()
      .post('/api/scenarios')
      .send({ baselineRunId: baseline.runId, name: 'empty', overrides: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toBeNull();
    expect(res.body.error.message).toMatch(/at least one attribute override/);
  });

  it('baseline run references a scenario-type run -> 400 (closes DB review Critical C1)', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const scenarioRun = await createSimulationRun({
      runType: 'scenario',
      status: 'completed',
      baselineRunId: baseline.runId,
    });
    const building = await createBuilding();

    const res = await testApp()
      .post('/api/scenarios')
      .send({
        baselineRunId: scenarioRun.runId,
        name: 'wrong-type',
        overrides: [
          { buildingId: building.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('baseline run not completed -> 400', async () => {
    const pending = await createSimulationRun({ runType: 'baseline', status: 'pending' });
    const building = await createBuilding();
    const res = await testApp()
      .post('/api/scenarios')
      .send({
        baselineRunId: pending.runId,
        name: 'not-completed',
        overrides: [
          { buildingId: building.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('nonexistent building referenced -> 404', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const res = await testApp()
      .post('/api/scenarios')
      .send({
        baselineRunId: baseline.runId,
        name: 'missing-building',
        overrides: [
          { buildingId: NONEXISTENT_UUID, attributeName: 'roof_albedo', overrideValue: '0.8' },
        ],
      });
    expect(res.status).toBe(404);
  });

  it('success -> 201, scenario + overrides in the response, persisted and independently readable', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const buildingA = await createBuilding();
    const buildingB = await createBuilding();

    const createRes = await testApp()
      .post('/api/scenarios')
      .send({
        baselineRunId: baseline.runId,
        name: 'Cool roof pilot',
        overrides: [
          { buildingId: buildingA.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
          { buildingId: buildingB.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
        ],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.overrides).toHaveLength(2);
    const scenarioId: string = createRes.body.data.scenario.scenarioId;

    const getRes = await testApp().get(`/api/scenarios/${scenarioId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe('Cool roof pilot');
  });

  it('malformed JSON body -> 400 (body-parser SyntaxError path, not a 500)', async () => {
    const res = await testApp()
      .post('/api/scenarios')
      .set('Content-Type', 'application/json')
      .send('{not-json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/scenarios/:id/comparison', () => {
  it('reports scenarioResults=null for a not-yet-executed scenario (normal state, not 4xx/5xx)', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const building = await createBuilding();
    await createHeatExposureResult(baseline.runId, building.buildingId, 0.5);

    const createRes = await testApp()
      .post('/api/scenarios')
      .send({
        baselineRunId: baseline.runId,
        name: 'Comparison test',
        overrides: [
          { buildingId: building.buildingId, attributeName: 'roof_albedo', overrideValue: '0.8' },
        ],
      });
    const scenarioId: string = createRes.body.data.scenario.scenarioId;

    const res = await testApp().get(`/api/scenarios/${scenarioId}/comparison`);
    expect(res.status).toBe(200);
    expect(res.body.data.baselineResults).toHaveLength(1);
    expect(res.body.data.scenarioResults).toBeNull();
  });

  it('404s for an unknown scenario id', async () => {
    const res = await testApp().get(`/api/scenarios/${NONEXISTENT_UUID}/comparison`);
    expect(res.status).toBe(404);
  });
});
