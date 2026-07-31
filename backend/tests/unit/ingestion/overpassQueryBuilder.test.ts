import { describe, expect, it } from 'vitest';
import { buildBuildingFootprintQuery } from '../../../src/ingestion/osm/overpassQueryBuilder';

describe('buildBuildingFootprintQuery', () => {
  it('builds a bbox query scoped to way/relation building tags only', () => {
    const query = buildBuildingFootprintQuery(
      { kind: 'bbox', bbox: { minLon: 72.8, minLat: 18.9, maxLon: 72.9, maxLat: 19.0 } },
      60,
    );
    expect(query).toContain('[out:json][timeout:60];');
    expect(query).toContain('way["building"](18.9,72.8,19,72.9);');
    expect(query).toContain('relation["building"]["type"="multipolygon"](18.9,72.8,19,72.9);');
    expect(query).toContain('out geom;');
    // Never queries roads, trees, water, amenities, or any other object class.
    expect(query).not.toMatch(/highway|natural|amenity|waterway/);
  });

  it('builds a named-area query without hardcoding any area name in the builder itself', () => {
    const query = buildBuildingFootprintQuery({ kind: 'namedArea', areaName: 'South Mumbai' }, 30);
    expect(query).toContain('area["name"="South Mumbai"]->.searchArea;');
    expect(query).toContain('way["building"](area.searchArea);');
    expect(query).toContain('relation["building"]["type"="multipolygon"](area.searchArea);');
  });

  it('is pure — identical input always produces identical output', () => {
    const area = { kind: 'namedArea' as const, areaName: 'Test Area' };
    expect(buildBuildingFootprintQuery(area, 45)).toBe(buildBuildingFootprintQuery(area, 45));
  });

  it('rejects an area name containing a quote (query-syntax safety)', () => {
    expect(() =>
      buildBuildingFootprintQuery({ kind: 'namedArea', areaName: 'Evil" ]; .;wrong' }, 30),
    ).toThrow();
  });

  it('rejects an empty area name', () => {
    expect(() => buildBuildingFootprintQuery({ kind: 'namedArea', areaName: '  ' }, 30)).toThrow();
  });
});
