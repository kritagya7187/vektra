import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const silentLogger = pino({ level: 'silent' });
const bbox = { minLon: 72.8, minLat: 18.9, maxLon: 72.9, maxLat: 19.0 };

/**
 * Phase 3 Milestone 2 rewrite: the earlier version of this file tested
 * createStacRasterClient/createTileIndexRasterClient wrappers, both
 * deleted this milestone once real verification showed neither matched
 * how any of these providers actually work (see Sentinel2Client.ts's own
 * header comment). These tests mock `fetch` to verify each client
 * constructs the real request shapes confirmed live during this
 * milestone's verification — they do not replace that live verification,
 * which exercised the real upstream services end to end.
 *
 * `../../../../src/config` is mocked directly, not via vi.stubEnv:
 * config is a module-level singleton whose fields are resolved once,
 * from process.env, at first import (config.ts) — by the time any test
 * body runs, that has already happened (unitTestEnv.ts's setupFiles run
 * first and never set these credentials), so stubbing process.env inside
 * a test body cannot retroactively change an already-frozen config
 * value. Mocking the module itself is the correct, standard fix for a
 * frozen-at-import-time singleton like this one.
 *
 * EsaWorldCoverClient.ts is deliberately not covered here: it reads via
 * geotiff.js's own `fromUrl`, an HTTP client abstraction one layer below
 * a simple `fetch` stub, and was instead verified with a real live round
 * trip (real S3 tile window read -> real re-encode -> real re-read of
 * the written file, confirming correct georeferencing) during this
 * milestone's implementation. Mocking geotiff.js's internals here would
 * test the mock, not the real integration.
 */

const mockConfig = {
  logging: { level: 'silent' },
  remoteSensing: {
    sentinelHubProcessApiUrl: 'https://sh.dataspace.copernicus.eu/api/v1/process',
    esaWorldCoverS3BaseUrl: 'https://esa-worldcover.s3.amazonaws.com',
    srtmDemApiUrl: 'https://portal.opentopography.org/API/globaldem',
    openMeteoApiUrl: 'https://archive-api.open-meteo.com/v1/archive',
    timeoutMs: 5000,
    maxRetries: 0,
  },
  copernicus: {
    clientId: undefined as string | undefined,
    clientSecret: undefined as string | undefined,
    tokenUrl:
      'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
  },
  openTopography: {
    apiKey: undefined as string | undefined,
  },
  rasterStorage: {
    dir: undefined as string | undefined,
  },
};

