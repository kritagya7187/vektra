import {
  FullscreenControl,
  Map as MaplibreMap,
  NavigationControl,
  ScaleControl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { config } from '../config';

/**
 * Step 20: a single MapLibre GL JS Map instance, replacing the single
 * Cesium Viewer instance scene/viewer.ts used to own (same "one
 * long-lived instance, main.ts constructs it exactly once" contract).
 *
 * No hardcoded AOI/center — matches the original design review's "no
 * bounding box hardcoded... fit-to-data, not a fixed coordinate"
 * decision (scene/camera.ts carries the same rule forward). Terrain uses
 * a raster-DEM source (Terrarium-encoded, `config.terrainTileUrl`,
 * defaulting to AWS's free public tiles — no key needed), MapLibre's own
 * native terrain support, not a Cesium-ion-specific API.
 */

const TERRAIN_SOURCE_ID = 'vektra-terrain-dem';
const TERRAIN_TILE_SIZE = 256;
const DEFAULT_TERRAIN_EXAGGERATION = 1;
const INITIAL_ZOOM = 2;

export function createMap(container: HTMLElement): MaplibreMap {
  const map = new MaplibreMap({
    container,
    style: config.mapStyleUrl,
    center: [0, 0],
    zoom: INITIAL_ZOOM,
  });

  map.addControl(new NavigationControl(), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new FullscreenControl(), 'top-right');

  map.on('load', () => {
    map.addSource(TERRAIN_SOURCE_ID, {
      type: 'raster-dem',
      tiles: [config.terrainTileUrl],
      tileSize: TERRAIN_TILE_SIZE,
      encoding: 'terrarium',
    });
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: DEFAULT_TERRAIN_EXAGGERATION });
  });

  return map;
}

/** Layer Controls (§6): terrain on/off, without tearing down and recreating the source. */
export function setTerrainVisible(map: MaplibreMap, visible: boolean): void {
  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    return;
  }
  map.setTerrain(
    visible ? { source: TERRAIN_SOURCE_ID, exaggeration: DEFAULT_TERRAIN_EXAGGERATION } : null,
  );
}

/**
 * Layer Controls (§6): base imagery on/off. MapLibre vector styles have
 * no single "imagery" layer to toggle — every layer the style itself
 * defines is toggled together, leaving only layers this app adds
 * separately (deck.gl overlays, which aren't MapLibre style layers at
 * all) unaffected.
 */
export function setImageryVisible(map: MaplibreMap, visible: boolean): void {
  const style = map.getStyle();
  if (!style?.layers) {
    return;
  }
  for (const layer of style.layers) {
    map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
  }
}
