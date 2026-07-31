import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDbInfo } from '../helpers/testDbInfo';

/**
 * Log CONTENT (not headers/response bodies, which every other API test
 * already asserts via supertest) cannot be captured through Pino's
 * SonicBoom writer via a process.stdout.write monkey-patch — learned
 * and documented back in Subsystem 2. This spawns the REAL server as a
 * real child process against the SAME shared test container, redirects
 * real OS-level stdout to a file, issues real HTTP requests via fetch,
 * and asserts on the captured structured JSON — the same technique used
 * for every manual verification in Subsystems 2-11, now automated.
 */

const PORT = 3990;
const LOG_PATH = path.join(__dirname, '.logging-test-output.log');
let child: ChildProcess | undefined;

function waitForServerReady(): Promise<void> {
  const deadline = Date.now() + 15_000;
  return new Promise((resolve, reject) => {
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`);
        if (res.status === 200 || res.status === 503) {
          resolve();
          return;
        }
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        reject(new Error('server did not become ready in time'));
        return;
      }
      setTimeout(() => void poll(), 200);
    };
    void poll();
  });
}

beforeAll(async () => {
  if (existsSync(LOG_PATH)) {
    unlinkSync(LOG_PATH);
  }
  const fd = openSync(LOG_PATH, 'a');

  const repoRoot = path.join(__dirname, '..', '..');
  // Spawn node directly against tsx's real CLI entry (dist/cli.mjs)
  // rather than 'npx tsx' — npx resolves to npx.cmd on Windows and would
  // need shell:true, which wraps the real process in cmd.exe; a
  // shell-wrapped child does not reliably receive a real SIGTERM on
  // Windows (the same finding as Subsystem 5's server-bootstrap
  // verification). Spawning node directly avoids that layer entirely, so
  // afterAll's child.kill('SIGTERM') reaches the real process and the
  // graceful-shutdown handler (src/server.ts) actually runs.
  const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  child = spawn(process.execPath, [tsxCli, 'src/server.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      BACKEND_PORT: String(PORT),
      POSTGRES_HOST: testDbInfo.host,
      POSTGRES_PORT: String(testDbInfo.port),
      POSTGRES_DB: testDbInfo.database,
      POSTGRES_USER: testDbInfo.loginUser,
      POSTGRES_PASSWORD: testDbInfo.loginPassword,
      LOG_LEVEL: 'info',
      RATE_LIMIT_ENABLED: 'false',
      CORS_ALLOWED_ORIGINS: 'http://test.local',
    },
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);

  await waitForServerReady();
}, 30_000);

afterAll(() => {
  child?.kill('SIGTERM');
  if (existsSync(LOG_PATH)) {
    unlinkSync(LOG_PATH);
  }
});

function readLogLines(): Record<string, unknown>[] {
  return readFileSync(LOG_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('structured logging (real spawned server, real stdout capture)', () => {
  it('emits structured JSON startup logs (service tag, no pretty-printing)', () => {
    const lines = readLogLines();
    const startupLine = lines.find((l) => l.msg === 'server listening');
    expect(startupLine).toBeDefined();
    expect(startupLine?.service).toBe('vektra-backend');
    expect(startupLine?.level).toBe(30); // pino info
  });

  it('a successful request produces a "request completed" log at info level, carrying the request id', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/data-sources`);
    expect(res.status).toBe(200);
    const requestId = res.headers.get('x-request-id');
    expect(requestId).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 200));
    const lines = readLogLines();
    const line = lines.find((l) => l.requestId === requestId && l.msg === 'request completed');
    expect(line).toBeDefined();
    expect(line?.statusCode).toBe(200);
    expect(line?.level).toBe(30);
  });

  it('a 404 produces a "request completed" log at warn level (status-mapped, not always info)', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/does-not-exist`);
    expect(res.status).toBe(404);
    const requestId = res.headers.get('x-request-id');

    await new Promise((resolve) => setTimeout(resolve, 200));
    const lines = readLogLines();
    const completedLine = lines.find(
      (l) => l.requestId === requestId && l.msg === 'request completed',
    );
    const failedLine = lines.find((l) => l.requestId === requestId && l.msg === 'request failed');
    expect(completedLine?.level).toBe(40); // pino warn
    expect(failedLine?.level).toBe(40);
    expect(failedLine?.code).toBe('NOT_FOUND');
  });

  it('never logs a credential in plaintext anywhere in the captured output', () => {
    const raw = readFileSync(LOG_PATH, 'utf8');
    expect(raw).not.toContain(testDbInfo.loginPassword);
  });
});
