import { describe, expect, it } from 'vitest';
import { sampleProfile } from '../../../src/domain/crossSection';

describe('sampleProfile', () => {
  it('returns an empty array for fewer than 2 points', () => {
    expect(sampleProfile([[0, 0]], 10, () => 5, null)).toEqual([]);
  });
  it('returns an empty array for fewer than 2 samples', () => {
    expect(
      sampleProfile(
        [
          [0, 0],
          [1, 1],
        ],
        1,
        () => 5,
        null,
      ),
    ).toEqual([]);
  });
  it('samples the requested count, starting and ending at the path endpoints', () => {
    const samples = sampleProfile(
      [
        [0, 0],
        [1, 0],
      ],
      5,
      (lon) => lon * 100,
      null,
    );
    expect(samples).toHaveLength(5);
    expect(samples[0].distanceM).toBe(0);
    expect(samples[0].elevationM).toBeCloseTo(0, 5);
    expect(samples[4].elevationM).toBeCloseTo(100, 5);
  });
  it('distances are monotonically increasing', () => {
    const samples = sampleProfile(
      [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      10,
      () => 0,
      null,
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].distanceM).toBeGreaterThanOrEqual(samples[i - 1].distanceM);
    }
  });
  it('includes depth samples only when a depthAt function is supplied', () => {
    const withDepth = sampleProfile(
      [
        [0, 0],
        [1, 0],
      ],
      3,
      () => 0,
      () => 2.5,
    );
    expect(withDepth.every((sample) => sample.depthM === 2.5)).toBe(true);

    const withoutDepth = sampleProfile(
      [
        [0, 0],
        [1, 0],
      ],
      3,
      () => 0,
      null,
    );
    expect(withoutDepth.every((sample) => sample.depthM === null)).toBe(true);
  });
});
