import { Tile3DLayer } from '@deck.gl/geo-layers';
import { Tiles3DLoader } from '@loaders.gl/3d-tiles';
import { config } from '../config';

/**
 * Step 20 §2: Google Photorealistic 3D Tiles, streamed and GPU-rendered
 * through deck.gl's Tile3DLayer — no manual building extrusion, no
 * building mesh construction anywhere in this codebase (the entire
 * point of using this layer instead of the retired scene/buildingLayer.ts
 * extrusion approach).
 *
 * Requires a Google Cloud Maps Platform API key with the Map Tiles API
 * enabled (`config.googleMaps3dTilesApiKey`) — a real external credential
 * this codebase cannot obtain or verify itself (no live browser/network
 * access in this development environment). The `?key=` query-string
 * auth pattern below matches Google's own documented Map Tiles API
 * usage; end-to-end behavior against a real key has not been visually
 * confirmed here and is flagged in the Step 20 freeze audit as
 * something to verify once a real key is available.
 */

const GOOGLE_3D_TILES_ROOT_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';
export const PHOTOREALISTIC_TILES_LAYER_ID = 'vektra-google-photorealistic-3d-tiles';

/** Returns null (no layer at all) when no API key is configured — the viewer must still render terrain/imagery/flood layers normally without it. */
export function createPhotorealisticTilesLayer(visible: boolean): Tile3DLayer | null {
  if (!config.googleMaps3dTilesApiKey) {
    return null;
  }
  return new Tile3DLayer({
    id: PHOTOREALISTIC_TILES_LAYER_ID,
    data: `${GOOGLE_3D_TILES_ROOT_URL}?key=${config.googleMaps3dTilesApiKey}`,
    loader: Tiles3DLoader,
    visible,
  });
}
