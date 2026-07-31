import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bboxToPolygon,
  createStacRasterClient,
  isStacParseFailure,
  parseStacItemCollection,
  type StacItemCollection,
} from '../../../../src/ingestion/shared/stac';

const silentLogger = pino({ level: 'silent' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bboxToPolygon', () => {
  it('produces a closed 5-point ring covering the bbox', () => {
    const polygon = bboxToPolygon([72.8, 18.9, 72.9, 19.0]);
    expect(polygon.type).toBe('Polygon');
    const ring = polygon.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]); // closed
    expect(ring).toEqual([
      [72.8, 18.9],
      [72.9, 18.9],
      [72.9, 19.0],
      [72.8, 19.0],
      [72.8, 18.9],
    ]);
  });
});

describe('parseStacItemCollection', () => {
  it('extracts metadata from an item with a Polygon geometry', () => {
    const collection: StacItemCollection = {
      type: 'FeatureCollection',
      features: [
        {
          id: 'scene-1',
          properties: { datetime: '2025-01-15T10:00:00Z', 'proj:epsg': 32643, gsd: 10 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [72.8, 18.9],
                [72.9, 18.9],
                [72.9, 19.0],
                [72.8, 19.0],
                [72.8, 18.9],
              ],
            ],
          },
          assets: {
            visual: { href: 'https://example.test/scene-1.tif', 'checksum:multihash': 'abc123' },
          },
        },
      ],
    };

    const results = parseStacItemCollection(collection, 10);
    expect(results).toHaveLength(1);
    const [result] = results;
    expect(isStacParseFailure(result)).toBe(false);
    if (!isStacParseFailure(result)) {
      expect(result.sourceProductIdentifier).toBe('scene-1');
      expect(result.crs).toBe('EPSG:32643');
      expect(result.resolutionM).toBe(10);
      expect(result.storageLocation).toBe('https://example.test/scene-1.tif');
      expect(result.checksum).toBe('abc123');
    }
  });

  it('falls back to the item bbox when there is no Polygon geometry', () => {
    const collection: StacItemCollection = {
      type: 'FeatureCollection',
      features: [
        {
          id: 'scene-2',
          properties: { datetime: '2025-01-15T10:00:00Z' },
          bbox: [72.8, 18.9, 72.9, 19.0],
          assets: { data: { href: 'https://example.test/scene-2.tif' } },
        },
      ],
    };

    const [result] = parseStacItemCollection(collection, 30);
    expect(isStacParseFailure(result)).toBe(false);
    if (!isStacParseFailure(result)) {
      expect(result.spatialExtent.coordinates[0]).toHaveLength(5);
      expect(result.crs).toBe('EPSG:4326'); // default when proj:epsg absent
      expect(result.resolutionM).toBe(30); // default when gsd absent
    }
  });

  it('reports a parse failure for an item with neither geometry nor bbox', () => {
    const collection: StacItemCollection = {
      type: 'FeatureCollection',
      features: [{ id: 'scene-3', properties: { datetime: '2025-01-15T10:00:00Z' } }],
    };

    const [result] = parseStacItemCollection(collection, 10);
    expect(isStacParseFailure(result)).toBe(true);
    if (isStacParseFailure(result)) {
      expect(result.id).toBe('scene-3');
      expect(result.reason).toMatch(/no usable geometry/);
    }
  });

  it('reports a parse failure for an item with no assets', () => {
    const collection: StacItemCollection = {
      type: 'FeatureCollection',
      features: [
        {
          id: 'scene-4',
          properties: { datetime: '2025-01-15T10:00:00Z' },
          bbox: [72.8, 18.9, 72.9, 19.0],
        },
      ],
    };

    const [result] = parseStacItemCollection(collection, 10);
    expect(isStacParseFailure(result)).toBe(true);
    if (isStacParseFailure(result)) {
      expect(result.reason).toMatch(/no assets/);
    }
  });
});

describe('createStacRasterClient', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('builds a GET search URL with bbox, collections, and datetime range', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ type: 'FeatureCollection', features: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createStacRasterClient({
      sourceCode: 'sentinel2_l2a',
      apiUrl: 'https://stac.test',
      timeoutMs: 5000,
      maxRetries: 0,
      collectionName: 'sentinel-2-l2a',
      defaultResolutionM: 10,
      serviceLabel: 'the test STAC catalog',
      logger: silentLogger,
    });

    await client.fetchMetadata({
      bbox: { minLon: 72.8, minLat: 18.9, maxLon: 72.9, maxLat: 19.0 },
      dateRange: { from: new Date('2025-01-01T00:00:00Z'), to: new Date('2025-01-31T00:00:00Z') },
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('https://stac.test/search?');
    expect(url).toContain('bbox=72.8%2C18.9%2C72.9%2C19');
    expect(url).toContain('collections=sentinel-2-l2a');
    expect(url).toContain('datetime=2025-01-01T00%3A00%3A00.000Z%2F2025-01-31T00%3A00%3A00.000Z');
  });

  it('skips unparseable items and returns only valid metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        type: 'FeatureCollection',
        features: [
          { id: 'bad', properties: { datetime: '2025-01-01T00:00:00Z' } },
          {
            id: 'good',
            properties: { datetime: '2025-01-01T00:00:00Z' },
            bbox: [72.8, 18.9, 72.9, 19.0],
            assets: { data: { href: 'https://example.test/good.tif' } },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createStacRasterClient({
      sourceCode: 'landsat_c2_l2',
      apiUrl: 'https://stac.test',
      timeoutMs: 5000,
      maxRetries: 0,
      collectionName: 'landsat-c2l2-sr',
      defaultResolutionM: 30,
      serviceLabel: 'the test STAC catalog',
      logger: silentLogger,
    });

    const results = await client.fetchMetadata({
      bbox: { minLon: 72.8, minLat: 18.9, maxLon: 72.9, maxLat: 19.0 },
    });

    expect(results).toHaveLength(1);
    expect(results[0].sourceProductIdentifier).toBe('good');
  });
});
