import { Tile3DLayer } from '@deck.gl/geo-layers';
import { Tiles3DLoader } from '@loaders.gl/3d-tiles';
import { config } from '../config';
const GOOGLE_3D_TILES_ROOT_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';
export const PHOTOREALISTIC_TILES_LAYER_ID = 'vektra-google-photorealistic-3d-tiles';
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
