/**
 * Step 19 Parts B/F: retry-with-backoff HTTP fetch for the flood-engine client.
 *
 * Deliberately not `ingestion/shared/httpRetry.ts`'s `fetchWithRetry`,
 * despite the near-identical retry/backoff shape: that function
 * collapses every failure (any non-2xx status, a timeout, a network
 * error, retries exhausted) into a single generic `ExternalServiceError`
 * -- correct for its own callers (ingestion clients, which only ever
 * need "did this external fetch succeed or not"), but Part F of Step 19
 * requires *distinguishing* 400/404/409/422/500/timeout/network-failure
 * from each other so a caller can react correctly (e.g. retrying a 409
 * conflict is never useful; retrying a timeout usually is). Reusing
 * `fetchWithRetry` would lose exactly the information this module exists
 * to preserve. The retry/backoff *mechanism* is intentionally the same
 * shape as that module (same rationale: 429/5xx are transient, other 4xx
 * are not) -- this is convergent design on a well-understood pattern,
 * not a copy of business logic.
 */

import type { Logger } from 'pino';
import { translateFloodEngineHttpError, translateFloodEngineNetworkError } from './errors';

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

export interface FloodEngineHttpOptions {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger: Logger;
}

export interface FloodEngineHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  /** The raw body bytes — callers decide whether to JSON.parse or use as-is (e.g. a downloaded .npy file). */
  readonly body: Buffer;
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function tryParseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** Internal only — never thrown past floodEngineFetch(). */
class NetworkFailure extends Error {
  constructor(
    readonly cause: unknown,
    readonly timedOut: boolean,
  ) {
    super('flood-engine network failure');
    this.name = 'NetworkFailure';
  }
}

async function executeOnce(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<FloodEngineHttpResponse> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, body };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    throw new NetworkFailure(err, timedOut);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Performs one logical request, retrying transient failures
 * (429/5xx/timeout/network error) with exponential backoff, and throwing
 * the correctly-translated `AppError` subclass (Part F) on final
 * failure. A non-retryable 4xx status is translated and thrown
 * immediately, without consuming a retry attempt — matching
 * `fetchWithRetry`'s own "retrying would not fix this" reasoning.
 */
export async function floodEngineFetch(
  url: string,
  init: RequestInit,
  options: FloodEngineHttpOptions,
): Promise<FloodEngineHttpResponse> {
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    const attemptsRemaining = attempt < options.maxRetries;

    let response: FloodEngineHttpResponse;
    try {
      response = await executeOnce(url, init, options.timeoutMs);
    } catch (err) {
      if (!(err instanceof NetworkFailure)) {
        throw err; // pragma: defensive — executeOnce only ever throws NetworkFailure
      }
      if (!attemptsRemaining) {
        throw translateFloodEngineNetworkError(err.cause, err.timedOut);
      }
      const delayMs = computeBackoffMs(attempt);
      options.logger.warn(
        { attempt: attempt + 1, maxRetries: options.maxRetries, delayMs, timedOut: err.timedOut },
        'flood-engine request failed, retrying after backoff',
      );
      await sleep(delayMs);
      continue;
    }

    if (response.status >= 200 && response.status < 300) {
      return response;
    }

    if (!isRetryableStatus(response.status) || !attemptsRemaining) {
      throw translateFloodEngineHttpError(response.status, tryParseJson(response.body));
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    const delayMs = computeBackoffMs(attempt, retryAfterMs);
    options.logger.warn(
      { attempt: attempt + 1, maxRetries: options.maxRetries, delayMs, status: response.status },
      'flood-engine request failed, retrying after backoff',
    );
    await sleep(delayMs);
  }

  // Unreachable: every iteration above either returns or throws before
  // the loop can exit normally (the final attempt's !attemptsRemaining
  // branches always throw). Kept only to satisfy the compiler's
  // control-flow analysis, which cannot prove that statically.
  throw translateFloodEngineNetworkError(undefined, false);
}
