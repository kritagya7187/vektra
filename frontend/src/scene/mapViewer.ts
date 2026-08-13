import {
  FullscreenControl,
  Map as MaplibreMap,
  NavigationControl,
  ScaleControl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { config } from '../config';
import { applyMinimalBasemapStyle, NOISE_LAYER_IDS } from './basemapStyle';
const TERRAIN_SOURCE_ID = 'vektra-terrain-dem';
const TERRAIN_TILE_SIZE = 256;
const DEFAULT_TERRAIN_EXAGGERATION = 1;
const TERRAIN_MAX_ZOOM = 15;
/**
 * elevation-tiles-prod (AWS Terrarium) has no real tiles above z15 for
 * this region -- verified directly (z14/z15 return 200, z16 returns 404).
 * Without a maxzoom cap, MapLibre requests z16+ while pitched/zoomed in,
 * gets 404s, and deck.gl's view-state sync reads undefined elevation from
 * the resulting gap, crashing with "Cannot read properties of undefined
 * (reading 'elevation')". Capping maxzoom makes MapLibre overzoom the
 * real z15 tile instead of requesting tiles that don't exist.
 */
const INITIAL_CENTER: [number, number] = [72.85, 18.94];
const INITIAL_ZOOM = 11;
const INITIAL_PITCH = 45;
const INITIAL_BEARING = -30;
export function createMap(container: HTMLElement): MaplibreMap {
  const map = new MaplibreMap({
    container,
    style: config.mapStyleUrl,
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    pitch: INITIAL_PITCH,
    bearing: INITIAL_BEARING,
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
      maxzoom: TERRAIN_MAX_ZOOM,
    });
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: DEFAULT_TERRAIN_EXAGGERATION });
    applyMinimalBasemapStyle(map);
  });
  return map;
}
export function setTerrainVisible(map: MaplibreMap, visible: boolean): void {
  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    return;
  }
  map.setTerrain(
    visible ? { source: TERRAIN_SOURCE_ID, exaggeration: DEFAULT_TERRAIN_EXAGGERATION } : null,
  );
}
export function setImageryVisible(map: MaplibreMap, visible: boolean): void {
  const style = map.getStyle();
  if (!style?.layers) {
    return;
  }
  for (const layer of style.layers) {
    if (visible && NOISE_LAYER_IDS.includes(layer.id)) {
      continue;
    }
    map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
  }
}
