import { testDbInfo } from './testDbInfo';
import { FLOOD_ENGINE_TEST_BASE_URL } from './floodEngineServer';

/**
 * Runs before any test file's imports resolve (Vitest setupFiles
 * ordering) — critical, since src/config/config.ts reads process.env
 * exactly once, at first import. Every test file that imports anything
 * from src/ (directly or transitively) gets the real, disposable test
 * container's connection info, not a real .env (none exists in this
 * repo, per every prior subsystem).
 */
process.env.NODE_ENV = 'test';
// Unused by API tests (supertest wraps the app in-process, no real
// listen()) but env.schema.ts requires a positive integer regardless.
process.env.BACKEND_PORT = '3998';
process.env.POSTGRES_HOST = testDbInfo.host;
process.env.POSTGRES_PORT = String(testDbInfo.port);
process.env.POSTGRES_DB = testDbInfo.database;
process.env.POSTGRES_USER = testDbInfo.loginUser;
process.env.POSTGRES_PASSWORD = testDbInfo.loginPassword;
// 'silent' isn't one of env.schema.ts's allowed LOG_LEVEL values (fatal
// through trace) — not extending that enum just to quiet test output.
// 'fatal' is the quietest level the existing schema already supports.
process.env.LOG_LEVEL = 'fatal';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.CORS_ALLOWED_ORIGINS = 'http://test.local';
// Step 20 Part 0b: fixed to the same port tests/helpers/floodEngineServer.ts
// always spawns its real server on -- so config.floodEngine.baseUrl (read
// once, here, before any test file's imports resolve, same constraint as
// POSTGRES_* above) already points at the right place by the time a real
// server actually gets started in a given test file's own beforeAll. Inert
// for every test file that never calls getFloodEngineClient().
process.env.FLOOD_ENGINE_BASE_URL = FLOOD_ENGINE_TEST_BASE_URL;
process.env.FLOOD_ENGINE_TIMEOUT_MS = '10000';
process.env.FLOOD_ENGINE_MAX_RETRIES = '1';
