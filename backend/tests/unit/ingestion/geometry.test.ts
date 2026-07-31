import { describe, expect, it } from 'vitest';
import { processGeometry } from '../../../src/ingestion/osm/geometry';
import type { Ring } from '../../../src/ingestion/types';

const SQUARE: Ring = [
  [72.8, 18.9],
  [72.801, 18.9],
  [72.801, 18.901],
  [72.8, 18.901],
  [72.8, 18.9], // already closed
];

const UNCLOSED_SQUARE: Ring = SQUARE.slice(0, -1);

describe('processGeometry', () => {
  it('accepts a valid closed ring and produces a MultiPolygon wrapping one Polygon', () => {
    const outcome = processGeometry([SQUARE]);
    expect(outcome.status).toBe('valid');
    if (outcome.status === 'valid') {
      expect(outcome.geoJson.type).toBe('MultiPolygon');
      expect(outcome.geoJson.coordinates).toHaveLength(1);
      expect(outcome.geoJson.coordinates[0]).toHaveLength(1); // one ring, no holes
      expect(outcome.geoJson.coordinates[0]?.[0]).toHaveLength(5);
    }
  });

  it('repairs an unclosed ring by closing it (safe, documented repair)', () => {
    const outcome = processGeometry([UNCLOSED_SQUARE]);
    expect(outcome.status).toBe('valid');
    if (outcome.status === 'valid') {
      const ring = outcome.geoJson.coordinates[0]?.[0];
      expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
    }
  });

  it('includes inner rings (holes) from a multipolygon relation', () => {
    const hole: Ring = [
      [72.8003, 18.9003],
      [72.8006, 18.9003],
      [72.8006, 18.9006],
      [72.8003, 18.9006],
      [72.8003, 18.9003],
    ];
    const outcome = processGeometry([SQUARE, hole]);
    expect(outcome.status).toBe('valid');
    if (outcome.status === 'valid') {
      expect(outcome.geoJson.coordinates[0]).toHaveLength(2); // outer + 1 hole
    }
  });

  it('rejects empty geometry (no rings at all)', () => {
    expect(processGeometry([])).toEqual({ status: 'rejected', reason: 'no geometry supplied' });
  });

  it('rejects a ring with too few points to form a polygon', () => {
    const outcome = processGeometry([
      [
        [72.8, 18.9],
        [72.801, 18.9],
      ],
    ]);
    expect(outcome.status).toBe('rejected');
  });

  it('rejects non-finite coordinates', () => {
    const bad: Ring = [
      [Number.NaN, 18.9],
      [72.801, 18.9],
      [72.801, 18.901],
      [72.8, 18.9],
    ];
    const outcome = processGeometry([bad]);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toContain('non-finite');
    }
  });

  it('rejects out-of-range longitude/latitude', () => {
    const bad: Ring = [
      [200, 18.9],
      [72.801, 18.9],
      [72.801, 18.901],
      [200, 18.9],
    ];
    const outcome = processGeometry([bad]);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toContain('out of range');
    }
  });

  it('rejects a degenerate ring (all points identical, zero area)', () => {
    const point = [72.8, 18.9] as const;
    const outcome = processGeometry([[point, point, point, point]]);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toContain('degenerate');
    }
  });

  it('rejects an empty ring within a non-empty rings array', () => {
    const outcome = processGeometry([[]]);
    expect(outcome.status).toBe('rejected');
  });
});
