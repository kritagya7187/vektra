import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalServiceError } from '../../../src/errors';
import { OverpassClient } from '../../../src/ingestion/osm/OverpassClient';

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

describe('OverpassClient', () => {
  it('returns elements on a successful first attempt, no retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ elements: [{ type: 'way', id: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OverpassClient({
      apiUrl: 'https://overpass.test/api/interpreter',
      timeoutMs: 5000,
      maxRetries: 3,
      logger: silentLogger,
    });

    const elements = await client.fetchElements('[out:json];');
    expect(elements).toEqual([{ type: 'way', id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POSTs the query as form-encoded data to the configured endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OverpassClient({
      apiUrl: 'https://overpass.test/api/interpreter',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    await client.fetchElements('[out:json];way["building"];');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://overpass.test/api/interpreter');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect((init.body as URLSearchParams).toString()).toContain('way%5B%22building%22%5D');
  });

  it('retries a 500 response with exponential backoff, then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ elements: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OverpassClient({
      apiUrl: 'https://overpass.test/api/interpreter',
      timeoutMs: 5000,
      maxRetries: 2,
      logger: silentLogger,
    });

    const promise = client.fetchElements('[out:json];');
    await vi.runAllTimersAsync();
    const elements = await promise;

    expect(elements).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 400 (client error) — fails immediately as ExternalServiceError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad query' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OverpassClient({
      apiUrl: 'https://overpass.test/api/interpreter',
      timeoutMs: 5000,
      maxRetries: 3,
      logger: silentLogger,
    });

    await expect(client.fetchElements('[out:json];')).rejects.toThrow(ExternalServiceError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respects Retry-After on a 429 response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ elements: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OverpassClient({
      apiUrl: 'https://overpass.test/api/interpreter',
      timeoutMs: 5000,
      maxRetries: 1,
      logger: silentLogger,
    });

    const promise = client.fetchElements('[out:json];');
    await vi.advanceTimersByTimeAsync(2000);
    const elements = await promise;
    expect(elements).toEqual([]);
  });

  it('fails safely as ExternalServiceError after exhausting all retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OverpassClient({
      apiUrl: 'https://overpass.test/api/interpreter',
      timeoutMs: 5000,
      maxRetries: 2,
      logger: silentLogger,
    });

    const promise = client.fetchElements('[out:json];');
    const assertion = expect(promise).rejects.toThrow(ExternalServiceError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('never leaks a raw network error — wraps it as ExternalServiceError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OverpassClient({
      apiUrl: 'https://overpass.test/api/interpreter',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });

    await expect(client.fetchElements('[out:json];')).rejects.toThrow(ExternalServiceError);
  });
});
