import { describe, expect, it } from 'vitest';
import {
  computeNdviRange,
  computeThermalRange,
  computeVisualizationRanges,
  ndviColorFor,
  ndviRampStops,
  styleForVisualizationMode,
  thermalColorFor,
  thermalRampStops,
  NO_DATA_FILL_CSS,
} from '../../../src/domain/colorRamps';
import type { TwinBuilding } from '../../../src/domain/joinBuildingsWithResults';
import type {
  BuildingGeoJsonProperties,
  HeatExposureFactorValue,
  HeatExposureResult,
} from '../../../src/api';

function factor(overrides: Partial<HeatExposureFactorValue> = {}): HeatExposureFactorValue {
  return {
    factorValueId: 'fv-1',
    resultId: 'result-1',
    factorKey: 'thermal_signature',
    factorValue: null,
    isComputable: false,
    notes: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function twinBuilding(resultId: string, factors: readonly HeatExposureFactorValue[]): TwinBuilding {
  const building = { buildingId: `b-${resultId}` } as BuildingGeoJsonProperties;
  const result = { resultId } as HeatExposureResult;
  return {
    building,
    geometry: { type: 'MultiPolygon', coordinates: [] },
    result,
    factors,
  };
}

describe('thermalColorFor / ndviColorFor', () => {
  it("maps the minimum of a range to the ramp's first (coolest/lowest) stop", () => {
    expect(thermalColorFor(300, { min: 300, max: 320 })).toBe(thermalRampStops()[0][1]);
    expect(ndviColorFor(-0.1, { min: -0.1, max: 0.3 })).toBe(ndviRampStops()[0][1]);
  });

  it("maps the maximum of a range to the ramp's last (hottest/highest) stop", () => {
    const lastThermal = thermalRampStops()[thermalRampStops().length - 1][1];
    const lastNdvi = ndviRampStops()[ndviRampStops().length - 1][1];
    expect(thermalColorFor(320, { min: 300, max: 320 })).toBe(lastThermal);
    expect(ndviColorFor(0.3, { min: -0.1, max: 0.3 })).toBe(lastNdvi);
  });

  it('degrades to the ramp midpoint (never divides by zero) when min === max', () => {
    // A run where every computable building shares the identical value.
    expect(thermalColorFor(310, { min: 310, max: 310 })).toBe(thermalRampStops()[2][1]);
  });
});

describe('computeThermalRange / computeNdviRange', () => {
  it('computes real min/max across only computable values, excluding non-computable rows', () => {
    const buildings: TwinBuilding[] = [
      twinBuilding('r1', [
        factor({
          resultId: 'r1',
          factorKey: 'thermal_signature',
          factorValue: 310,
          isComputable: true,
        }),
      ]),
      twinBuilding('r2', [
        factor({
          resultId: 'r2',
          factorKey: 'thermal_signature',
          factorValue: 320,
          isComputable: true,
        }),
      ]),
      twinBuilding('r3', [
        factor({
          resultId: 'r3',
          factorKey: 'thermal_signature',
          factorValue: null,
          isComputable: false,
        }),
      ]),
    ];
    expect(computeThermalRange(buildings)).toEqual({ min: 310, max: 320 });
  });

  it('returns null (never a guessed range) when zero buildings are computable', () => {
    const buildings: TwinBuilding[] = [
      twinBuilding('r1', [factor({ resultId: 'r1', isComputable: false })]),
    ];
    expect(computeThermalRange(buildings)).toBeNull();
    expect(computeNdviRange(buildings)).toBeNull();
  });

  it('computeVisualizationRanges returns both ranges independently', () => {
    const buildings: TwinBuilding[] = [
      twinBuilding('r1', [
        factor({
          resultId: 'r1',
          factorKey: 'thermal_signature',
          factorValue: 310,
          isComputable: true,
        }),
        factor({
          resultId: 'r1',
          factorValueId: 'fv-2',
          factorKey: 'vegetation_land_cover',
          factorValue: 0.2,
          isComputable: true,
        }),
      ]),
    ];
    expect(computeVisualizationRanges(buildings)).toEqual({
      thermal: { min: 310, max: 310 },
      ndvi: { min: 0.2, max: 0.2 },
    });
  });
});

describe('styleForVisualizationMode', () => {
  const ranges = { thermal: { min: 300, max: 320 }, ndvi: { min: -0.1, max: 0.3 } };

  it('colors a computable thermal building using the real value', () => {
    const factors = [
      factor({ factorKey: 'thermal_signature', factorValue: 310, isComputable: true }),
    ];
    const style = styleForVisualizationMode('thermal', factors, ranges);
    expect(style.fillColorCss).not.toBe(NO_DATA_FILL_CSS);
    expect(style.hasComputedIndex).toBe(false);
  });

  it('falls back to the no-data treatment for a not-computable building, never a fabricated color', () => {
    const factors = [factor({ factorKey: 'thermal_signature', isComputable: false })];
    const style = styleForVisualizationMode('thermal', factors, ranges);
    expect(style.fillColorCss).toBe(NO_DATA_FILL_CSS);
  });

  it('always returns no-data for landcover mode — no ramp exists for it', () => {
    const factors = [
      factor({ factorKey: 'vegetation_land_cover', factorValue: 0.2, isComputable: true }),
    ];
    expect(styleForVisualizationMode('landcover', factors, ranges).fillColorCss).toBe(
      NO_DATA_FILL_CSS,
    );
  });

  it('returns no-data when the run has no computable range at all, even for a computable-looking factor row', () => {
    const factors = [
      factor({ factorKey: 'thermal_signature', factorValue: 310, isComputable: true }),
    ];
    const style = styleForVisualizationMode('thermal', factors, { thermal: null, ndvi: null });
    expect(style.fillColorCss).toBe(NO_DATA_FILL_CSS);
  });
});
