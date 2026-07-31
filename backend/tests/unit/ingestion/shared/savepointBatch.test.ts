import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../../src/database';
import { ConflictError } from '../../../../src/errors';
import { insertWithSavepointIsolation } from '../../../../src/ingestion/shared/savepointBatch';

/**
 * Fake tx: only the `query` method is exercised by insertWithSavepointIsolation
 * itself (SAVEPOINT/RELEASE/ROLLBACK TO SAVEPOINT) — insertOne receives this
 * same fake and is free to ignore it, matching how a real transactional
 * executor is passed straight through to a repository's create() call.
 */
function fakeTx(): { tx: Database; calls: string[] } {
  const calls: string[] = [];
  const tx = {
    query: vi.fn((sql: string) => {
      calls.push(sql);
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    withTransaction: vi.fn(),
  } as unknown as Database;
  return { tx, calls };
}

describe('insertWithSavepointIsolation', () => {
  it('inserts every item and releases its savepoint when insertOne always succeeds', async () => {
    const { tx, calls } = fakeTx();

    const result = await insertWithSavepointIsolation({
      tx,
      items: [1, 2, 3],
      savepointName: 'sp_test',
      insertOne: (item) => Promise.resolve(item * 10),
      onSkip: (item, reason) => ({ item, reason }),
      logSkip: () => {},
    });

    expect(result.succeeded).toEqual([10, 20, 30]);
    expect(result.skipped).toEqual([]);
    expect(calls).toEqual([
      'SAVEPOINT sp_test',
      'RELEASE SAVEPOINT sp_test',
      'SAVEPOINT sp_test',
      'RELEASE SAVEPOINT sp_test',
      'SAVEPOINT sp_test',
      'RELEASE SAVEPOINT sp_test',
    ]);
  });

  it('rolls back only the failing item, letting the rest of the batch succeed', async () => {
    const { tx, calls } = fakeTx();
    const logSkip = vi.fn();

    const result = await insertWithSavepointIsolation({
      tx,
      items: [1, 2, 3],
      savepointName: 'sp_test',
      insertOne: (item) =>
        item === 2
          ? Promise.reject(new ConflictError('duplicate item 2'))
          : Promise.resolve(item * 10),
      onSkip: (item, reason) => ({ item, reason }),
      logSkip,
    });

    expect(result.succeeded).toEqual([10, 30]);
    expect(result.skipped).toEqual([{ item: 2, reason: 'duplicate item 2' }]);
    expect(logSkip).toHaveBeenCalledWith(2, 'duplicate item 2');
    expect(calls).toEqual([
      'SAVEPOINT sp_test',
      'RELEASE SAVEPOINT sp_test',
      'SAVEPOINT sp_test',
      'ROLLBACK TO SAVEPOINT sp_test',
      'SAVEPOINT sp_test',
      'RELEASE SAVEPOINT sp_test',
    ]);
  });

  it('never leaks a raw error message — only AppError messages reach onSkip/logSkip', async () => {
    const { tx } = fakeTx();

    const result = await insertWithSavepointIsolation({
      tx,
      items: ['a'],
      savepointName: 'sp_test',
      insertOne: () => Promise.reject(new Error('raw pg driver detail')),
      onSkip: (item, reason) => ({ item, reason }),
      logSkip: () => {},
    });

    expect(result.skipped).toEqual([{ item: 'a', reason: 'insert failed' }]);
  });

  it('allows insertOne to perform more than one call per item atomically (e.g. a provenance+asset pair)', async () => {
    const { tx } = fakeTx();
    const secondaryCalls: string[] = [];

    const result = await insertWithSavepointIsolation({
      tx,
      items: [{ id: 'scene-1' }],
      savepointName: 'sp_test',
      insertOne: async (item, txExecutor) => {
        secondaryCalls.push('provenance');
        await txExecutor.query('irrelevant secondary statement');
        secondaryCalls.push('asset');
        return `${item.id}-registered`;
      },
      onSkip: (item, reason) => ({ item, reason }),
      logSkip: () => {},
    });

    expect(result.succeeded).toEqual(['scene-1-registered']);
    expect(secondaryCalls).toEqual(['provenance', 'asset']);
  });
});
