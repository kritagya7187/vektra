import { Pool } from 'pg';
import { config } from '../config';
import { rootLogger } from '../logging';

const dbLogger = rootLogger.child({ component: 'database' });

/**
 * Bounded connection-attempt timeout. Not one of the environment-driven
 * values this subsystem was scoped to (POSTGRES_HOST/PORT/DATABASE/USER/
 * PASSWORD) and not specified anywhere in the EDD — a technical safety
 * constant, not a business/policy threshold. Without some bound, a
 * connection attempt against an unreachable database can hang
 * indefinitely, which would make "fail clearly" impossible to satisfy
 * rather than merely imperfect.
 */
const CONNECTION_TIMEOUT_MS = 5000;

/**
 * The single connection pool for this service, configured entirely from
 * the validated application config (never raw process.env, never a
 * literal credential). Must connect as a login user granted membership in
 * the vektra_backend_api role (db/migrations/0014_roles_and_grants.sql) —
 * this module has no way to enforce that itself, only to not undermine it
 * by hardcoding a different identity.
 */
export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
});

/**
 * node-postgres emits 'error' on the pool itself when an already-connected,
 * idle client encounters a backend-side failure (network drop, database
 * restart, etc.) unrelated to any query in flight. Without this listener
 * such an event is an unhandled 'error' event, which crashes the process —
 * this is a documented node-postgres requirement, not optional defensive
 * code.
 */
pool.on('error', (err) => {
  dbLogger.error({ err }, 'unexpected error on idle database client');
});

/**
 * Gracefully drains and closes the pool: waits for checked-out clients to
 * be released, then closes all connections. Does not forcibly terminate
 * in-flight queries.
 */
export async function closePool(): Promise<void> {
  dbLogger.info('closing database connection pool');
  await pool.end();
  dbLogger.info('database connection pool closed');
}
