/**
 * Step 19 Part F: translates an HTTP response from the flood-engine
 * service into this backend's existing AppError hierarchy.
 *
 * No new error type is introduced -- every status flood-engine's own
 * FastAPI layer can return already has a real, existing fit:
 *
 *   400/422 (validation)        -> ValidationError (400)
 *   404 (not found)             -> NotFoundError (404)
 *   409 (state conflict)        -> ConflictError (409)
 *   500 (internal/persistence)  -> ExternalServiceError (502)
 *   timeout / network failure   -> ExternalServiceError (502)
 *
 * 422 maps to ValidationError, not a separate type: FastAPI's own
 * request-validation failures and this backend's own Zod validation
 * failures are the same *category* of problem from a caller's
 * perspective ("the request was malformed"), and ValidationError is
 * already the type this codebase uses for exactly that category
 * (validators/*.ts).
 *
 * The message returned to this backend's own client is always a short,
 * generic string built here -- never the raw response body forwarded
 * verbatim. flood-engine's own `detail` field is itself already
 * sanitized (its exception handlers never return a stack trace, see
 * `flood_engine.api.app`'s own docstring), but this function does not
 * rely on that alone: composing the message locally is what
 * structurally guarantees "no Python stack traces" regardless of what
 * flood-engine ever sends, matching this backend's own
 * ExternalServiceError precedent (message is always generic; the real
 * detail travels only via `cause`, for server-side logging).
 */

import { ConflictError, ExternalServiceError, NotFoundError, ValidationError } from '../errors';

/** flood-engine's real error body shape (FastAPI's default HTTPException/validation-error envelope). */
interface FloodEngineErrorBody {
  readonly detail?: unknown;
}

function extractDetail(body: unknown): string | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    'detail' in body &&
    typeof (body as FloodEngineErrorBody).detail === 'string'
  ) {
    return (body as FloodEngineErrorBody).detail as string;
  }
  return undefined;
}

/**
 * Builds the right AppError subclass for a real, received flood-engine
 * HTTP response. `body` is whatever this backend's own client already
 * parsed (or `undefined` if the body wasn't valid JSON) -- this function
 * performs no I/O itself.
 */
export function translateFloodEngineHttpError(
  status: number,
  body: unknown,
  cause?: unknown,
): Error {
  const detail = extractDetail(body);

  switch (status) {
    case 400:
    case 422:
      return new ValidationError(
        detail ?? 'The flood simulation engine rejected the request as invalid.',
        undefined,
        cause,
      );
    case 404:
      return new NotFoundError(detail ?? 'The requested simulation run was not found.', cause);
    case 409:
      return new ConflictError(
        detail ?? 'The simulation run is not in a state that allows this operation.',
        cause,
      );
    default:
      return new ExternalServiceError(
        'The flood simulation engine returned an unexpected error.',
        cause,
      );
  }
}

/** Part F: a request that timed out or failed at the network layer (DNS, connection refused, ...) — never the caller's fault. */
export function translateFloodEngineNetworkError(cause: unknown, timedOut: boolean): Error {
  return new ExternalServiceError(
    timedOut
      ? 'The flood simulation engine did not respond in time.'
      : 'Failed to reach the flood simulation engine.',
    cause,
  );
}
