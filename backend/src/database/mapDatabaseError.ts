import { ConflictError, DatabaseError, ValidationError } from '../errors';

/**
 * PostgreSQL SQLSTATE error codes this mapping recognizes. Grounded in
 * the actual constraint types present in db/migrations (UNIQUE, FOREIGN
 * KEY, CHECK, NOT NULL) — not a generic/invented list.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
} as const;

interface PgErrorLike {
  readonly code?: string;
}

function isPgErrorLike(err: unknown): err is PgErrorLike {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * Translates a raw error thrown by the pg driver into a safe AppError.
 * This is the single point where "database driver errors must never
 * leak outside the database abstraction" is enforced — called
 * exclusively from database/Database.ts, never bypassed.
 *
 * Deliberately does not include the raw error's .message in the
 * returned AppError's message (which would risk surfacing SQL text or
 * driver detail to a client via errorHandler) — only via `cause`, which
 * errorHandler never reads when building a response, only when logging.
 */
export function mapDatabaseError(err: unknown): DatabaseError | ConflictError | ValidationError {
  if (!isPgErrorLike(err)) {
    return new DatabaseError('A database error occurred.', err);
  }

  switch (err.code) {
    case PG_SQLSTATE.UNIQUE_VIOLATION:
      return new ConflictError('The request conflicts with an existing record.', err);
    case PG_SQLSTATE.FOREIGN_KEY_VIOLATION:
    case PG_SQLSTATE.NOT_NULL_VIOLATION:
    case PG_SQLSTATE.CHECK_VIOLATION:
      return new ValidationError(
        'The request references invalid or incomplete data.',
        undefined,
        err,
      );
    default:
      return new DatabaseError('A database error occurred.', err);
  }
}
