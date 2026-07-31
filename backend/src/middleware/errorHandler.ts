import type { NextFunction, Request, Response } from 'express';
import { AppError, InternalServerError, ValidationError, isAppError } from '../errors';
import { rootLogger } from '../logging';
import { resolveLogLevelForStatus } from './logLevel';

interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string | null;
    readonly details: unknown;
  };
}

/**
 * Item 5, "unknown error handling": anything that isn't already part of
 * the AppError hierarchy — a thrown string, a plain Error from some
 * third-party dependency, a genuine programming bug — is converted here
 * into a safe InternalServerError. The original value is preserved only
 * via `cause`, for server-side logging.
 */
function toAppError(err: unknown): AppError {
  if (isAppError(err)) {
    return err;
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

  const body: ErrorResponseBody = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId: req.id ?? null,
      details: appError instanceof ValidationError ? (appError.details ?? null) : null,
    },
  };

  res.status(appError.statusCode).json(body);
}
