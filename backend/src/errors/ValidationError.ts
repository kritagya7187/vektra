import { AppError } from './AppError';

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * EDD Section 33: "Input validation: all API inputs... validated
 * server-side." `issues` is the one AppError detail payload ever
 * returned to a client (middleware/errorHandler.ts) — describing what
 * was wrong with the client's own request is expected REST behavior,
 * not a leak. `cause`, like every other concrete error type, carries the
 * underlying failure (e.g. a raw pg constraint-violation error) for
 * server-side logging only — never read when building a client response.
 */
export class ValidationError extends AppError {
  constructor(message: string, issues?: readonly ValidationIssue[], cause?: unknown) {
    super({ code: 'VALIDATION_ERROR', statusCode: 400, message, details: issues, cause });
  }
}
