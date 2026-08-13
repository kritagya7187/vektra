import { describe, expect, it } from 'vitest';
import { pathDistanceMeters, polygonAreaSqMeters } from '../../../src/domain/measurement';

describe('pathDistanceMeters', () => {
  it('returns zero for a single point', () => {
    expect(pathDistanceMeters([[72.8, 18.9]])).toBe(0);
  });
  it('returns zero for an empty path', () => {
    expect(pathDistanceMeters([])).toBe(0);
  });
  it('sums real segment lengths, not just endpoint-to-endpoint distance', () => {
    const direct = pathDistanceMeters([
      [0, 0],
      [1, 1],
    ]);
    const viaDetour = pathDistanceMeters([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(viaDetour).toBeGreaterThan(direct);
  });
  it('reports a real positive distance for a real 1-degree-longitude span near the equator', () => {
    const distance = pathDistanceMeters([
      [0, 0],
      [1, 0],
    ]);
    expect(distance).toBeGreaterThan(100000);
    expect(distance).toBeLessThan(115000);
  });
});

describe('polygonAreaSqMeters', () => {
  it('returns zero for fewer than 3 points', () => {
    expect(
      polygonAreaSqMeters([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(0);
  });
  it('returns a real positive area for a real triangle', () => {
    const area = polygonAreaSqMeters([
      [72.8, 18.9],
      [72.81, 18.9],
      [72.81, 18.91],
    ]);
    expect(area).toBeGreaterThan(0);
  });
  it('is invariant to winding direction', () => {
    const clockwise = polygonAreaSqMeters([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    const counterClockwise = polygonAreaSqMeters([
      [0, 0],
      [1, 1],
      [1, 0],
    ]);
    expect(clockwise).toBeCloseTo(counterClockwise, 5);
  });
});
