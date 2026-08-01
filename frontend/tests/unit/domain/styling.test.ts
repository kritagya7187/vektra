import { describe, expect, it } from 'vitest';
import { styleForResult } from '../../../src/domain/styling';
import type { HeatExposureResult } from '../../../src/api';

function result(indexValue: number | null): HeatExposureResult {
  return {
    resultId: 'r1',
    runId: 'run-1',
    buildingId: 'b1',
    indexValue,
    computedAt: '2025-01-01T00:00:00Z',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

describe('styleForResult — the Critical UX Requirement enforced in code', () => {
  it('renders the same neutral fill/outline color when indexValue is null (the current, real state of every result)', () => {
    const style = styleForResult(result(null));
    expect(style.hasComputedIndex).toBe(false);
    expect(style.fillColorCss).toMatch(/^#/);
    expect(style.outlineColorCss).toMatch(/^#/);
  });

  it('never returns a color derived from indexValue — two different (hypothetical) non-null values produce IDENTICAL styling, proving no ramp is applied', () => {
    const low = styleForResult(result(0.1));
    const high = styleForResult(result(0.9));
    expect(low.fillColorCss).toBe(high.fillColorCss);
    expect(low.outlineColorCss).toBe(high.outlineColorCss);
  });

  it('a non-null indexValue is still reported via hasComputedIndex, for a future legend to use once a real ramp exists', () => {
    expect(styleForResult(result(0.5)).hasComputedIndex).toBe(true);
    expect(styleForResult(result(null)).hasComputedIndex).toBe(false);
  });

  it('the neutral color is identical for a null and a non-null result today — styling is 100% indifferent to indexValue', () => {
    const nullStyle = styleForResult(result(null));
    const valueStyle = styleForResult(result(0.42));
    expect(nullStyle.fillColorCss).toBe(valueStyle.fillColorCss);
    expect(nullStyle.outlineColorCss).toBe(valueStyle.outlineColorCss);
  });
});
