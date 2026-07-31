import type { Database } from '../../database';
import { isAppError } from '../../errors';

/**
 * Generic per-item transactional insert with SAVEPOINT isolation —
 * extracted from ingestion/OsmIngestionService.ts (Remote Sensing
 * Ingestion subsystem) once a second real caller needed the identical
 * pattern. OsmIngestionService itself was refactored to use this, and
 * its full test suite re-run afterward to confirm no behavior change.
 *
 * PostgreSQL semantics require this: one failed statement inside a
 * transaction poisons the ENTIRE transaction until rolled back — you
 * cannot simply try/catch around one bad insert and keep issuing more
 * statements on the same transaction. Wrapping each item's insertOne()
 * call in its own SAVEPOINT/RELEASE/ROLLBACK TO SAVEPOINT (plain SQL
 * through the existing tx.query() — no change needed to
 * database/Database.ts) means one bad item rolls back only itself; the
 * rest of the batch, and whatever was inserted before entering this
 * loop (e.g. a shared DataProvenanceRecord), still commit together at
 * the end.
 *
 * insertOne is deliberately free to perform MORE THAN ONE insert per
 * item (e.g. raster ingestion's provenance+asset pair) — the savepoint
 * wraps whatever insertOne does as one atomic unit, so a failure
 * partway through a multi-insert item never leaves that item's earlier
 * insert (e.g. an orphaned DataProvenanceRecord with no corresponding
 * asset) committed on its own. This is what makes "partial failures
 * must never produce inconsistent provenance" (this subsystem's own
 * brief, item 7) hold structurally rather than by convention.
 */

export interface SavepointBatchResult<TSuccess, TSkipped> {
  readonly succeeded: readonly TSuccess[];
  readonly skipped: readonly TSkipped[];
}

export interface SavepointBatchOptions<TItem, TSuccess, TSkipped> {
  readonly tx: Database;
  readonly items: readonly TItem[];
  /** Must be unique only within one call — items are processed sequentially, never concurrently, so one name is reused across the whole batch. */
  readonly savepointName: string;
  readonly insertOne: (item: TItem, tx: Database) => Promise<TSuccess>;
  readonly onSkip: (item: TItem, reason: string) => TSkipped;
  readonly logSkip: (item: TItem, reason: string) => void;
}

function describeFailureReason(err: unknown): string {
  // Only ever an already-safe AppError message (never a raw driver
  // error) — matches "never expose persistence details" everywhere else
  // in this codebase.
  return isAppError(err) ? err.message : 'insert failed';
}

export async function insertWithSavepointIsolation<TItem, TSuccess, TSkipped>(
  options: SavepointBatchOptions<TItem, TSuccess, TSkipped>,
): Promise<SavepointBatchResult<TSuccess, TSkipped>> {
  const succeeded: TSuccess[] = [];
  const skipped: TSkipped[] = [];

  for (const item of options.items) {
    await options.tx.query(`SAVEPOINT ${options.savepointName}`);
    try {
      const result = await options.insertOne(item, options.tx);
      await options.tx.query(`RELEASE SAVEPOINT ${options.savepointName}`);
      succeeded.push(result);
    } catch (err) {
      await options.tx.query(`ROLLBACK TO SAVEPOINT ${options.savepointName}`);
      const reason = describeFailureReason(err);
      options.logSkip(item, reason);
      skipped.push(options.onSkip(item, reason));
    }
  }

  return { succeeded, skipped };
}
