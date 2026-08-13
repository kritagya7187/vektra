import type { Map as MaplibreMap } from 'maplibre-gl';

export const NOISE_LAYER_IDS: readonly string[] = [
  'building',
  'building-top',
  'poi_stadium',
  'poi_park',
  'housenumber',
  'place_hamlet',
  'place_suburbs',
  'place_villages',
  'roadname_minor',
  'roadname_sec',
  'watername_lake_line',
];

export function applyMinimalBasemapStyle(map: MaplibreMap): void {
  for (const id of NOISE_LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'none');
    }
  }
}
