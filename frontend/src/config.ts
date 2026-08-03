/**
 * The one place import.meta.env is read. Vite only exposes VITE_-
 * prefixed variables to client code (.env.example's own note) — nothing
 * here can ever be a real backend secret by construction.
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optionalEnv(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_TERRAIN_TILE_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const config = {
  /**
   * Also fronts the new /api/flood-simulations proxy routes (Step 20
   * Part 0b) -- they're mounted on the same Express apiRouter as every
   * other resource (buildings, simulation-runs, ...), not a separate
   * service, so no separate base URL is needed. Never point any client
   * at the Python FastAPI service directly.
   */
  apiBaseUrl: requireEnv('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL),
  /** A free, no-key MapLibre style by default — overridable for a paid/self-hosted provider. */
  mapStyleUrl: import.meta.env.VITE_MAP_STYLE_URL || DEFAULT_MAP_STYLE_URL,
  /** AWS's public Terrarium raster-DEM tiles by default — no key needed, overridable. */
  terrainTileUrl: import.meta.env.VITE_TERRAIN_TILE_URL || DEFAULT_TERRAIN_TILE_URL,
  /**
   * Google Photorealistic 3D Tiles requires a Google Cloud Maps
   * Platform API key with the Map Tiles API enabled — a real external
   * credential this codebase cannot supply or verify itself. Left
   * optional, not requireEnv()'d: the viewer must render terrain/
   * imagery/flood layers normally without it, only omitting the
   * photorealistic building layer (see scene/photorealisticTilesLayer.ts).
   */
  googleMaps3dTilesApiKey: optionalEnv(import.meta.env.VITE_GOOGLE_3D_TILES_API_KEY),
} as const;
