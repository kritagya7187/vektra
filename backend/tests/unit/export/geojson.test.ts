import { describe, expect, it } from 'vitest';
import { toFeatureCollection } from '../../../src/export/geojson';
import type { GeoJsonPoint } from '../../../src/types/geometry';

interface Row {
  readonly id: string;
  readonly location: GeoJsonPoint;
  readonly label: string;
}

describe('toFeatureCollection', () => {
  it('produces a valid RFC 7946 FeatureCollection shape', () => {
    const rows: Row[] = [
      { id: '1', location: { type: 'Point', coordinates: [72.8, 18.9] }, label: 'a' },
      { id: '2', location: { type: 'Point', coordinates: [72.9, 19.0] }, label: 'b' },
    ];

    const fc = toFeatureCollection(
      rows,
      (r) => r.location,
      (r) => ({ id: r.id, label: r.label }),
    );

    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    for (const feature of fc.features) {
      expect(feature.type).toBe('Feature');
    }
    expect(fc.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [72.8, 18.9] });
    expect(fc.features[0]?.properties).toEqual({ id: '1', label: 'a' });
  });

  it('produces an empty features array for zero rows, still a valid FeatureCollection', () => {
    const fc = toFeatureCollection<Row, { id: string }>(
      [],
      (r) => r.location,
      (r) => ({ id: r.id }),
    );
    expect(fc).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('round-trips through real JSON.stringify/parse without losing structure', () => {
    const rows: Row[] = [{ id: '1', location: { type: 'Point', coordinates: [1, 2] }, label: 'a' }];
    const fc = toFeatureCollection(
      rows,
      (r) => r.location,
      (r) => ({ id: r.id }),
    );
    const roundTripped: unknown = JSON.parse(JSON.stringify(fc));
    expect(roundTripped).toEqual(fc);
  });
});
