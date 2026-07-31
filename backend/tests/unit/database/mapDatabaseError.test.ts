import { describe, expect, it } from 'vitest';
import { ConflictError, DatabaseError, ValidationError } from '../../../src/errors';
import { mapDatabaseError } from '../../../src/database/mapDatabaseError';

/** Constructed fake pg-error shapes (SQLSTATE codes) — pure function, no real DB needed. */
function pgError(code: string): Error & { code: string } {
  return Object.assign(new Error('driver detail'), { code });
}

describe('mapDatabaseError', () => {
  it('maps 23505 unique_violation to ConflictError', () => {
    expect(mapDatabaseError(pgError('23505'))).toBeInstanceOf(ConflictError);
  });

  it('maps 23503 foreign_key_violation to ValidationError', () => {
    expect(mapDatabaseError(pgError('23503'))).toBeInstanceOf(ValidationError);
  });

  it('maps 23502 not_null_violation to ValidationError', () => {
    expect(mapDatabaseError(pgError('23502'))).toBeInstanceOf(ValidationError);
  });

  it('maps 23514 check_violation to ValidationError', () => {
    expect(mapDatabaseError(pgError('23514'))).toBeInstanceOf(ValidationError);
  });

  it('maps an unrecognized SQLSTATE to a generic DatabaseError', () => {
    expect(mapDatabaseError(pgError('08006'))).toBeInstanceOf(DatabaseError);
  });

  it('maps a non-pg-shaped error (no .code) to a generic DatabaseError', () => {
    expect(mapDatabaseError(new Error('plain'))).toBeInstanceOf(DatabaseError);
    expect(mapDatabaseError('not even an error object')).toBeInstanceOf(DatabaseError);
  });

  it('never leaks the raw driver message into the returned AppError message', () => {
    const mapped = mapDatabaseError(pgError('23505'));
    expect(mapped.message).not.toContain('driver detail');
  });

  it('preserves the raw error via cause for server-side logging', () => {
    const raw = pgError('23505');
    const mapped = mapDatabaseError(raw);
    expect(mapped.cause).toBe(raw);
  });
});
