import type { Logger } from 'pino';
import { ExternalServiceError } from '../../errors';

/**
 * Generic retry-with-exponential-backoff HTTP fetch — extracted from
 * ingestion/osm/OverpassClient.ts (Remote Sensing Ingestion subsystem)
 * once a second real caller (the remote-sensing clients) needed the
 * identical logic. OverpassClient itself was refactored to use this
 * rather than keep its own private copy — "avoid duplicated
 * infrastructure" is this subsystem's own explicit instruction, and the
 * OSM ingestion test suite was re-run afterward to confirm no behavior
 * change.
 *
 * Deliberately returns the raw Response on success rather than parsing
 * a body — callers parse differently (Overpass JSON, STAC JSON, a
 * simple tile index, Open-Meteo's own shape), and this function has no
 * business knowing any of those shapes.
 */

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

export interface FetchWithRetryOptions {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger: Logger;
  /** Used only in log lines and the final error message, e.g. "Overpass API", "Sentinel-2 STAC catalog". */
  readonly serviceLabel: string;
}

/** Internal only — never thrown past fetchWithRetry(); see its own note. */
class RetryableHttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RetryableHttpError';
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

async function executeOnce(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  serviceLabel: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });

    if (!response.ok) {
      // 429 (rate limited) and 5xx are transient; any other 4xx is a
      // client error (bad request/auth/not found) that retrying would
      // not fix.
      const retryable = response.status === 429 || response.status >= 500;
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      throw new RetryableHttpError(
        `${serviceLabel} responded with HTTP ${response.status}.`,
        retryable,
        retryAfterMs,
      );
    }

    return response;
  } catch (err) {
    if (err instanceof RetryableHttpError) {
      throw err;
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new RetryableHttpError(`${serviceLabel} request timed out after ${timeoutMs}ms.`, true);
    }
    // A network-level failure (DNS, connection refused, etc.) — treat as
    // transient/retryable rather than assuming it is permanent.
    throw new RetryableHttpError(`Network error contacting ${serviceLabel}.`, true);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Fails safely: every failure path — network error, timeout,
 * non-retryable HTTP status, retries exhausted — surfaces as the
 * existing ExternalServiceError, never a raw fetch/AbortError leaking
 * to a caller.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await executeOnce(url, init, options.timeoutMs, options.serviceLabel);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof RetryableHttpError ? err.retryable : true;
      const attemptsRemaining = attempt < options.maxRetries;

      if (!retryable || !attemptsRemaining) {
        break;
      }

      const retryAfterMs = err instanceof RetryableHttpError ? err.retryAfterMs : undefined;
      const delayMs = computeBackoffMs(attempt, retryAfterMs);
      options.logger.warn(
        { attempt: attempt + 1, maxRetries: options.maxRetries, delayMs, err },
        `${options.serviceLabel} request failed, retrying after backoff`,
      );
      await sleep(delayMs);
    }
  }

  options.logger.error(
    { err: lastError },
    `${options.serviceLabel} request failed after all retries`,
  );
  throw new ExternalServiceError(`Failed to reach ${options.serviceLabel}.`, lastError);
}
