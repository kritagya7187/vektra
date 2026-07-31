import { describe, expect, it } from 'vitest';
import { checkDatabaseHealth } from '../../../src/database/healthCheck';
import type { Database, QueryResult } from '../../../src/database/Database';

/**
 * checkDatabaseHealth() accepts an injectable Database — the
 * connection-failure and PostGIS-unavailable branches are exercised
 * here with a fake, deterministic implementation; the real success path
 * (against actual PostGIS) is covered by
 * tests/integration/database.test.ts.
 */
function fakeDatabase(overrides: Partial<Database>): Database {
  return {
    query: <T>(): Promise<QueryResult<T>> => Promise.resolve({ rows: [], rowCount: 0 }),
    withClient: () => Promise.reject(new Error('not used in this test')),
    withTransaction: () => Promise.reject(new Error('not used in this test')),
    ...overrides,
  };
}

describe('checkDatabaseHealth', () => {
  it('reports disconnected when SELECT 1 fails, without throwing', async () => {
    const db = fakeDatabase({
      query: () => Promise.reject(new Error('connection refused')),
    });
    const status = await checkDatabaseHealth(db);
    expect(status).toEqual({ connected: false, postgis: { available: false } });
  });

  it('reports connected + postgis available with version, on success', async () => {
    let call = 0;
    const db = fakeDatabase({
      query: <T>(): Promise<QueryResult<T>> => {
        call += 1;
        if (call === 1) {
          return Promise.resolve({ rows: [], rowCount: 0 } as QueryResult<T>);
        }
        return Promise.resolve({
          rows: [{ postgis_version: '3.4 USE_GEOS=1' }] as T[],
          rowCount: 1,
        });
      },
    });
    const status = await checkDatabaseHealth(db);
    expect(status.connected).toBe(true);
    expect(status.postgis).toEqual({ available: true, version: '3.4 USE_GEOS=1' });
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports connected but postgis unavailable when the version query fails', async () => {
    let call = 0;
    const db = fakeDatabase({
      query: <T>(): Promise<QueryResult<T>> => {
        call += 1;
        if (call === 1) {
          return Promise.resolve({ rows: [], rowCount: 0 } as QueryResult<T>);
        }
        return Promise.reject(new Error('function postgis_version() does not exist'));
      },
    });
    const status = await checkDatabaseHealth(db);
    expect(status.connected).toBe(true);
    expect(status.postgis.available).toBe(false);
  });
});
