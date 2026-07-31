import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  DatabaseError,
  InternalServerError,
  NotFoundError,
  ValidationError,
  isAppError,
} from '../../../src/errors';

describe('AppError hierarchy', () => {
  it('ValidationError carries code/statusCode/details', () => {
    const err = new ValidationError('bad input', [{ path: 'body.name', message: 'required' }]);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual([{ path: 'body.name', message: 'required' }]);
    expect(isAppError(err)).toBe(true);
  });

  it('NotFoundError maps to 404 / NOT_FOUND', () => {
    const err = new NotFoundError('missing');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('ConflictError maps to 409 / CONFLICT', () => {
    const err = new ConflictError('duplicate');
    expect(err.code).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
  });

  it('DatabaseError maps to 500 / DATABASE_ERROR', () => {
    const err = new DatabaseError('boom');
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.statusCode).toBe(500);
  });

  it('InternalServerError maps to 500 / INTERNAL_SERVER_ERROR', () => {
    const err = new InternalServerError('boom');
    expect(err.code).toBe('INTERNAL_SERVER_ERROR');
    expect(err.statusCode).toBe(500);
  });

  it('fields are non-writable after construction (defineProperty writable:false)', () => {
    const err = new NotFoundError('missing');
    expect(() => {
      // @ts-expect-error -- intentionally verifying runtime immutability of a readonly-typed field
      err.code = 'SOMETHING_ELSE';
    }).toThrow(TypeError);
  });

  it('is a real, extensible object usable by Pino (not Object.frozen)', () => {
    const err = new NotFoundError('missing');
    expect(Object.isExtensible(err)).toBe(true);
  });

  it('preserves the original cause for server-side diagnostics', () => {
    const cause = new Error('raw driver failure');
    const err = new DatabaseError('boom', cause);
    expect(err.cause).toBe(cause);
  });

  it('isAppError returns false for a plain Error', () => {
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('not an error')).toBe(false);
  });
});
