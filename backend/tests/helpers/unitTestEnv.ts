/**
 * Unit tests never open a real database connection, but several modules
 * (src/database/pool.ts, transitively src/logging/logger.ts via
 * src/config) construct real objects (a pg.Pool, a Pino instance) at
 * MODULE LOAD time from src/config, and src/config's loadEnv() calls
 * process.exit(1) if required POSTGRES_* vars are missing — merely
 * IMPORTING one of these modules (e.g. database/healthCheck.ts, to unit
 * test it with an injected fake Database) would otherwise crash the
 * whole unit test process. `new Pool()` itself never eagerly connects,
 * so dummy, never-reachable values are sufficient here — this is not
 * pointing at any real database.
 */
process.env.NODE_ENV = 'test';
process.env.BACKEND_PORT = '3999';
process.env.POSTGRES_HOST = 'unit-test-unused';
process.env.POSTGRES_PORT = '5432';
process.env.POSTGRES_DB = 'unit-test-unused';
process.env.POSTGRES_USER = 'unit-test-unused';
process.env.POSTGRES_PASSWORD = 'unit-test-unused';
process.env.LOG_LEVEL = 'fatal';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.CORS_ALLOWED_ORIGINS = '';
