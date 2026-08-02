import { describe, expect, it } from 'vitest';
import { joinBuildingsWithResults } from '../../../src/domain/joinBuildingsWithResults';
import type {
  BuildingGeoJsonProperties,
  GeoJsonFeatureCollection,
  HeatExposureFactorValue,
  HeatExposureResult,
} from '../../../src/api';

const SQUARE_COORDS: readonly (readonly [number, number])[] = [
  [72.8, 18.9],
  [72.801, 18.9],
  [72.801, 18.901],
  [72.8, 18.901],
  [72.8, 18.9],
];

function buildingProperties(
  overrides: Partial<BuildingGeoJsonProperties> = {},
): BuildingGeoJsonProperties {
  return {
    buildingId: 'building-1',
    osmId: 1,
    osmType: 'way',
    buildingTagType: 'house',
    name: null,
    heightM: null,
    buildingLevels: null,
    footprintAreaSqm: 120,
    provenanceId: 'prov-1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function result(overrides: Partial<HeatExposureResult> = {}): HeatExposureResult {
  return {
    resultId: 'result-1',
    runId: 'run-1',
    buildingId: 'building-1',
    indexValue: null,
    computedAt: '2025-01-01T00:00:00Z',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function collection(
  features: readonly BuildingGeoJsonProperties[],
): GeoJsonFeatureCollection<BuildingGeoJsonProperties> {
  return {
    type: 'FeatureCollection',
    features: features.map((properties) => ({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [[SQUARE_COORDS]] },
      properties,
    })),
  };
}

describe('joinBuildingsWithResults', () => {
  it('includes only buildings that have a result for the active run', () => {
    const fc = collection([
      buildingProperties({ buildingId: 'a' }),
      buildingProperties({ buildingId: 'b' }),
      buildingProperties({ buildingId: 'c' }),
    ]);
    const results = [result({ buildingId: 'a' }), result({ buildingId: 'c' })];

    const joined = joinBuildingsWithResults(fc, results);

    expect(joined.map((tb) => tb.building.buildingId).sort()).toEqual(['a', 'c']);
  });

  it('this is the resolution to the "buildings not scoped to a provenance batch" gap: buildings from OTHER batches (with no result for this run) are excluded', () => {
    const fc = collection([
      buildingProperties({ buildingId: 'current-batch' }),
      buildingProperties({ buildingId: 'superseded-batch' }),
    ]);
    const results = [result({ buildingId: 'current-batch' })];

    const joined = joinBuildingsWithResults(fc, results);

    expect(joined).toHaveLength(1);
    expect(joined[0].building.buildingId).toBe('current-batch');
  });

  it('pairs each joined building with its own result, not a mismatched one', () => {
    const fc = collection([
      buildingProperties({ buildingId: 'a' }),
      buildingProperties({ buildingId: 'b' }),
    ]);
    const results = [
      result({ resultId: 'r-a', buildingId: 'a', indexValue: null }),
      result({ resultId: 'r-b', buildingId: 'b', indexValue: null }),
    ];

    const joined = joinBuildingsWithResults(fc, results);
    const byId = new Map(joined.map((tb) => [tb.building.buildingId, tb]));

    expect(byId.get('a')?.result.resultId).toBe('r-a');
    expect(byId.get('b')?.result.resultId).toBe('r-b');
  });

  it('returns an empty array when there are no results (a valid, non-error state)', () => {
    const fc = collection([buildingProperties()]);
    expect(joinBuildingsWithResults(fc, [])).toEqual([]);
  });

  it('skips a feature whose geometry is not MultiPolygon (defensive)', () => {
    const fc: GeoJsonFeatureCollection<BuildingGeoJsonProperties> = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [SQUARE_COORDS] },
          properties: buildingProperties(),
        },
      ],
    };
    const joined = joinBuildingsWithResults(fc, [result()]);
    expect(joined).toEqual([]);
  });

  it('defaults factors to an empty array when the caller does not fetch them (e.g. comparison-mode re-join)', () => {
    const fc = collection([buildingProperties()]);
    const joined = joinBuildingsWithResults(fc, [result()]);
    expect(joined[0].factors).toEqual([]);
  });

  it("joins each building to its own result's factor rows, matched by resultId, never a mismatched building's", () => {
    const fc = collection([
      buildingProperties({ buildingId: 'a' }),
      buildingProperties({ buildingId: 'b' }),
    ]);
    const results = [
      result({ resultId: 'r-a', buildingId: 'a' }),
      result({ resultId: 'r-b', buildingId: 'b' }),
    ];
    const factors: HeatExposureFactorValue[] = [
      {
        factorValueId: 'fv-a',
        resultId: 'r-a',
        factorKey: 'thermal_signature',
        factorValue: 310,
        isComputable: true,
        notes: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        factorValueId: 'fv-b',
        resultId: 'r-b',
        factorKey: 'thermal_signature',
        factorValue: 315,
        isComputable: true,
        notes: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ];

    const joined = joinBuildingsWithResults(fc, results, factors);
    const byId = new Map(joined.map((tb) => [tb.building.buildingId, tb]));

    expect(byId.get('a')?.factors).toEqual([factors[0]]);
    expect(byId.get('b')?.factors).toEqual([factors[1]]);
  });
});
