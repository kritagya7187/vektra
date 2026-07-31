import { AppError } from './AppError';

/**
 * Safe wrapper for a database driver failure that isn't one of the
 * client-correctable categories (ConflictError/ValidationError) —
 * connection failures, unrecognized SQLSTATEs, etc. The message is
 * always generic; the real underlying error travels only via `cause`,
 * for server-side logging (database/mapDatabaseError.ts is the only
 * place this class is constructed).
 */
export class DatabaseError extends AppError {
  constructor(message: string = 'A database error occurred.', cause?: unknown) {
    super({ code: 'DATABASE_ERROR', statusCode: 500, message, cause });
  }
}
