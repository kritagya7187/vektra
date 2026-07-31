import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/**
 * Vitest globalSetup runs once, in a separate process from the test
 * workers, before any test file loads. It cannot reliably hand
 * process.env values to those workers directly (Vitest does not
 * guarantee propagation), so connection info is written to a temp JSON
 * file instead; tests/helpers/testEnv.ts (a setupFiles script, which DOES
 * run inside each worker before any test file's imports) reads it back
 * and applies it to process.env before src/config is ever imported.
 *
 * Starts exactly ONE postgis/postgis:16-3.4 container for the entire
 * integration/API test run (see vitest.integration.config.ts's
 * fileParallelism:false for why one container is safe here) — applies
 * the real db/schema.sql and the real seed, then creates a login role
 * granted membership in vektra_backend_api, matching db/migrations/0014
 * and every manual verification run in Subsystems 3-11.
 *
 * Also granted membership in vektra_ingestion (added in the OSM
 * Ingestion subsystem) and vektra_simulation (added in the Heat Exposure
 * Engine subsystem) — a deliberate, test-harness-only deviation from
 * the real deployment model. In production, the API server, ingestion
 * CLIs, and the simulation CLI are separate OS processes, each
 * connecting as its own narrowly-scoped role
 * (db/docker/03-create-app-role.sh only ever provisions the
 * vektra_backend_api membership real deployments use); that separation
 * is the actual least-privilege enforcement point and is untouched.
 * This test harness is one process exercising API-role-, ingestion-role-,
 * and simulation-role-scoped repository code across the same suite, and
 * Postgres roles support multiple simultaneous memberships — granting
 * all three to the one test login role is the smallest correct
 * adaptation, not a relaxation of the production privilege model.
 */

export const CONNECTION_INFO_PATH = path.join(__dirname, '.test-db-connection.json');

export interface TestDbConnectionInfo {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly superuserPassword: string;
  readonly loginUser: string;
  readonly loginPassword: string;
}

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'db', 'schema.sql');
const SEED_PATH = path.join(REPO_ROOT, 'db', 'seeds', '0001_data_sources.sql');

let container: StartedTestContainer | undefined;

async function runSql(
  c: StartedTestContainer,
  superuserPassword: string,
  args: string[],
): Promise<void> {
  const result = await c.exec(
    ['psql', '-U', 'postgres', '-d', 'vektra_test', '-v', 'ON_ERROR_STOP=1', ...args],
    { env: { PGPASSWORD: superuserPassword } },
  );
  if (result.exitCode !== 0) {
    throw new Error(`psql failed (exit ${result.exitCode}):\n${result.output}`);
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const superuserPassword = randomBytes(16).toString('hex');
  const loginPassword = randomBytes(16).toString('hex');
  const loginUser = 'vektra_test_login';

  container = await new GenericContainer('postgis/postgis:16-3.4')
    .withEnvironment({ POSTGRES_PASSWORD: superuserPassword, POSTGRES_DB: 'vektra_test' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  await container.copyFilesToContainer([
    { source: SCHEMA_PATH, target: '/schema.sql' },
    { source: SEED_PATH, target: '/seed.sql' },
  ]);

  await runSql(container, superuserPassword, ['-f', '/schema.sql']);
  await runSql(container, superuserPassword, ['-f', '/seed.sql']);
  await runSql(container, superuserPassword, [
    '-c',
    `CREATE ROLE ${loginUser} LOGIN PASSWORD '${loginPassword}';
     GRANT vektra_backend_api TO ${loginUser};
     GRANT vektra_ingestion TO ${loginUser};
     GRANT vektra_simulation TO ${loginUser};`,
  ]);

  const info: TestDbConnectionInfo = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: 'vektra_test',
    superuserPassword,
    loginUser,
    loginPassword,
  };
  writeFileSync(CONNECTION_INFO_PATH, JSON.stringify(info), 'utf8');

  return async () => {
    try {
      unlinkSync(CONNECTION_INFO_PATH);
    } catch {
      // already gone — fine
    }
    await container?.stop();
  };
}
