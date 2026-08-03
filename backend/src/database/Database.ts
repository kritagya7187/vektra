import type { PoolClient, QueryResultRow } from 'pg';
import { isAppError } from '../errors';
import { rootLogger } from '../logging';
import { mapDatabaseError } from './mapDatabaseError';
import { pool } from './pool';

const dbLogger = rootLogger.child({ component: 'database' });

export interface QueryResult<T> {
  readonly rows: T[];
  readonly rowCount: number;
}

/**
 * Minimal database abstraction. Repositories (Repository Layer subsystem)
 * depend on this interface rather than importing `pg` directly — the
 * point being that repository code is decoupled from the concrete driver
 * and can be exercised in tests against a fake implementation of this
 * same interface, without a real database.
 *
 * Three operations:
 * - query(): the common case. Auto-acquires and releases a client per
 *   call (this is what pg.Pool.query() already does internally).
 * - withClient(): an explicit acquire-run-release escape hatch for the
 *   rarer multi-statement case. Release is guaranteed via `finally`
 *   regardless of whether the callback succeeds or throws.
 * - withTransaction(): BEGIN/COMMIT/ROLLBACK around a callback that
 *   receives another Database — not a raw PoolClient. Every repository
 *   method already accepts a Database-shaped executor, so the identical
 *   method works standalone or inside a transaction; no repository
 *   implements transaction control itself. Added once a real
 *   multi-statement write need existed — deliberately absent before
 *   that, per this file's original design note, rather than guessed at.
 */
export interface Database {
  query<T = unknown>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  withTransaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
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
      // AppError (e.g. a repository raising a mapped error inside the
      // callback) — only genuine driver-shaped errors get wrapped; an
      // AppError the caller already threw passes through unchanged.
      throw isAppError(err) ? err : mapDatabaseError(err);
    } finally {
      client.release();
    }
  }

  async withTransaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      const tx: Database = {
        query: async <R = unknown>(
          text: string,
          params?: readonly unknown[],
        ): Promise<QueryResult<R>> => {
          try {
            const result = await client.query<QueryResultRow>(
              text,
              params as unknown[] | undefined,
            );
            return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
          } catch (err) {
            throw mapDatabaseError(err);
          }
        },
        withClient: async <R>(innerFn: (c: PoolClient) => Promise<R>): Promise<R> =>
          innerFn(client),
        withTransaction: () => {
          throw new Error('Nested transactions are not supported.');
        },
      };

      try {
        await client.query('BEGIN');
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          dbLogger.error({ err: rollbackErr }, 'rollback failed after transaction error');
        }
        throw isAppError(err) ? err : mapDatabaseError(err);
      }
    });
  }
}

export const database: Database = new PgDatabase();
