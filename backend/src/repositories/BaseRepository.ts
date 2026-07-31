import type { Logger } from 'pino';
import { database as defaultDatabase, type Database } from '../database';
import { rootLogger } from '../logging';

const NANOS_PER_MS = 1_000_000;
const ROUNDING_PRECISION = 100; // 2 decimal places

// A small, deliberately local duration-rounding helper rather than
// importing middleware/requestContext.ts's equivalent: that would create
// a repositories/ -> middleware/ dependency, inverting this codebase's
// layering direction (middleware/controllers depend on repositories, not
// the reverse), for the sake of two lines of Math.round.
function toRoundedMs(elapsedNanos: bigint): number {
  const ms = Number(elapsedNanos) / NANOS_PER_MS;
  return Math.round(ms * ROUNDING_PRECISION) / ROUNDING_PRECISION;
}

/**
 * Shared foundation every concrete repository extends. Provides query
 * execution with timing + structured logging (item 6) — a genuine gap
 * database/Database.ts never filled, since query-level, per-entity
 * operational logging is a repository concern, not a connection-layer
 * one. Error translation itself is NOT reimplemented here:
 * Database.query() already wraps every error through mapDatabaseError()
 * (Global Error Handling subsystem) before it ever reaches this class, so
 * queryOne()/queryMany() only need to log and re-throw, never translate.
 *
 * The `executor` parameter on every protected helper (defaulting to
 * `this.database`) is what lets a concrete repository's public methods
 * accept an optional transaction handle — see database/Database.ts's
 * withTransaction() — without any repository implementing transaction
 * control itself.
 *
 * `logger` defaults to a non-request-scoped child of rootLogger. A
 * caller with request context (the future Service layer) can construct
 * a repository with a request-scoped logger injected instead (e.g.
 * `new BuildingRepository(database, req.log)`) — every query logged
 * through that instance then carries requestId automatically, without
 * this class or any subclass ever importing an Express type.
 */
export abstract class BaseRepository {
  // Public, not protected: `abstract` already guarantees BaseRepository
  // itself can't be instantiated directly. A protected constructor would
  // additionally block every concrete subclass's public constructibility
  // unless each one redeclared its own constructor just to re-expose
  // it — every subclass here intentionally inherits this constructor
  // as-is, both for the singleton exports below and so a future caller
  // can do `new BuildingRepositoryImpl(db, req.log)` directly.
  constructor(
    protected readonly database: Database = defaultDatabase,
    protected readonly logger: Logger = rootLogger.child({ component: 'repository' }),
  ) {}

  protected async queryMany<TRow>(
    operation: string,
    text: string,
    params: readonly unknown[],
    executor: Database = this.database,
  ): Promise<readonly TRow[]> {
    const startedAt = process.hrtime.bigint();
    try {
      const result = await executor.query<TRow>(text, params);
      this.logSuccess(operation, startedAt, result.rowCount);
      return result.rows;
    } catch (err) {
      this.logFailure(operation, startedAt, err);
      throw err;
    }
  }

  protected async queryOne<TRow>(
    operation: string,
    text: string,
    params: readonly unknown[],
    executor: Database = this.database,
  ): Promise<TRow | null> {
    const startedAt = process.hrtime.bigint();
    try {
      const result = await executor.query<TRow>(text, params);
      this.logSuccess(operation, startedAt, result.rowCount);
      return result.rows[0] ?? null;
    } catch (err) {
      this.logFailure(operation, startedAt, err);
      throw err;
    }
  }

  private logSuccess(operation: string, startedAt: bigint, rowCount: number): void {
    const durationMs = toRoundedMs(process.hrtime.bigint() - startedAt);
    this.logger.debug({ operation, durationMs, rowCount }, 'repository query succeeded');
  }

  private logFailure(operation: string, startedAt: bigint, err: unknown): void {
    const durationMs = toRoundedMs(process.hrtime.bigint() - startedAt);
    this.logger.error({ operation, durationMs, err }, 'repository query failed');
  }
}
