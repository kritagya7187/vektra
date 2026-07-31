import { AppError } from './AppError';

/**
 * Catch-all for item 5 ("unknown error handling"): anything thrown that
 * isn't already part of this error hierarchy. Constructed exclusively by
 * middleware/errorHandler.ts's toAppError() — never thrown directly by
 * application code, which should throw a more specific type.
 */
export class InternalServerError extends AppError {
  constructor(message: string = 'An unexpected error occurred.', cause?: unknown) {
    super({ code: 'INTERNAL_SERVER_ERROR', statusCode: 500, message, cause });
  }
}
