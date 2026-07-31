import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalServiceError } from '../../../../src/errors';
import { createOpenMeteoClient } from '../../../../src/ingestion/remoteSensing/clients/OpenMeteoClient';

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

const query = {
  latitude: 18.925,
  longitude: 72.8317,
  from: new Date('2025-01-01T00:00:00Z'),
  to: new Date('2025-01-02T00:00:00Z'),
  variables: ['temperature_2m', 'relative_humidity_2m'],
};

describe('createOpenMeteoClient', () => {
  it('sourceCode is open_meteo', () => {
    const client = createOpenMeteoClient({
      apiUrl: 'https://meteo.test/archive',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    expect(client.sourceCode).toBe('open_meteo');
  });

  it('builds a GET request with latitude/longitude/date range/hourly variables', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ hourly_units: {}, hourly: { time: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenMeteoClient({
      apiUrl: 'https://meteo.test/archive',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    await client.fetchObservations(query);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://meteo.test/archive?');
    expect(url).toContain('latitude=18.925');
    expect(url).toContain('longitude=72.8317');
    expect(url).toContain('start_date=2025-01-01');
    expect(url).toContain('end_date=2025-01-02');
    expect(url).toContain('hourly=temperature_2m%2Crelative_humidity_2m');
    expect(url).toContain('timezone=UTC');
    expect(init.method).toBe('GET');
  });

  it('extracts one observation per (timestamp, variable) pair, with the correct unit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        hourly_units: { temperature_2m: '°C', relative_humidity_2m: '%' },
        hourly: {
          time: ['2025-01-01T00:00', '2025-01-01T01:00'],
          temperature_2m: [24.5, 24.1],
          relative_humidity_2m: [80, 82],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenMeteoClient({
      apiUrl: 'https://meteo.test/archive',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    const values = await client.fetchObservations(query);

    expect(values).toEqual([
      {
        timestamp: new Date('2025-01-01T00:00'),
        variableName: 'temperature_2m',
        variableValue: 24.5,
        variableUnit: '°C',
      },
      {
        timestamp: new Date('2025-01-01T01:00'),
        variableName: 'temperature_2m',
        variableValue: 24.1,
        variableUnit: '°C',
      },
      {
        timestamp: new Date('2025-01-01T00:00'),
        variableName: 'relative_humidity_2m',
        variableValue: 80,
        variableUnit: '%',
      },
      {
        timestamp: new Date('2025-01-01T01:00'),
        variableName: 'relative_humidity_2m',
        variableValue: 82,
        variableUnit: '%',
      },
    ]);
  });

  it('drops null readings rather than coercing them to a number', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        hourly_units: { temperature_2m: '°C' },
        hourly: {
          time: ['2025-01-01T00:00', '2025-01-01T01:00'],
          temperature_2m: [24.5, null],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenMeteoClient({
      apiUrl: 'https://meteo.test/archive',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    const values = await client.fetchObservations({ ...query, variables: ['temperature_2m'] });

    expect(values).toHaveLength(1);
    expect(values[0].timestamp).toEqual(new Date('2025-01-01T00:00'));
  });

  it('skips a requested variable absent from the response entirely', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        hourly_units: { temperature_2m: '°C' },
        hourly: { time: ['2025-01-01T00:00'], temperature_2m: [24.5] },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenMeteoClient({
      apiUrl: 'https://meteo.test/archive',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });
    const values = await client.fetchObservations(query); // requests relative_humidity_2m too

    expect(values).toHaveLength(1);
    expect(values[0].variableName).toBe('temperature_2m');
  });

  it('never leaks a raw network error — wraps it as ExternalServiceError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenMeteoClient({
      apiUrl: 'https://meteo.test/archive',
      timeoutMs: 5000,
      maxRetries: 0,
      logger: silentLogger,
    });

    await expect(client.fetchObservations(query)).rejects.toThrow(ExternalServiceError);
  });
});
