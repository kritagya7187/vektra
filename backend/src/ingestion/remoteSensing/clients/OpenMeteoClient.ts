import type { Logger } from 'pino';
import { rootLogger } from '../../../logging';
import { fetchWithRetry } from '../../shared/httpRetry';
import type {
  MeteorologicalObservationClient,
  MeteorologicalObservationValue,
  MeteorologicalQuery,
} from '../types';

/**
 * Open-Meteo's real, public, unauthenticated Historical Weather (Archive)
 * API — https://archive-api.open-meteo.com/v1/archive — the one source
 * this subsystem can verify with a genuine end-to-end call (see this
 * subsystem's review), unlike the 4 raster sources which need
 * credentials this environment does not have.
 */
export interface OpenMeteoResponse {
  readonly hourly_units: Readonly<Record<string, string>>;
  readonly hourly: { readonly time: readonly string[] } & Readonly<
    Record<string, readonly (number | null)[]>
  >;
}

export interface OpenMeteoClientOptions {
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildRequestUrl(apiUrl: string, query: MeteorologicalQuery): string {
  const params = new URLSearchParams({
    latitude: String(query.latitude),
    longitude: String(query.longitude),
    start_date: formatDate(query.from),
    end_date: formatDate(query.to),
    hourly: query.variables.join(','),
    timezone: 'UTC',
  });
  return `${apiUrl}?${params.toString()}`;
}

/**
 * Extracts every (timestamp, variable) reading Open-Meteo returns —
 * metadata/values only, no interpolation or aggregation (this
 * subsystem's own brief, item 4). Open-Meteo represents a missing
 * reading as `null` in its hourly arrays; those are dropped here (there
 * is no valid value to register), not coerced to 0 or any other number.
 */
function parseResponse(
  body: OpenMeteoResponse,
  variables: readonly string[],
  logger: Logger,
): readonly MeteorologicalObservationValue[] {
  const values: MeteorologicalObservationValue[] = [];

  for (const variableName of variables) {
    const series = body.hourly[variableName];
    if (!series) {
      logger.warn({ variableName }, 'skipped variable: not present in Open-Meteo response');
      continue;
    }
    const unit = body.hourly_units[variableName] ?? 'unknown';

    body.hourly.time.forEach((isoTimestamp, index) => {
      const variableValue = series[index];
      if (variableValue === null || variableValue === undefined) {
        return;
      }
      values.push({
        timestamp: new Date(isoTimestamp),
        variableName,
        variableValue,
        variableUnit: unit,
      });
    });
  }

  return values;
}

export function createOpenMeteoClient(
  options: OpenMeteoClientOptions,
): MeteorologicalObservationClient {
  const logger =
    options.logger ?? rootLogger.child({ component: 'ingestion', client: 'open_meteo' });

  return {
    sourceCode: 'open_meteo',
    async fetchObservations(
      query: MeteorologicalQuery,
    ): Promise<readonly MeteorologicalObservationValue[]> {
      const requestUrl = buildRequestUrl(options.apiUrl, query);
      logger.info({ apiUrl: requestUrl }, 'downloading Open-Meteo observations');

      const response = await fetchWithRetry(
        requestUrl,
        { method: 'GET', headers: { Accept: 'application/json' } },
        {
          timeoutMs: options.timeoutMs,
          maxRetries: options.maxRetries,
          logger,
          serviceLabel: 'the Open-Meteo archive API',
        },
      );

      const body = (await response.json()) as OpenMeteoResponse;
      const values = parseResponse(body, query.variables, logger);

      logger.info({ count: values.length }, 'Open-Meteo observation download complete');
      return values;
    },
  };
}
