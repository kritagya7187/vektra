import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { database, checkDatabaseHealth } from '../../src/database';
import { DatabaseError } from '../../src/errors';
import { createSimulationRun } from '../helpers/fixtures';

describe('database (real disposable PostGIS container)', () => {
  it('checkDatabaseHealth() reports connected + PostGIS available against the real container', async () => {
    const status = await checkDatabaseHealth();
    expect(status.connected).toBe(true);
    expect(status.postgis.available).toBe(true);
    expect(status.postgis.version).toMatch(/^\d+\.\d+/);
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('database.query() executes a real parameterized query as the least-privilege login role', async () => {
    const result = await database.query<{ one: number }>('SELECT 1 AS one');
    expect(result.rows).toEqual([{ one: 1 }]);
    expect(result.rowCount).toBe(1);
  });

  it('withTransaction() commits a real write — visible in a separate query after it returns', async () => {
    const baseline = await createSimulationRun();
    const scenarioId = randomUUID();

    // vektra_backend_api CAN insert into scenario (db/migrations/0014)
    // — a genuine write through the app's own real privilege, not an
    // illustrative SELECT.
    await database.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO scenario (scenario_id, baseline_run_id, name) VALUES ($1, $2, 'tx-commit-test')`,
        [scenarioId, baseline.runId],
      );
    });

    const after = await database.query<{ name: string }>(
      'SELECT name FROM scenario WHERE scenario_id = $1',
      [scenarioId],
    );
    expect(after.rows[0]?.name).toBe('tx-commit-test');
  });

  it('withTransaction() rolls back every statement when the callback throws', async () => {
    const baseline = await createSimulationRun();
    const scenarioId = randomUUID();
    const originalError = new Error('deliberate failure inside transaction');

    // A plain (non-AppError) throw inside the callback is wrapped into a
    // generic DatabaseError by PgDatabase.withTransaction's catch block
    // (database/Database.ts) — the original is preserved only via
    // `.cause`, never in the outer message (never leak driver/internal
    // detail to a client). Asserting on that real, already-reviewed
    // behavior, not on the original message surviving unwrapped.
    let caught: unknown;
    try {
      await database.withTransaction(async (tx) => {
        await tx.query(
          `INSERT INTO scenario (scenario_id, baseline_run_id, name) VALUES ($1, $2, 'should-not-persist')`,
          [scenarioId, baseline.runId],
        );
        throw originalError;
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as DatabaseError).cause).toBe(originalError);

    const after = await database.query<{ count: string }>(
      'SELECT count(*)::text FROM scenario WHERE scenario_id = $1',
      [scenarioId],
    );
    expect(after.rows[0]?.count).toBe('0');
  });

  it('rejects a nested withTransaction() call rather than silently misbehaving', async () => {
    let caught: unknown;
    try {
      await database.withTransaction(async (tx) => {
        await tx.withTransaction(() => Promise.resolve(undefined));
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DatabaseError);
    expect((caught as DatabaseError).cause).toBeInstanceOf(Error);
    expect(((caught as DatabaseError).cause as Error).message).toMatch(/[Nn]ested transactions/);
  });
});
