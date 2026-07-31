import type { PoolClient, QueryResultRow } from 'pg';
import { isAppError } from '../errors';
import { mapDatabaseError } from './mapDatabaseError';
import { pool } from './pool';

export interface QueryResult<T> {
  readonly rows: T[];
  readonly rowCount: number;
}

/**
 * Minimal database abstraction. Future repositories (Repository layer
 * subsystem) depend on this interface rather than importing `pg`
 * directly — the point being that repository code is decoupled from the
 * concrete driver and can be exercised in tests against a fake
 * implementation of this same interface, without a real database.
 *
 * Two operations only:
 * - query(): the common case. Auto-acquires and releases a client per
 *   call (this is what pg.Pool.query() already does internally).
 * - withClient(): an explicit acquire-run-release escape hatch for the
 *   rarer multi-statement case. Release is guaranteed via `finally`
 *   regardless of whether the callback succeeds or throws.
 *
 * No transaction (BEGIN/COMMIT/ROLLBACK) helpers exist here. No
 * repository exists yet with a concrete multi-statement transactional
 * need, and the schema's append-only design (db/README.md, Design
 * principle 1) means most writes are expected to be single-statement.
 * Adding a transaction API now would be guessing at its shape before
 * there is a real caller.
 */
export interface Database {
  query<T = unknown>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export class PgDatabase implements Database {
  async query<T = unknown>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
    // pg's own query<T>() constrains T to QueryResultRow (an indexable
    // row shape). This abstraction's T is intentionally unconstrained, so
    // callers aren't forced to depend on a pg-specific type — the row
    // shape is asserted at this single boundary, where the concrete
    // driver is actually invoked, rather than leaking pg's constraint
    // into the Database interface itself.
    try {
      const result = await pool.query<QueryResultRow>(text, params as unknown[] | undefined);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    } catch (err) {
      // Every error out of this method is a safe AppError — never a raw
      // pg driver error. This is the structural enforcement point for
      // "database driver errors must never leak outside the database
      // abstraction."
      throw mapDatabaseError(err);
    }
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (err) {
      throw mapDatabaseError(err);
    }

    try {
      return await fn(client);
    } catch (err) {
      // fn() is caller-provided and may legitimately throw its own
      // AppError (e.g. a future repository raising NotFoundError inside
      // the callback) — only genuine driver-shaped errors get wrapped;
      // an AppError the caller already threw passes through unchanged.
      throw isAppError(err) ? err : mapDatabaseError(err);
    } finally {
      client.release();
    }
  }
}

export const database: Database = new PgDatabase();
