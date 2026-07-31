import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalServiceError } from '../../../../src/errors';
import { fetchWithRetry } from '../../../../src/ingestion/shared/httpRetry';

const silentLogger = pino({ level: 'silent' });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Direct tests of the shared retry/backoff primitive itself — extracted
 * from OverpassClient (which already exercises this logic indirectly,
 * unchanged, via its own 32/32 passing suite after the refactor). These
 * tests exist so the primitive has its own coverage independent of any
 * one caller, since RasterAssetIngestionService's 4 clients and
 * OpenMeteoClient all depend on it too.
 */
describe('fetchWithRetry', () => {
  it('returns the response on a successful first attempt, no retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry(
      'https://example.test/api',
      { method: 'GET' },
      { timeoutMs: 5000, maxRetries: 3, logger: silentLogger, serviceLabel: 'the test API' },
    );

    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 500 response with exponential backoff, then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry(
      'https://example.test/api',
      { method: 'GET' },
      { timeoutMs: 5000, maxRetries: 2, logger: silentLogger, serviceLabel: 'the test API' },
    );
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 404 (non-429 client error) — fails immediately as ExternalServiceError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithRetry(
        'https://example.test/api',
        { method: 'GET' },
        { timeoutMs: 5000, maxRetries: 3, logger: silentLogger, serviceLabel: 'the test API' },
      ),
    ).rejects.toThrow(ExternalServiceError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respects Retry-After on a 429 response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry(
      'https://example.test/api',
      { method: 'GET' },
      { timeoutMs: 5000, maxRetries: 1, logger: silentLogger, serviceLabel: 'the test API' },
    );
    await vi.advanceTimersByTimeAsync(2000);
    const response = await promise;
    expect(await response.json()).toEqual({ ok: true });
  });

  it('fails safely as ExternalServiceError after exhausting all retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry(
      'https://example.test/api',
      { method: 'GET' },
      { timeoutMs: 5000, maxRetries: 2, logger: silentLogger, serviceLabel: 'the test API' },
    );
    const assertion = expect(promise).rejects.toThrow(ExternalServiceError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('never leaks a raw network error — wraps it as ExternalServiceError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithRetry(
        'https://example.test/api',
        { method: 'GET' },
        { timeoutMs: 5000, maxRetries: 0, logger: silentLogger, serviceLabel: 'the test API' },
      ),
    ).rejects.toThrow(ExternalServiceError);
  });
});
