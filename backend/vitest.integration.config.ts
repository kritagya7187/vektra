import { defineConfig } from 'vitest/config';

/**
 * Integration + API tests — share ONE disposable postgis/postgis
 * container across every file (globalSetup starts/stops it), so file
 * parallelism is disabled: concurrent truncate/seed against the same
 * database would race. Per-test isolation instead comes from
 * tests/helpers/resetDb.ts's beforeEach (TRUNCATE ... CASCADE, keeping
 * seeded data_source rows), not from separate containers or files.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts', 'tests/api/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    globalSetup: ['tests/helpers/globalSetup.ts'],
    setupFiles: ['tests/helpers/testEnv.ts', 'tests/helpers/resetDb.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/integration',
      include: ['src/**/*.ts'],
    },
  },
});
