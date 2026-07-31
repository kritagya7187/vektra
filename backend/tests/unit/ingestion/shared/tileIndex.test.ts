import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTileIndexRasterClient } from '../../../../src/ingestion/shared/tileIndex';

const silentLogger = pino({ level: 'silent' });

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createTileIndexRasterClient', () => {
  it('builds a GET request with a bbox query parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tiles: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createTileIndexRasterClient({
      sourceCode: 'esa_worldcover',
      apiUrl: 'https://tiles.test/index',
      timeoutMs: 5000,
      maxRetries: 0,
      defaultResolutionM: 10,
      serviceLabel: 'the test tile index',
      logger: silentLogger,
    });

    await client.fetchMetadata({
      bbox: { minLon: 72.8, minLat: 18.9, maxLon: 72.9, maxLat: 19.0 },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://tiles.test/index?bbox=72.8%2C18.9%2C72.9%2C19');
    expect(init.method).toBe('GET');
  });

  it('maps every tile into RasterDatasetMetadata, using defaultResolutionM when absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        tiles: [
          {
            tileId: 'N18E072',
            acquisitionDate: '2021-01-01T00:00:00Z',
            crs: 'EPSG:4326',
            downloadUrl: 'https://example.test/N18E072.tif',
            checksum: 'deadbeef',
            bbox: [72.0, 18.0, 73.0, 19.0],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createTileIndexRasterClient({
      sourceCode: 'srtm_dem',
      apiUrl: 'https://tiles.test/index',
      timeoutMs: 5000,
      maxRetries: 0,
      defaultResolutionM: 30,
      serviceLabel: 'the test tile index',
      logger: silentLogger,
    });

    const results = await client.fetchMetadata({
      bbox: { minLon: 72.0, minLat: 18.0, maxLon: 73.0, maxLat: 19.0 },
    });

    expect(results).toEqual([
      {
        sourceProductIdentifier: 'N18E072',
        acquisitionDate: new Date('2021-01-01T00:00:00Z'),
        crs: 'EPSG:4326',
        resolutionM: 30,
        storageLocation: 'https://example.test/N18E072.tif',
        spatialExtent: {
          type: 'Polygon',
          coordinates: [
            [
              [72.0, 18.0],
              [73.0, 18.0],
              [73.0, 19.0],
              [72.0, 19.0],
              [72.0, 18.0],
            ],
          ],
        },
        checksum: 'deadbeef',
      },
    ]);
  });

  it('skips a tile with a missing or malformed bbox', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        tiles: [
          {
            tileId: 'bad-tile',
            acquisitionDate: '2021-01-01T00:00:00Z',
            crs: 'EPSG:4326',
            downloadUrl: 'https://example.test/bad.tif',
            bbox: [72.0, 18.0], // malformed: only 2 values
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createTileIndexRasterClient({
      sourceCode: 'esa_worldcover',
      apiUrl: 'https://tiles.test/index',
      timeoutMs: 5000,
      maxRetries: 0,
      defaultResolutionM: 10,
      serviceLabel: 'the test tile index',
      logger: silentLogger,
    });

    const results = await client.fetchMetadata({
      bbox: { minLon: 72.0, minLat: 18.0, maxLon: 73.0, maxLat: 19.0 },
    });

    expect(results).toEqual([]);
  });
});
