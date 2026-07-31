import { Pool } from 'pg';
import { testDbInfo } from './testDbInfo';

/**
 * A SEPARATE pool from the application's own (src/database/pool.ts),
 * which connects as the least-privilege vektra_backend_api-derived
 * login role and genuinely cannot INSERT into building/simulation_run/
 * etc. (db/migrations/0014) — exactly the real production privilege
 * model. Fixtures and per-test resets need superuser access, matching
 * every manual verification run in Subsystems 3-11 (`docker exec psql -U
 * postgres`), just via a real pg client instead of a shell-out.
 */
export const superuserPool = new Pool({
  host: testDbInfo.host,
  port: testDbInfo.port,
  database: testDbInfo.database,
  user: 'postgres',
  password: testDbInfo.superuserPassword,
});