vi.mock('../../../../src/config', () => ({ config: mockConfig }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let tempStorageDir: string;

beforeAll(async () => {
  tempStorageDir = await mkdtemp(path.join(tmpdir(), 'vektra-raster-clients-test-'));
  mockConfig.rasterStorage.dir = tempStorageDir;
});

afterAll(async () => {
  await rm(tempStorageDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockConfig.copernicus.clientId = undefined;
  mockConfig.copernicus.clientSecret = undefined;
  mockConfig.openTopography.apiKey = undefined;
});

describe('SrtmDemClient', () => {
  it('sourceCode is srtm_dem; requests the real globaldem contract with the configured API key', async () => {
    mockConfig.openTopography.apiKey = 'test-key';
    const { createSrtmDemClient } =
      await import('../../../../src/ingestion/remoteSensing/clients/SrtmDemClient.js');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createSrtmDemClient({ timeoutMs: 5000, maxRetries: 0, logger: silentLogger });
    expect(client.sourceCode).toBe('srtm_dem');

    const results = await client.fetchMetadata({ bbox });
    expect(results).toHaveLength(1);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('demtype=SRTMGL3');
    expect(url).toContain('API_Key=test-key');
    expect(url).toContain(`south=${bbox.minLat}`);
    expect(url).toContain(`north=${bbox.maxLat}`);
  });

  it('throws a clear error rather than silently proceeding when no API key is configured', async () => {
    const { createSrtmDemClient } =
      await import('../../../../src/ingestion/remoteSensing/clients/SrtmDemClient.js');
    const client = createSrtmDemClient({ timeoutMs: 5000, maxRetries: 0, logger: silentLogger });
    await expect(client.fetchMetadata({ bbox })).rejects.toThrow(/OPENTOPOGRAPHY_API_KEY/);
  });
});

describe('Sentinel2Client', () => {
  it('sourceCode is sentinel2_l2a; authenticates, discovers via OData, extracts via the real Process API type S2L2A', async () => {
    mockConfig.copernicus.clientId = 'test-id';
    mockConfig.copernicus.clientSecret = 'test-secret';
    const { createSentinel2Client } =
      await import('../../../../src/ingestion/remoteSensing/clients/Sentinel2Client.js');

    const fetchMock = vi
      .fn()
      // 1. OData discovery (real call order: discovery needs no auth token,
      // so Sentinel2Client.ts calls it BEFORE requesting one — confirmed by
      // running this test with the wrong order first and reading the real
      // failure, not assumed)
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              Name: 'S2B_MSIL2A_TEST.SAFE',
              Id: 'test-id',
              ContentDate: { Start: '2026-06-10T05:36:39.024000Z' },
            },
          ],
        }),
      )
      // 2. OAuth2 token
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fake-token', expires_in: 1800 }))
      // 3. Process API extraction
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'Content-Type': 'image/tiff' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = createSentinel2Client({ timeoutMs: 5000, maxRetries: 0, logger: silentLogger });
    expect(client.sourceCode).toBe('sentinel2_l2a');

    const results = await client.fetchMetadata({ bbox });
    expect(results).toHaveLength(1);
    expect(results[0]?.sourceProductIdentifier).toBe('S2B_MSIL2A_TEST.SAFE');

    const [discoveryUrl] = fetchMock.mock.calls[0] as [string];
    expect(discoveryUrl).toContain('odata/v1/Products');
    expect(discoveryUrl).toContain('SENTINEL-2');
    expect(discoveryUrl).toContain('MSIL2A');

    const [tokenUrl] = fetchMock.mock.calls[1] as [string];
    expect(tokenUrl).toContain('identity.dataspace.copernicus.eu');

    const [processUrl, processInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(processUrl).toContain('sh.dataspace.copernicus.eu/api/v1/process');
    const body = JSON.parse(processInit.body as string) as { input: { data: [{ type: string }] } };
    expect(body.input.data[0].type).toBe('S2L2A');
  });

  it('returns an empty result (not an error) when no matching scene is found — an honest empty result, never fabricated', async () => {
    mockConfig.copernicus.clientId = 'test-id';
    mockConfig.copernicus.clientSecret = 'test-secret';
    const { createSentinel2Client } =
      await import('../../../../src/ingestion/remoteSensing/clients/Sentinel2Client.js');
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ value: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createSentinel2Client({ timeoutMs: 5000, maxRetries: 0, logger: silentLogger });
    const results = await client.fetchMetadata({ bbox });
    expect(results).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // stops after discovery finds nothing — never authenticates or reaches the Process API step
  });
});

describe('LandsatClient', () => {
  it('sourceCode is landsat_c2_l2; uses the real confirmed Process API type landsat-ot-l2', async () => {
    mockConfig.copernicus.clientId = 'test-id';
    mockConfig.copernicus.clientSecret = 'test-secret';
    const { createLandsatClient } =
      await import('../../../../src/ingestion/remoteSensing/clients/LandsatClient.js');
    const fetchMock = vi
      .fn()
      // Discovery first (no auth needed), then auth, then extraction —
      // same real order as Sentinel2Client.
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              Name: 'LC08_TEST',
              Id: 'test-id',
              ContentDate: { Start: '2026-06-10T05:36:39.000Z' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fake-token', expires_in: 1800 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2]), {
          status: 200,
          headers: { 'Content-Type': 'image/tiff' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = createLandsatClient({ timeoutMs: 5000, maxRetries: 0, logger: silentLogger });
    expect(client.sourceCode).toBe('landsat_c2_l2');

    await client.fetchMetadata({ bbox });

    const [, processInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(processInit.body as string) as { input: { data: [{ type: string }] } };
    expect(body.input.data[0].type).toBe('landsat-ot-l2');
  });
});
