import type { Tile3DLayer } from '@deck.gl/geo-layers';
import { config } from '../config';

const GOOGLE_3D_TILES_ROOT_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';
export const PHOTOREALISTIC_TILES_LAYER_ID = 'vektra-google-photorealistic-3d-tiles';

type Tile3DLayerCtor = typeof import('@deck.gl/geo-layers').Tile3DLayer;
type Tiles3DLoaderType = typeof import('@loaders.gl/3d-tiles').Tiles3DLoader;

interface PhotorealisticTilesClasses {
  readonly Tile3DLayer: Tile3DLayerCtor;
  readonly Tiles3DLoader: Tiles3DLoaderType;
}

let cachedClasses: PhotorealisticTilesClasses | null = null;
let loadingPromise: Promise<PhotorealisticTilesClasses> | null = null;

function loadClasses(): Promise<PhotorealisticTilesClasses> {
  if (cachedClasses) {
    return Promise.resolve(cachedClasses);
  }
  loadingPromise ??= Promise.all([
    import('@deck.gl/geo-layers'),
    import('@loaders.gl/3d-tiles'),
  ]).then(([geoLayers, tiles3d]) => {
    cachedClasses = { Tile3DLayer: geoLayers.Tile3DLayer, Tiles3DLoader: tiles3d.Tiles3DLoader };
    return cachedClasses;
  });
  return loadingPromise;
}

export function requestPhotorealisticTilesClasses(onReady: () => void): void {
  if (!config.googleMaps3dTilesApiKey || cachedClasses) {
    return;
  }
  void loadClasses().then(() => onReady());
}

export function createPhotorealisticTilesLayer(visible: boolean): Tile3DLayer | null {
  if (!config.googleMaps3dTilesApiKey || !cachedClasses) {
    return null;
  }
  return new cachedClasses.Tile3DLayer({
    id: PHOTOREALISTIC_TILES_LAYER_ID,
    data: `${GOOGLE_3D_TILES_ROOT_URL}?key=${config.googleMaps3dTilesApiKey}`,
    loader: cachedClasses.Tiles3DLoader,
    visible,
  });
}
