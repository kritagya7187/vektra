import type { NextFunction, Request, Response } from 'express';
import { AppError, InternalServerError, ValidationError, isAppError } from '../errors';
import { rootLogger } from '../logging';
import type { ApiErrorResponse } from '../types';
import { resolveLogLevelForStatus } from './logLevel';

/**
 * express.json() (registered in app.ts) throws this well-known,
 * documented shape — SyntaxError with status 400 and
 * type: 'entity.parse.failed' — when the request body isn't valid JSON.
 * Recognized here rather than falling through to a generic 500: this is
 * squarely a client error ("reject malformed JSON"), and the shape is a
 * stable contract of the body-parser package express.json() wraps, not
 * an assumption.
 */
function isJsonBodyParseError(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    'status' in err &&
    err.status === 400 &&
    'type' in err &&
    err.type === 'entity.parse.failed'
  );
}

/**
 * Item 5, "unknown error handling": anything that isn't already part of
 * the AppError hierarchy — a thrown string, a plain Error from some
 * third-party dependency, a genuine programming bug — is converted here
 * into a safe InternalServerError, with one recognized exception (JSON
 * body-parse failures, above). The original value is preserved only via
 * `cause`, for server-side logging.
 */
function toAppError(err: unknown): AppError {
  if (isAppError(err)) {
    return err;
  }
  if (isJsonBodyParseError(err)) {
    return new ValidationError('The request body is not valid JSON.', undefined, err);
  }
  return new InternalServerError('An unexpected error occurred.', err);
}

/**
 * The single centralized error-handling middleware. Must be mounted last
 * (Express recognizes error middleware by its 4-argument arity — `_next`
 * is required in the signature even though unused, or Express will treat
 * this as a normal middleware and never invoke it on error).
 *
 * Response schema is fixed and always 4 keys, regardless of error type or
 * runtime environment — a key that's sometimes present and sometimes
 * absent is exactly what breaks "stable/deterministic JSON structure."
 * `details` is populated only for ValidationError; every other type's
 * `details` (if any) is a server-side-only diagnostic, never returned.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = toAppError(err);
  const log = req.log ?? rootLogger;
  const level = resolveLogLevelForStatus(appError.statusCode);

  log[level](
    { err: appError, code: appError.code, statusCode: appError.statusCode },
    'request failed',
  );

  const body: ApiErrorResponse = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId: req.id ?? null,
      details: appError instanceof ValidationError ? (appError.details ?? null) : null,
    },
  };

  res.status(appError.statusCode).json(body);
}
