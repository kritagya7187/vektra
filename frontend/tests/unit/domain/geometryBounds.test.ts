import { describe, expect, it } from 'vitest';
import { geometryBounds } from '../../../src/domain/geometryBounds';
import type { GeoJsonMultiPolygon } from '../../../src/api';
function square(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
): GeoJsonMultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    ],
  };
}
describe('geometryBounds', () => {
  it('returns null for an empty list', () => {
    expect(geometryBounds([])).toBeNull();
  });
  it('returns the exact bounds of a single geometry', () => {
    expect(geometryBounds([square(72.8, 18.9, 72.81, 18.91)])).toEqual({
      west: 72.8,
      south: 18.9,
      east: 72.81,
      north: 18.91,
    });
  });
  it('spans multiple geometries, not just the first', () => {
    const bounds = geometryBounds([square(0, 0, 1, 1), square(5, 5, 6, 6)]);
    expect(bounds).toEqual({ west: 0, south: 0, east: 6, north: 6 });
  });
  it('includes holes/inner rings in the scan (uses every coordinate, not just outer rings)', () => {
    const withHole: GeoJsonMultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
          [
            [2, 2],
            [3, 2],
            [3, 3],
            [2, 3],
            [2, 2],
          ],
        ],
      ],
    };
    expect(geometryBounds([withHole])).toEqual({ west: 0, south: 0, east: 10, north: 10 });
  });
});
