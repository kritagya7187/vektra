import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXTRUSION_HEIGHT_M,
  LEVEL_HEIGHT_M,
  extrusionHeightFor,
} from '../../../src/domain/extrusion';
import type { BuildingGeoJsonProperties } from '../../../src/api';

function building(overrides: Partial<BuildingGeoJsonProperties> = {}): BuildingGeoJsonProperties {
  return {
    buildingId: 'b1',
    osmId: 1,
    osmType: 'way',
    buildingTagType: 'house',
    name: null,
    heightM: null,
    buildingLevels: null,
    footprintAreaSqm: null,
    provenanceId: 'prov-1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('extrusionHeightFor (EDD Section 20: real tag, then fallback)', () => {
  it('uses heightM when present and positive', () => {
    expect(extrusionHeightFor(building({ heightM: 18.5, buildingLevels: 6 }))).toBe(18.5);
  });

  it('falls back to buildingLevels * LEVEL_HEIGHT_M when heightM is absent', () => {
    expect(extrusionHeightFor(building({ heightM: null, buildingLevels: 4 }))).toBe(
      4 * LEVEL_HEIGHT_M,
    );
  });

  it('falls back to the documented default when both tags are absent', () => {
    expect(extrusionHeightFor(building({ heightM: null, buildingLevels: null }))).toBe(
      DEFAULT_EXTRUSION_HEIGHT_M,
    );
  });

  it('ignores a non-positive heightM and falls through to levels/default', () => {
    expect(extrusionHeightFor(building({ heightM: 0, buildingLevels: 3 }))).toBe(
      3 * LEVEL_HEIGHT_M,
    );
    expect(extrusionHeightFor(building({ heightM: -5, buildingLevels: null }))).toBe(
      DEFAULT_EXTRUSION_HEIGHT_M,
    );
  });

  it('ignores a non-positive buildingLevels and falls through to the default', () => {
    expect(extrusionHeightFor(building({ heightM: null, buildingLevels: 0 }))).toBe(
      DEFAULT_EXTRUSION_HEIGHT_M,
    );
  });
});
