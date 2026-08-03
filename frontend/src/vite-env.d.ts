/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_MAP_STYLE_URL?: string;
  readonly VITE_TERRAIN_TILE_URL?: string;
  readonly VITE_GOOGLE_3D_TILES_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
