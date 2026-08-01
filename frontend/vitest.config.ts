import { defineConfig } from 'vite';

/**
 * Unit tests only — API client, domain mapping (building/result join,
 * effective-attribute resolution), and the state store are pure
 * TypeScript with no Cesium/DOM dependency, so a plain Node test
 * environment is sufficient and matches backend/vitest.config.ts's own
 * choice not to reach for a heavier environment than the code under test
 * needs. Cesium itself requires a real WebGL context this environment
 * cannot provide — see the engineering report's verification section for
 * how rendering was verified instead.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
