import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/testApp';
import {
  createBuilding,
  createDataProvenanceRecord,
  createEnvironmentalRasterAsset,
  createHeatExposureFactorValue,
  createHeatExposureResult,
  createSimulationRun,
} from '../helpers/fixtures';

const NONEXISTENT_UUID = '11111111-1111-1111-1111-111111111111';

describe('GET /api/data-sources (non-UUID text primary key)', () => {
  it('lists seeded data sources in the standard {data} envelope', async () => {
    const res = await testApp().get('/api/data-sources');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(6);
  });

  it('getById by source_code (not a UUID) succeeds', async () => {
    const res = await testApp().get('/api/data-sources/osm_overpass');
    expect(res.status).toBe(200);
    expect(res.body.data.sourceCode).toBe('osm_overpass');
  });

  it('404s for an unknown source code, with the standard error envelope', async () => {
    const res = await testApp().get('/api/data-sources/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });
});

describe('GET /api/data-provenance', () => {
  it('getById returns a fixture row', async () => {
    const fixture = await createDataProvenanceRecord();
    const res = await testApp().get(`/api/data-provenance/${fixture.provenanceId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.provenanceId).toBe(fixture.provenanceId);
  });
});

describe('GET /api/buildings', () => {
  it('list applies pagination query params', async () => {
    await createBuilding();
    await createBuilding();
    const res = await testApp().get('/api/buildings?limit=1&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('getById returns real GeoJSON geometry inline', async () => {
    const fixture = await createBuilding();
    const res = await testApp().get(`/api/buildings/${fixture.buildingId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.geomWgs84.type).toBe('MultiPolygon');
  });

  it('rejects a non-UUID id with a 400 validation error, details naming the field', async () => {
    const res = await testApp().get('/api/buildings/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { path: 'params.id', message: 'must be a valid UUID' },
    ]);
  });

  it('404s for a well-formed but nonexistent UUID', async () => {
    const res = await testApp().get(`/api/buildings/${NONEXISTENT_UUID}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/environmental-raster-assets', () => {
  it('getById returns a fixture row', async () => {
    const fixture = await createEnvironmentalRasterAsset();
    const res = await testApp().get(`/api/environmental-raster-assets/${fixture.rasterAssetId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.rasterAssetId).toBe(fixture.rasterAssetId);
  });
});

describe('GET /api/meteorological-observations', () => {
  it('list returns an empty array when no observations exist', async () => {
    const res = await testApp().get('/api/meteorological-observations');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/simulation-runs', () => {
  it('/latest-baseline resolves as a distinct route, not swallowed by /:id', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const res = await testApp().get('/api/simulation-runs/latest-baseline');
    expect(res.status).toBe(200);
    expect(res.body.data.runId).toBe(baseline.runId);
  });

  it('/latest-baseline 404s when no completed baseline run exists', async () => {
    const res = await testApp().get('/api/simulation-runs/latest-baseline');
    expect(res.status).toBe(404);
  });

  it('getById returns a fixture run', async () => {
    const run = await createSimulationRun();
    const res = await testApp().get(`/api/simulation-runs/${run.runId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.runId).toBe(run.runId);
  });
});

describe('GET /api/heat-exposure-results', () => {
  it('defaults to the latest baseline run when runId is omitted (EDD Section 21)', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const building = await createBuilding();
    await createHeatExposureResult(baseline.runId, building.buildingId);

    const res = await testApp().get('/api/heat-exposure-results');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].runId).toBe(baseline.runId);
  });

  it(':id/factors returns the per-factor breakdown', async () => {
    const run = await createSimulationRun();
    const building = await createBuilding();
    const result = await createHeatExposureResult(run.runId, building.buildingId);
    await createHeatExposureFactorValue(result.resultId, 'morphology_density', 5);

    const res = await testApp().get(`/api/heat-exposure-results/${result.resultId}/factors`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].factorKey).toBe('morphology_density');
  });

  it(':id/factors 404s for an unknown result id', async () => {
    const res = await testApp().get(`/api/heat-exposure-results/${NONEXISTENT_UUID}/factors`);
    expect(res.status).toBe(404);
  });
});
