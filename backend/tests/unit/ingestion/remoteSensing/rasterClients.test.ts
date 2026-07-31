import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEsaWorldCoverClient } from '../../../../src/ingestion/remoteSensing/clients/EsaWorldCoverClient';
import { createLandsatClient } from '../../../../src/ingestion/remoteSensing/clients/LandsatClient';
import { createSentinel2Client } from '../../../../src/ingestion/remoteSensing/clients/Sentinel2Client';
import { createSrtmDemClient } from '../../../../src/ingestion/remoteSensing/clients/SrtmDemClient';

const silentLogger = pino({ level: 'silent' });

afterEach(() => {
  vi.unstubAllGlobals();
});

function emptyStacResponse(): Response {
  return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyTileIndexResponse(): Response {
  return new Response(JSON.stringify({ tiles: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const bbox = { minLon: 72.8, minLat: 18.9, maxLon: 72.9, maxLat: 19.0 };

/**
 * These wrappers (Sentinel2Client.ts, LandsatClient.ts, EsaWorldCoverClient.ts,
 * SrtmDemClient.ts) are thin configuration over createStacRasterClient/
 * createTileIndexRasterClient — already covered generically by
 * shared/stac.test.ts and shared/tileIndex.test.ts. These tests only
 * confirm each wrapper wires the RIGHT sourceCode/collection/apiUrl
 * through, not the shared parsing logic again.
 */
describe('raster client wrappers', () => {
  it('Sentinel2Client: sourceCode sentinel2_l2a, queries the sentinel-2-l2a collection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStacResponse());
    vi.stubGlobal('fetch', fetchMock);

    const client = createSentinel2Client({
      apiUrl: 'https://sentinel.test',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    expect(client.sourceCode).toBe('sentinel2_l2a');

    await client.fetchMetadata({ bbox });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('https://sentinel.test/search?');
    expect(url).toContain('collections=sentinel-2-l2a');
  });

  it('LandsatClient: sourceCode landsat_c2_l2, queries the landsat-c2l2-sr collection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStacResponse());
    vi.stubGlobal('fetch', fetchMock);

    const client = createLandsatClient({
      apiUrl: 'https://landsat.test',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    expect(client.sourceCode).toBe('landsat_c2_l2');

    await client.fetchMetadata({ bbox });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('https://landsat.test/search?');
    expect(url).toContain('collections=landsat-c2l2-sr');
  });

  it('EsaWorldCoverClient: sourceCode esa_worldcover, queries the configured tile index URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyTileIndexResponse());
    vi.stubGlobal('fetch', fetchMock);

    const client = createEsaWorldCoverClient({
      apiUrl: 'https://worldcover.test/index',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    expect(client.sourceCode).toBe('esa_worldcover');

    await client.fetchMetadata({ bbox });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('https://worldcover.test/index?bbox=');
  });

  it('SrtmDemClient: sourceCode srtm_dem, queries the configured tile index URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyTileIndexResponse());
    vi.stubGlobal('fetch', fetchMock);

    const client = createSrtmDemClient({
      apiUrl: 'https://srtm.test/index',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    expect(client.sourceCode).toBe('srtm_dem');

    await client.fetchMetadata({ bbox });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('https://srtm.test/index?bbox=');
  });
});
