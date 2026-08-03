import type { Map as MaplibreMap } from 'maplibre-gl';
import type { AoiBoundsWgs84 } from '../api';
import { geometryBounds } from '../domain/geometryBounds';
import type { TwinBuilding } from '../domain/twinBuildings';

/**
 * Step 20 §8: reset / zoom-to-AOI / rotate / pitch / free navigation.
 * Rotate, pitch, and free navigation are native MapLibre drag/touch/
 * scroll gestures plus the NavigationControl added in scene/mapViewer.ts
 * — nothing to implement here. No hardcoded coordinate: fit-to-data,
 * carrying forward the same rule the original design review applied to
 * the retired Cesium camera.ts ("the camera frames whatever data is
 * actually loaded").
 */

const FLY_DURATION_MS = 1500;
const FIT_PADDING_PX = 60;
const OBLIQUE_PITCH_DEGREES = 45;
const OBLIQUE_BEARING_DEGREES = -30;

export function flyToBuildings(map: MaplibreMap, twinBuildings: readonly TwinBuilding[]): void {
  const bounds = geometryBounds(twinBuildings.map((twinBuilding) => twinBuilding.geometry));
  if (!bounds) {
    return;
  }
  map.fitBounds(
    [
      [bounds.west, bounds.south],
      [bounds.east, bounds.north],
    ],
    {
      duration: FLY_DURATION_MS,
      padding: FIT_PADDING_PX,
      pitch: OBLIQUE_PITCH_DEGREES,
      bearing: OBLIQUE_BEARING_DEGREES,
    },
  );
}

export function flyToAoi(map: MaplibreMap, aoiBoundsWgs84: AoiBoundsWgs84): void {
  const [west, south, east, north] = aoiBoundsWgs84;
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { duration: FLY_DURATION_MS, padding: FIT_PADDING_PX },
  );
}

/** Camera reset (§8): back to a top-down, north-up view at the current position — never a hardcoded location. */
export function resetCamera(map: MaplibreMap): void {
  map.easeTo({ pitch: 0, bearing: 0, duration: FLY_DURATION_MS });
}
