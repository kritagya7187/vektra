import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

/**
 * vite-plugin-cesium handles the one piece of build plumbing Cesium
 * genuinely requires with any bundler — copying its static Workers/
 * Assets/Widgets/ThirdParty assets into the build output and setting
 * `window.CESIUM_BASE_URL` so the library can find them at runtime. This
 * is asset wiring for the approved CesiumJS dependency (EDD Section 12,
 * 20), not an added framework or plugin ecosystem.
 */
export default defineConfig({
  plugins: [cesium()],
  server: {
    port: 5173,
  },
});
