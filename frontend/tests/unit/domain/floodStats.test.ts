import { describe, expect, it } from 'vitest';
import { computeFloodStats } from '../../../src/domain/floodStats';
import type { AoiBoundsWgs84, FloodOutputSummary } from '../../../src/api';
const AOI: AoiBoundsWgs84 = [72.8, 18.9, 72.81, 18.91];
function summary(overrides: Partial<FloodOutputSummary> = {}): FloodOutputSummary {
  return {
    maxDepthM: [
      [1, 0],
      [0, 2],
    ],
    arrivalTimeMin: [
      [5, null],
      [null, 10],
    ],
    durationAboveThresholdMin: [
      [3, 0],
      [0, 6],
    ],
    massLedger: { rainfallInputM3: 100, infiltrationLossM3: 20, boundaryOutflowM3: 10 },
    stepCount: 42,
    simulatedDurationS: 3600,
    ...overrides,
  };
}
describe('computeFloodStats', () => {
  it('counts exactly the cells with positive depth as flooded', () => {
    const stats = computeFloodStats(summary(), AOI);
    expect(stats.floodedFraction).toBeCloseTo(0.5, 5);
  });
  it('reports a real, positive flooded area for a non-empty AOI', () => {
    const stats = computeFloodStats(summary(), AOI);
    expect(stats.floodedAreaSqKm).toBeGreaterThan(0);
  });
  it('reports zero flooded area for a completely dry run', () => {
    const dry = summary({
      maxDepthM: [
        [0, 0],
        [0, 0],
      ],
    });
    const stats = computeFloodStats(dry, AOI);
    expect(stats.floodedAreaSqKm).toBe(0);
    expect(stats.floodedFraction).toBe(0);
  });
  it('passes through the real max depth/arrival/duration and mass ledger unchanged', () => {
    const stats = computeFloodStats(summary(), AOI);
    expect(stats.maxDepthM).toBe(2);
    expect(stats.maxArrivalMin).toBe(10);
    expect(stats.maxDurationMin).toBe(6);
    expect(stats.stepCount).toBe(42);
    expect(stats.simulatedDurationS).toBe(3600);
    expect(stats.rainfallInputM3).toBe(100);
    expect(stats.infiltrationLossM3).toBe(20);
    expect(stats.boundaryOutflowM3).toBe(10);
  });
  it('returns zero area/fraction for an empty grid without dividing by zero', () => {
    const empty = summary({ maxDepthM: [], arrivalTimeMin: [], durationAboveThresholdMin: [] });
    const stats = computeFloodStats(empty, AOI);
    expect(stats.floodedAreaSqKm).toBe(0);
    expect(stats.floodedFraction).toBe(0);
    expect(Number.isFinite(stats.floodedAreaSqKm)).toBe(true);
  });
});
