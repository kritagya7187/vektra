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
const DEFAULT_MAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const DEFAULT_TERRAIN_TILE_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const config = {
  apiBaseUrl: requireEnv('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL),
  mapStyleUrl: import.meta.env.VITE_MAP_STYLE_URL || DEFAULT_MAP_STYLE_URL,
  terrainTileUrl: import.meta.env.VITE_TERRAIN_TILE_URL || DEFAULT_TERRAIN_TILE_URL,
  googleMaps3dTilesApiKey: optionalEnv(import.meta.env.VITE_GOOGLE_3D_TILES_API_KEY),
} as const;
