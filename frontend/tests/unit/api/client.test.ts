import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/errors';
import { getJson, getRawJson, postJson } from '../../../src/api/client';
afterEach(() => {
  vi.unstubAllGlobals();
});
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
describe('getJson', () => {
  it('unwraps the {data} envelope on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { id: '1' } })));
    const result = await getJson<{
      id: string;
    }>('/api/buildings/1');
    expect(result).toEqual({ id: '1' });
  });
  it('sends query params and resolves the URL against config.apiBaseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await getJson('/api/buildings', { limit: '10', offset: '0' });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/api/buildings?');
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=0');
  });
  it('throws an ApiError with the real backend error taxonomy code, message, and requestId on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'NOT_FOUND',
              message: "Building 'x' not found.",
              requestId: 'req-1',
              details: null,
            },
          },
          404,
        ),
      ),
    );
    await expect(getJson('/api/buildings/x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: "Building 'x' not found.",
      status: 404,
      requestId: 'req-1',
    });
  });
  it('preserves ValidationError details from the backend envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request.',
              requestId: 'req-2',
              details: [{ path: 'name', message: 'Required' }],
            },
          },
          400,
        ),
      ),
    );
    try {
      await getJson('/api/scenarios');
      expect.unreachable('expected getJson to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).details).toEqual([{ path: 'name', message: 'Required' }]);
    }
  });
  it('maps an error code the client does not recognize to UNKNOWN_ERROR rather than crashing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: 'SOME_FUTURE_CODE', message: 'x', requestId: null, details: null } },
            500,
          ),
        ),
    );
    await expect(getJson('/api/buildings')).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
  });
  it('produces a NETWORK_ERROR when fetch itself rejects (no response ever received)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(getJson('/api/buildings')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: null,
    });
  });
  it('produces UNKNOWN_ERROR for a non-ok response with a body that is not the error envelope shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 })),
    );
    await expect(getJson('/api/buildings')).rejects.toMatchObject({
      code: 'UNKNOWN_ERROR',
      status: 502,
    });
  });
  it('produces UNKNOWN_ERROR when a 200 response has no data envelope at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ notData: true })));
    await expect(getJson('/api/buildings')).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
  });
});
describe('postJson', () => {
  it('sends the body as JSON with the correct method and content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { scenarioId: 's1' } }));
    vi.stubGlobal('fetch', fetchMock);
    await postJson('/api/scenarios', { name: 'Test' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'Test' }));
  });
});
describe('getRawJson', () => {
  it('returns the raw body directly, NOT unwrapped from a {data} envelope (export endpoints have no envelope)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ type: 'FeatureCollection', features: [] })),
    );
    const result = await getRawJson<{
      type: string;
    }>('/api/buildings/export');
    expect(result).toEqual({ type: 'FeatureCollection', features: [] });
  });
  it('still throws a properly-shaped ApiError on a non-ok export response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'boom',
              requestId: null,
              details: null,
            },
          },
          500,
        ),
      ),
    );
    await expect(getRawJson('/api/buildings/export')).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});
