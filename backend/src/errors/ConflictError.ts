import { AppError } from './AppError';

/**
 * Maps to real constraints in db/migrations — e.g. a unique_violation
 * (SQLSTATE 23505) against uq_provenance_batch or uq_result_run_building
 * (see database/mapDatabaseError.ts). Grounded in the actual schema, not
 * a generic REST convenience type.
 */
export class ConflictError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'CONFLICT', statusCode: 409, message, cause });
  }
}
