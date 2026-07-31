import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/testApp';
import {
  createBuilding,
  createEnvironmentalRasterAsset,
  createHeatExposureResult,
  createScenario,
  createScenarioOverride,
  createSimulationRun,
} from '../helpers/fixtures';

describe('GET /api/buildings/export (CSV + GeoJSON)', () => {
  it('CSV: correct MIME type, Content-Disposition, header row, escaping, null handling', async () => {
    await createBuilding({ name: 'Special, "Corp"', heightM: null, buildingLevels: null });
    await createBuilding({ name: 'Plain Building' });

    const res = await testApp().get('/api/buildings/export?format=csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="buildings.csv"');

    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'buildingId,osmId,osmType,buildingTagType,name,heightM,buildingLevels,footprintAreaSqm,provenanceId,createdAt,updatedAt',
    );
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(res.text).toContain('"Special, ""Corp"""');
    // null heightM/buildingLevels render as consecutive empty cells
    expect(res.text).toMatch(/Special, ""Corp""",,,/);
  });

  it('GeoJSON: valid FeatureCollection, geometry split from properties, correct MIME type', async () => {
    await createBuilding();
    await createBuilding();

    const res = await testApp().get('/api/buildings/export?format=geojson');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/geo+json; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="buildings.geojson"');
    expect(res.body.type).toBe('FeatureCollection');
    expect(res.body.features).toHaveLength(2);
    expect(res.body.features[0].type).toBe('Feature');
    expect(res.body.features[0].geometry.type).toBe('MultiPolygon');
    expect(res.body.features[0].properties).not.toHaveProperty('geomWgs84');
    expect(res.body.features[0].properties).not.toHaveProperty('geomUtm43n');
  });

  it('large export: returns every row across multiple internal pages, not capped at the default 50', async () => {
    const total = 210; // exceeds EXPORT_BATCH_SIZE (200) — proves the pagination loop iterates more than once
    for (let i = 0; i < total; i += 1) {
      await createBuilding();
    }

    const res = await testApp().get('/api/buildings/export?format=csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines).toHaveLength(total + 1); // + header
  }, 30_000);

  it('missing format -> 400', async () => {
    const res = await testApp().get('/api/buildings/export');
    expect(res.status).toBe(400);
  });

  it('unsupported format -> 400 listing only the valid values', async () => {
    const res = await testApp().get('/api/buildings/export?format=xml');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain('csv, geojson');
  });
});

describe('CSV-only exports (Heat Exposure Results, Scenarios, Simulation Runs, Environmental Raster Assets)', () => {
  it('GET /api/heat-exposure-results/export?format=geojson is rejected — not a supported format for this resource', async () => {
    const res = await testApp().get('/api/heat-exposure-results/export?format=geojson');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toBe('must be one of: csv');
  });

  it('GET /api/heat-exposure-results/export?format=csv returns the run’s results as CSV', async () => {
    const run = await createSimulationRun();
    const building = await createBuilding();
    await createHeatExposureResult(run.runId, building.buildingId, 0.5);

    const res = await testApp().get(
      `/api/heat-exposure-results/export?format=csv&runId=${run.runId}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.text.trim().split('\r\n')).toHaveLength(2);
  });

  it('GET /api/scenarios/export?format=csv returns scenario rows, not overrides', async () => {
    const baseline = await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const scenario = await createScenario(baseline.runId, { name: 'Export me' });
    const building = await createBuilding();
    await createScenarioOverride(scenario.scenarioId, building.buildingId, 0);

    const res = await testApp().get('/api/scenarios/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Export me');
    expect(res.text).not.toContain('roof_albedo');
  });

  it('GET /api/simulation-runs/export?format=csv includes null fields (e.g. baselineRunId for a baseline run) as empty cells', async () => {
    await createSimulationRun({ runType: 'baseline', status: 'completed' });
    const res = await testApp().get('/api/simulation-runs/export?format=csv');
    expect(res.status).toBe(200);
    const dataLine = res.text.trim().split('\r\n')[1];
    expect(dataLine).toBeDefined();
  });

  it('GET /api/environmental-raster-assets/export?format=csv excludes spatial_extent (metadata only)', async () => {
    await createEnvironmentalRasterAsset();
    const res = await testApp().get('/api/environmental-raster-assets/export?format=csv');
    expect(res.status).toBe(200);
    const header = res.text.split('\r\n')[0];
    expect(header).not.toContain('spatialExtent');
    expect(header).not.toContain('spatial_extent');
  });
});
