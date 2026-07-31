import { describe, expect, it } from 'vitest';
import { buildingRepository } from '../../../src/repositories';
import { createBuilding } from '../../helpers/fixtures';

describe('BuildingRepository (real DB — geometry, NUMERIC, BIGINT mapping)', () => {
  it('findById maps geometry to real GeoJSON via ST_AsGeoJSON, not raw PostGIS output', async () => {
    const fixture = await createBuilding({ heightM: 42.5, buildingLevels: 10 });

    const building = await buildingRepository.findById(fixture.buildingId);

    expect(building).not.toBeNull();
    expect(building?.geomWgs84.type).toBe('MultiPolygon');
    expect(Array.isArray(building?.geomWgs84.coordinates)).toBe(true);
    // geom_utm43n is auto-derived by fn_populate_building_utm_geometry
    // (db/migrations/0005) — never supplied by this fixture, proving the
    // DB-side trigger ran, not just that the repository can map it.
    expect(building?.geomUtm43n?.type).toBe('MultiPolygon');
  });

  it('converts NUMERIC height_m (pg returns as string) to a real JS number', async () => {
    const fixture = await createBuilding({ heightM: 42.5 });
    const building = await buildingRepository.findById(fixture.buildingId);
    expect(building?.heightM).toBe(42.5);
    expect(typeof building?.heightM).toBe('number');
  });

  it('converts BIGINT osm_id (pg returns as string) to a real JS number', async () => {
    const fixture = await createBuilding();
    const building = await buildingRepository.findById(fixture.buildingId);
    expect(typeof building?.osmId).toBe('number');
  });

  it('maps a NULL height_m/building_levels to null, not 0 or undefined', async () => {
    const fixture = await createBuilding({ heightM: null, buildingLevels: null });
    const building = await buildingRepository.findById(fixture.buildingId);
    expect(building?.heightM).toBeNull();
    expect(building?.buildingLevels).toBeNull();
  });

  it('computes footprint_area_sqm as a generated column (ST_Area), not application logic', async () => {
    const fixture = await createBuilding();
    const building = await buildingRepository.findById(fixture.buildingId);
    expect(building?.footprintAreaSqm).toBeGreaterThan(0);
  });

  it('findById returns null for a nonexistent id', async () => {
    const building = await buildingRepository.findById('11111111-1111-1111-1111-111111111111');
    expect(building).toBeNull();
  });

  it('list returns every fixture row, most recently created first', async () => {
    const first = await createBuilding();
    const second = await createBuilding();
    const rows = await buildingRepository.list();
    expect(rows.map((r) => r.buildingId)).toEqual([second.buildingId, first.buildingId]);
  });
});
