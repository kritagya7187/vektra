import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Step 19 Part G: spawns the REAL flood-engine FastAPI service (via
 * uvicorn) and the REAL worker process, both pointed at the same
 * disposable test Postgres database every flood-engine Python test
 * already uses — real cross-process, cross-language integration, no
 * mocked scientific calculations anywhere in the chain this backend's
 * client actually talks to (Part G's own instruction: "Use the real
 * FastAPI service wherever practical").
 *
 * Skips gracefully (returns `null`), rather than failing, when either
 * the disposable database or the flood-engine Python environment isn't
 * available — the same "requires infrastructure, skip if absent"
 * convention `test_postgres_job_repository.py`'s own docstring
 * established on the Python side.
 */

const TEST_DB_HOST = process.env.FLOOD_ENGINE_TEST_DB_HOST ?? 'localhost';
const TEST_DB_PORT = Number(process.env.FLOOD_ENGINE_TEST_DB_PORT ?? '55432');
const TEST_DB_NAME = process.env.FLOOD_ENGINE_TEST_DB_NAME ?? 'flood_engine_test';
const TEST_DB_USER = process.env.FLOOD_ENGINE_TEST_DB_USER ?? 'postgres';
const TEST_DB_PASSWORD = process.env.FLOOD_ENGINE_TEST_DB_PASSWORD ?? 'test_password';

const FLOOD_ENGINE_DIR = path.join(__dirname, '..', '..', '..', 'flood-engine');
const PYTHON_EXECUTABLE = path.join(
  FLOOD_ENGINE_DIR,
  process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
);

const SERVER_PORT = 8199;
export const FLOOD_ENGINE_TEST_BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;

const sharedEnv = {
  ...process.env,
  POSTGRES_HOST: TEST_DB_HOST,
  POSTGRES_PORT: String(TEST_DB_PORT),
  POSTGRES_DB: TEST_DB_NAME,
  POSTGRES_USER: TEST_DB_USER,
  POSTGRES_PASSWORD: TEST_DB_PASSWORD,
  // tests/helpers/testEnv.ts sets process.env.LOG_LEVEL='fatal' for the
  // Node backend's own (pino) logger -- a value flood-engine's own
  // LoggingConfig (Pydantic) does not accept (debug/info/warning/error/
  // critical only). Spreading ...process.env above would otherwise leak
  // that Node-specific value into the Python subprocess's environment,
  // since both processes happen to read the same LOG_LEVEL variable
  // name for unrelated logging systems -- overridden here for the same
  // reason POSTGRES_* is overridden above.
  LOG_LEVEL: 'warning',
};

export async function isFloodEngineTestDbReachable(): Promise<boolean> {
  const client = new Client({
    host: TEST_DB_HOST,
    port: TEST_DB_PORT,
    database: TEST_DB_NAME,
    user: TEST_DB_USER,
    password: TEST_DB_PASSWORD,
    connectionTimeoutMillis: 2000,
  });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/openapi.json`);
      if (response.ok) {
        return true;
      }
    } catch {
      // not listening yet — keep polling
    }
    await sleep(200);
  }
  return false;
}

export interface StagedArrayPaths {
  readonly elevationPath: string;
  readonly buildingMaskPath: string;
  readonly manningNPath: string;
  readonly infiltrationLossPath: string;
  readonly rainfallRatesPath: string;
}

/**
 * Writes a real, valid, minimal set of .npy input arrays into `outputDir`
 * by invoking `stageFloodEngineArrays.py` (real numpy encoding, not a
 * hand-rolled binary format in TypeScript). Synchronous: every caller
 * needs the paths before it can proceed, and this only ever runs in test
 * setup, never in a request-handling path.
 */
export function stageFloodEngineArrays(
  outputDir: string,
  options: { readonly brokenManningShape?: boolean } = {},
): StagedArrayPaths {
  const scriptPath = path.join(__dirname, 'stageFloodEngineArrays.py');
  const args = [scriptPath, outputDir];
  if (options.brokenManningShape) {
    args.push('--broken-manning-shape');
  }
  const result = spawnSync(PYTHON_EXECUTABLE, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Failed to stage flood-engine test arrays: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as StagedArrayPaths;
}

export interface RunningFloodEngineServer {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

/**
 * Starts a real `uvicorn` process serving `flood_engine.api.app:app` and
 * a real `python -m flood_engine.jobs.worker` process, both against the
 * disposable test database. Returns `null` (never throws) if either the
 * database or the Python environment (including `uvicorn`, a Step 19
 * dev-only addition — see flood-engine/pyproject.toml) isn't available.
 */
export async function startFloodEngineServer(): Promise<RunningFloodEngineServer | null> {
  if (!(await isFloodEngineTestDbReachable())) {
    return null;
  }

  let apiProcess: ChildProcess;
  try {
    apiProcess = spawn(
      PYTHON_EXECUTABLE,
      [
        '-m',
        'uvicorn',
        'flood_engine.api.app:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(SERVER_PORT),
        '--log-level',
        'warning',
      ],
      { cwd: FLOOD_ENGINE_DIR, env: sharedEnv, stdio: 'pipe' },
    );
  } catch {
    return null;
  }

  const apiReady = await waitForServerReady(FLOOD_ENGINE_TEST_BASE_URL, 20_000);
  if (!apiReady) {
    apiProcess.kill();
    return null;
  }

  const workerProcess = spawn(PYTHON_EXECUTABLE, ['-m', 'flood_engine.jobs.worker'], {
    cwd: FLOOD_ENGINE_DIR,
    env: sharedEnv,
    stdio: 'pipe',
  });

  return {
    baseUrl: FLOOD_ENGINE_TEST_BASE_URL,
    async stop(): Promise<void> {
      workerProcess.kill();
      apiProcess.kill();
      // Give both processes a moment to actually exit before the test
      // process itself ends — avoids orphaned processes holding the
      // test-database connection pool open on Windows, where killed
      // processes can take a moment to release sockets.
      await sleep(300);
    },
  };
}
