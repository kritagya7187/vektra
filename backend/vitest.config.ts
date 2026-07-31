import { defineConfig } from 'vitest/config';

/**
 * Unit tests only — no Docker, no network, no shared state between
 * files, so full parallelism is safe (unlike vitest.integration.config.ts).
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    setupFiles: ['tests/helpers/unitTestEnv.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/unit',
      include: ['src/**/*.ts'],
    },
  },
});
