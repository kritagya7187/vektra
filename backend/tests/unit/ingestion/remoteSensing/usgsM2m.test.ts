import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUsgsM2mApiKey } from '../../../../src/ingestion/remoteSensing/clients/usgsM2mAuth';
import { findMostRecentLandsatScene } from '../../../../src/ingestion/remoteSensing/clients/usgsM2mSceneSearch';

const silentLogger = pino({ level: 'silent' });
const bbox = { minLon: 72.8, minLat: 18.9, maxLon: 72.9, maxLat: 19.0 };

/**
 * Verifies the exact request/response shapes confirmed live during this
 * milestone: a real login-token exchange and a real scene-search against
 * "landsat_ot_c2_l2" both succeeded with a real USGS EROS account.
 * download-options (the next real step) returned a real 403 from what
 * appears to be a separate USGS access tier — no code exists for that
 * step, so no test exists for it either; testing an unverified,
 * currently-inaccessible request shape would just be encoding a guess.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getUsgsM2mApiKey', () => {
  it('exchanges username + application token for a real API key via the real login-token contract', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: 'fake-api-key', errorCode: null, errorMessage: null }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const apiKey = await getUsgsM2mApiKey({
      username: 'test-user',
      applicationToken: 'test-token',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });

    expect(apiKey).toBe('fake-api-key');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://m2m.cr.usgs.gov/api/api/json/stable/login-token');
    const body = JSON.parse(init.body as string) as { username: string; token: string };
    expect(body).toEqual({ username: 'test-user', token: 'test-token' });
  });

  it('throws a clear error rather than silently proceeding when credentials are missing', async () => {
    await expect(
      getUsgsM2mApiKey({
        username: undefined,
        applicationToken: undefined,
        timeoutMs: 5000,
        maxRetries: 0,
        logger: silentLogger,
      }),
    ).rejects.toThrow(/USGS_EROS_USERNAME/);
  });

  it('surfaces a real M2M errorCode rather than masking it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: null, errorCode: 'AUTH_INVALID', errorMessage: 'Invalid token' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getUsgsM2mApiKey({
        username: 'test-user',
        applicationToken: 'bad-token',
        timeoutMs: 5000,
        maxRetries: 0,
        logger: silentLogger,
      }),
    ).rejects.toThrow(/AUTH_INVALID/);
  });
});

describe('findMostRecentLandsatScene', () => {
  it('queries the real confirmed dataset landsat_ot_c2_l2 with the real mbr spatial filter shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          totalHits: 58,
          results: [
            {
              entityId: 'LC81480472026199LGN00',
              displayId: 'LC08_L2SP_148047_20260718_20260724_02_T2',
              temporalCoverage: { startDate: '2026-07-18 00:00:00' },
              cloudCover: 20,
            },
          ],
        },
        errorCode: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const scene = await findMostRecentLandsatScene({
      apiKey: 'fake-api-key',
      bbox,
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });

    expect(scene).toEqual({
      entityId: 'LC81480472026199LGN00',
      displayId: 'LC08_L2SP_148047_20260718_20260724_02_T2',
      acquisitionDate: new Date('2026-07-18 00:00:00'),
      cloudCover: 20,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://m2m.cr.usgs.gov/api/api/json/stable/scene-search');
    expect((init.headers as Record<string, string>)['X-Auth-Token']).toBe('fake-api-key');
    const body = JSON.parse(init.body as string) as {
      datasetName: string;
      sceneFilter: { spatialFilter: { filterType: string } };
    };
    expect(body.datasetName).toBe('landsat_ot_c2_l2');
    expect(body.sceneFilter.spatialFilter.filterType).toBe('mbr');
  });

  it('returns null (not an error) when no scene is found — an honest empty result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { totalHits: 0, results: [] }, errorCode: null }));
    vi.stubGlobal('fetch', fetchMock);

    const scene = await findMostRecentLandsatScene({
      apiKey: 'fake-api-key',
      bbox,
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    expect(scene).toBeNull();
  });
});
