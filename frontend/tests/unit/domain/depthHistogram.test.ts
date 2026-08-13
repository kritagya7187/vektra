import { describe, expect, it } from 'vitest';
import { computeDepthHistogram } from '../../../src/domain/depthHistogram';

describe('computeDepthHistogram', () => {
  it('ignores dry and non-finite cells', () => {
    const bins = computeDepthHistogram([[0, -1, NaN, 0.05]]);
    const total = bins.reduce((sum, bin) => sum + bin.cellCount, 0);
    expect(total).toBe(1);
  });
  it('bins a real value into its correct range', () => {
    const bins = computeDepthHistogram([[0.3]]);
    const match = bins.find((bin) => bin.minM === 0.1);
    expect(match?.cellCount).toBe(1);
  });
  it('puts values at or above the top edge into the open-ended final bin', () => {
    const bins = computeDepthHistogram([[10]]);
    const last = bins[bins.length - 1];
    expect(last.maxM).toBeNull();
    expect(last.cellCount).toBe(1);
  });
  it('returns every bin even when empty', () => {
    const bins = computeDepthHistogram([[0]]);
    expect(bins.every((bin) => bin.cellCount === 0)).toBe(true);
    expect(bins.length).toBeGreaterThan(0);
  });
});
