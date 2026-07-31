export interface AppErrorParams {
  readonly code: string;
  readonly statusCode: number;
  readonly message: string;
  readonly details?: unknown;
  readonly cause?: unknown;
}

/**
 * Base class for every error this backend deliberately throws.
 *
 * Every field is set inside this base constructor (via a parameter
 * object, not subclass field declarations — subclass field initializers
 * run *after* super() returns) using Object.defineProperty with
 * writable: false, so code/statusCode/details cannot be reassigned after
 * construction ("immutable after creation where practical").
 *
 * Deliberately NOT a whole-object Object.freeze(). That was the first
 * implementation, and it broke at runtime: Pino's standard error
 * serializer (pino-std-serializers) tags an error object with a
 * transient Symbol property during serialization to detect circular
 * references, which requires the object to remain extensible. A frozen
 * (non-extensible) error throws inside the logger the moment it tries to
 * log one. Field-level non-writability gives the same practical
 * guarantee — nothing in this codebase can reassign an AppError's public
 * fields after construction — without fighting the logging
 * infrastructure this subsystem is required to integrate with.
 *
 * `details` is generic on purpose — only ValidationError's details are
 * ever surfaced to a client (see middleware/errorHandler.ts, the single
 * place that decision is made). `cause` (native ES2022 Error option)
 * carries the underlying failure for server-side logging only; nothing
 * in this codebase reads `.cause` when building a client response.
 */
export abstract class AppError extends Error {
  declare readonly code: string;
  declare readonly statusCode: number;
  declare readonly details?: unknown;

  protected constructor(params: AppErrorParams) {
    super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = this.constructor.name;

    Object.defineProperty(this, 'code', {
      value: params.code,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, 'statusCode', {
      value: params.statusCode,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, 'details', {
      value: params.details,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
