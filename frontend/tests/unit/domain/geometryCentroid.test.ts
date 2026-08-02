import { describe, expect, it } from 'vitest';
import { geometryCentroid } from '../../../src/domain/geometryCentroid';
import type { GeoJsonMultiPolygon } from '../../../src/api';

describe('geometryCentroid', () => {
  it('computes the bounding-box center of a single-part square footprint', () => {
    const geometry: GeoJsonMultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [72.8, 18.9],
            [72.802, 18.9],
            [72.802, 18.902],
            [72.8, 18.902],
            [72.8, 18.9],
          ],
        ],
      ],
    };
    expect(geometryCentroid(geometry)).toEqual({ lon: 72.801, lat: 18.901 });
  });

  it('spans all parts of a multi-part footprint (bounding box across both, not just the first)', () => {
    const geometry: GeoJsonMultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [72.8, 18.9],
            [72.801, 18.9],
            [72.801, 18.901],
            [72.8, 18.901],
            [72.8, 18.9],
          ],
        ],
        [
          [
            [72.803, 18.903],
            [72.804, 18.903],
            [72.804, 18.904],
            [72.803, 18.904],
            [72.803, 18.903],
          ],
        ],
      ],
    };
    const centroid = geometryCentroid(geometry);
    // toBeCloseTo, not toEqual: (72.8 + 72.804) / 2 is a real IEEE-754
    // rounding artifact (72.80199999999999), not a bug in the function.
    expect(centroid.lon).toBeCloseTo(72.802, 9);
    expect(centroid.lat).toBeCloseTo(18.902, 9);
  });
});
