import type { Logger } from 'pino';
import { ExternalServiceError } from '../../errors';
import { rootLogger } from '../../logging';
import type { OsmElement, OverpassResponse } from '../types';

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

export interface OverpassClientOptions {
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

/** Internal only — never thrown past executeWithRetry(); see fetchElements()'s own note. */
class OverpassHttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'OverpassHttpError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attempt: number, retryAfterMs?: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return retryAfterMs !== undefined ? Math.max(exponential, retryAfterMs) : exponential;
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * Configurable endpoint/timeout/retry (this subsystem's own brief),
 * exponential backoff, HTTP-error-aware (4xx other than 429 is a client
 * error — retrying would just repeat the same failure — 5xx/429/timeout
 * are transient and retried), rate-limit-aware (honors a real
 * Retry-After header when Overpass sends one). Fails safely: every
 * failure path — network error, timeout, non-retryable HTTP status,
 * retries exhausted — surfaces as the existing ExternalServiceError,
 * never a raw fetch/AbortError leaking to a caller.
 *
 * Does not touch PostgreSQL — returns parsed OSM elements only. All
 * persistence happens in OsmIngestionService, through the repository
 * layer.
 */
export class OverpassClient {
  private readonly logger: Logger;

  constructor(private readonly options: OverpassClientOptions) {
    this.logger =
      options.logger ?? rootLogger.child({ component: 'ingestion', client: 'overpass' });
  }

  async fetchElements(query: string): Promise<readonly OsmElement[]> {
    this.logger.info({ apiUrl: this.options.apiUrl }, 'downloading OSM data from Overpass API');
    const response = await this.executeWithRetry(query);
    this.logger.info({ elementCount: response.elements.length }, 'download complete');
    return response.elements;
  }

  private async executeWithRetry(query: string): Promise<OverpassResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      try {
        return await this.executeOnce(query);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof OverpassHttpError ? err.retryable : true;
        const attemptsRemaining = attempt < this.options.maxRetries;

        if (!retryable || !attemptsRemaining) {
          break;
        }

        const retryAfterMs = err instanceof OverpassHttpError ? err.retryAfterMs : undefined;
        const delayMs = computeBackoffMs(attempt, retryAfterMs);
        this.logger.warn(
          { attempt: attempt + 1, maxRetries: this.options.maxRetries, delayMs, err },
          'Overpass request failed, retrying after backoff',
        );
        await sleep(delayMs);
      }
    }

    this.logger.error({ err: lastError }, 'Overpass request failed after all retries');
    throw new ExternalServiceError('Failed to download data from the Overpass API.', lastError);
  }

  private async executeOnce(query: string): Promise<OverpassResponse> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(this.options.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Discovered during real verification against the actual
          // public overpass-api.de: it does real content negotiation
          // and returns 406 Not Acceptable to Node's fetch (undici)
          // default headers — reproduced directly with plain fetch,
          // confirmed fixed by these two headers, before changing
          // anything. Accept: */* satisfies the negotiation; a real
          // User-Agent identifies the client to a public third-party
          // API, which is good practice regardless.
          Accept: '*/*',
          'User-Agent': 'vektra-backend-osm-ingestion/1.0 (+https://github.com/kritagya7187/vektra)',
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // 429 (rate limited) and 5xx (incl. Overpass's own 504 "server
        // too busy") are transient; any other 4xx is a client error
        // (e.g. malformed query) that retrying would not fix.
        const retryable = response.status === 429 || response.status >= 500;
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
        throw new OverpassHttpError(
          `Overpass API responded with HTTP ${response.status}.`,
          retryable,
          retryAfterMs,
        );
      }

      return (await response.json()) as OverpassResponse;
    } catch (err) {
      if (err instanceof OverpassHttpError) {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new OverpassHttpError(
          `Overpass request timed out after ${this.options.timeoutMs}ms.`,
          true,
        );
      }
      // A network-level failure (DNS, connection refused, etc.) — treat
      // as transient/retryable rather than assuming it is permanent.
      throw new OverpassHttpError('Network error contacting the Overpass API.', true);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
