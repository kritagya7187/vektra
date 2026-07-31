import pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  parseBuildingLevels,
  parseHeightMeters,
  parseOverpassResponse,
} from '../../../src/ingestion/osm/parseOverpassResponse';
import type { OverpassResponse } from '../../../src/ingestion/types';

const silentLogger = pino({ level: 'silent' });

describe('parseOverpassResponse', () => {
  it('extracts only the 8 documented attributes from a way element', () => {
    const response: OverpassResponse = {
      elements: [
        {
          type: 'way',
          id: 1001,
          tags: {
            building: 'house',
            'building:levels': '3',
            height: '9 m',
            'roof:shape': 'gabled',
            'roof:material': 'tile',
            'building:material': 'brick',
            name: 'Test House',
            'addr:street': 'Main Road',
            'addr:housenumber': '12',
            amenity: 'restaurant', // undocumented — must NOT be extracted
            shop: 'bakery', // undocumented — must NOT be extracted
          },
          geometry: [
            { lat: 18.9, lon: 72.8 },
            { lat: 18.9, lon: 72.801 },
            { lat: 18.901, lon: 72.801 },
            { lat: 18.901, lon: 72.8 },
          ],
        },
      ],
    };

    const candidates = parseOverpassResponse(response, silentLogger);
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate?.attributes).toEqual({
      building: 'house',
      buildingLevels: '3',
      height: '9 m',
      roofShape: 'gabled',
      roofMaterial: 'tile',
      buildingMaterial: 'brick',
      name: 'Test House',
      addressTags: { 'addr:street': 'Main Road', 'addr:housenumber': '12' },
    });
  });

  it('drops an element with no building tag', () => {
    const response: OverpassResponse = {
      elements: [{ type: 'way', id: 2, tags: { highway: 'residential' }, geometry: [] }],
    };
    expect(parseOverpassResponse(response, silentLogger)).toHaveLength(0);
  });

  it('drops a way element with no geometry', () => {
    const response: OverpassResponse = {
      elements: [{ type: 'way', id: 3, tags: { building: 'yes' } }],
    };
    expect(parseOverpassResponse(response, silentLogger)).toHaveLength(0);
  });

  it('extracts outer + inner rings from a multipolygon relation', () => {
    const response: OverpassResponse = {
      elements: [
        {
          type: 'relation',
          id: 500,
          tags: { building: 'yes', type: 'multipolygon' },
          members: [
            {
              type: 'way',
              ref: 1,
              role: 'outer',
              geometry: [
                { lat: 18.9, lon: 72.8 },
                { lat: 18.9, lon: 72.81 },
                { lat: 18.91, lon: 72.81 },
                { lat: 18.91, lon: 72.8 },
              ],
            },
            {
              type: 'way',
              ref: 2,
              role: 'inner',
              geometry: [
                { lat: 18.902, lon: 72.802 },
                { lat: 18.902, lon: 72.803 },
                { lat: 18.903, lon: 72.803 },
              ],
            },
          ],
        },
      ],
    };
    const candidates = parseOverpassResponse(response, silentLogger);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.rings).toHaveLength(2);
    // Overpass gives {lat,lon}; ring points must be [lon,lat] (GeoJSON order).
    expect(candidates[0]?.rings[0]?.[0]).toEqual([72.8, 18.9]);
  });
});

describe('parseHeightMeters', () => {
  it('parses a plain numeric string', () => {
    expect(parseHeightMeters('12')).toBe(12);
  });
  it('parses a value with a unit suffix', () => {
    expect(parseHeightMeters('12.5 m')).toBe(12.5);
  });
  it('returns null for unparseable input', () => {
    expect(parseHeightMeters('unknown')).toBeNull();
  });
  it('returns null for null input', () => {
    expect(parseHeightMeters(null)).toBeNull();
  });
});

describe('parseBuildingLevels', () => {
  it('parses a plain integer string', () => {
    expect(parseBuildingLevels('5')).toBe(5);
  });
  it('returns null for zero or negative (not a valid level count)', () => {
    expect(parseBuildingLevels('0')).toBeNull();
    expect(parseBuildingLevels('-1')).toBeNull();
  });
  it('returns null for unparseable input', () => {
    expect(parseBuildingLevels('many')).toBeNull();
  });
});
