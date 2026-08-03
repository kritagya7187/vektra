import { defineConfig } from 'vite';

/**
 * Step 20: MapLibre GL JS + deck.gl need no special bundler plugin (both
 * are plain npm packages with their own CSS imported directly from
 * source, unlike Cesium's Workers/Assets/Widgets static-file requirement
 * vite-plugin-cesium existed to solve) -- this file is now a plain Vite
 * config.
 */
export default defineConfig({
  server: {
    port: 5173,
  },
});
