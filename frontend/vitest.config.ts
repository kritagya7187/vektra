import { defineConfig } from 'vite';

/**
 * Unit tests only — API clients, domain mapping (building/result join,
 * effective-attribute resolution, flood-raster colormapping, the
 * timeline reducer), and the state stores are pure TypeScript with no
 * MapLibre/deck.gl/DOM dependency, so a plain Node test environment is
 * sufficient and matches backend/vitest.config.ts's own choice not to
 * reach for a heavier environment than the code under test needs.
 * MapLibre/deck.gl themselves require a real WebGL context this
 * environment cannot provide — see FLOOD_ENGINE_INTEGRATION.md-style
 * documentation (Step 20's own freeze audit) for how rendering was
 * verified instead; this is the same limitation the Cesium-based scene
 * layer already had before Step 20 replaced it, not a new gap.
 *
 * `test.env` provides dummy import.meta.env.VITE_* values for the test
 * run itself — src/config.ts's requireEnv() throws at module import time
 * if either is missing (by design, so a real misconfigured deployment
 * fails loudly rather than silently), and any test file that imports
 * src/api/client.ts (directly or transitively, e.g.
 * tests/unit/api/client.test.ts) therefore crashes without this on a
 * fresh checkout with no .env file — exactly what happened in CI (no
 * .env is ever committed; frontend/.env.example is a template, not a
 * fallback). This mirrors backend/tests/helpers/unitTestEnv.ts, which
 * solves the identical problem (its own config.ts calls loadEnv() at
 * import time too) via the same "provide harmless dummy values so
 * config validation succeeds, nothing real is ever contacted" approach —
 * not a new pattern invented for the frontend, the existing one applied
 * where the frontend needed it. Values are deliberately obvious
 * non-endpoints; no test in this suite ever performs a real network
 * request (api/client.test.ts stubs `fetch` itself).
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
    env: {
      VITE_API_BASE_URL: 'http://unit-test-unused.invalid',
    },
  },
});
