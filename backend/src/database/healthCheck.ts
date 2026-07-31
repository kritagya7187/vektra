import { rootLogger } from '../logging';
import { database as defaultDatabase, type Database } from './Database';

const dbLogger = rootLogger.child({ component: 'database' });
const MS_PER_NANOSECOND = 1_000_000;
const ROUNDING_PRECISION = 100; // 2 decimal places

export interface DatabaseHealthStatus {
  readonly connected: boolean;
  readonly latencyMs?: number;
  readonly postgis: {
    readonly available: boolean;
    readonly version?: string;
  };
}

function roundMs(elapsedNanos: bigint): number {
  const ms = Number(elapsedNanos) / MS_PER_NANOSECOND;
  return Math.round(ms * ROUNDING_PRECISION) / ROUNDING_PRECISION;
}

/**
 * Verifies live PostgreSQL connectivity and PostGIS availability.
 *
 * Never throws. Connection and query failures are caught, logged in full
 * detail server-side via the structured logger, and reported back only
 * as the safe status shape above — no credential, host, port, or raw
 * driver error message is ever part of the return value. Callers (the
 * eventual /health route, Subsystem 5) are free to shape this into
 * whatever HTTP response they need; this function only reports facts.
 *
 * PostGIS is checked via SELECT PostGIS_Version() rather than querying
 * pg_extension metadata: this schema's tables depend on live PostGIS
 * functions (geometry typmods, ST_Area, ST_Transform triggers —
 * db/migrations/0005), so proving the function is callable is a
 * stronger, more meaningful guarantee than proving the extension is
 * merely registered.
 */
export async function checkDatabaseHealth(
  db: Database = defaultDatabase,
): Promise<DatabaseHealthStatus> {
  const startedAt = process.hrtime.bigint();

  try {
    await db.query('SELECT 1');
  } catch (err) {
    dbLogger.error({ err }, 'database connectivity check failed');
    return { connected: false, postgis: { available: false } };
  }

  const latencyMs = roundMs(process.hrtime.bigint() - startedAt);

  try {
    const result = await db.query<{ postgis_version: string }>(
      'SELECT PostGIS_Version() AS postgis_version',
    );
    return {
      connected: true,
      latencyMs,
      postgis: { available: true, version: result.rows[0]?.postgis_version },
    };
  } catch (err) {
    dbLogger.warn({ err }, 'postgis extension unavailable or not queryable');
    return {
      connected: true,
      latencyMs,
      postgis: { available: false },
    };
  }
}
