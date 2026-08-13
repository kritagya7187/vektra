import type { Map as MaplibreMap } from 'maplibre-gl';
import type { AoiBoundsWgs84 } from '../api';
import { geometryBounds } from '../domain/geometryBounds';
import type { TwinBuilding } from '../domain/twinBuildings';
const FLY_DURATION_MS = 1500;
const FIT_PADDING_PX = 60;
const OBLIQUE_PITCH_DEGREES = 45;
const OBLIQUE_BEARING_DEGREES = -30;
function whenReady(map: MaplibreMap, run: () => void): void {
  if (map.loaded()) {
    run();
    return;
  }
  map.once('load', run);
}
export function flyToBuildings(map: MaplibreMap, twinBuildings: readonly TwinBuilding[]): void {
  const bounds = geometryBounds(twinBuildings.map((twinBuilding) => twinBuilding.geometry));
  if (!bounds) {
    return;
  }
  whenReady(map, () => {
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
  });
}
export function flyToAoi(map: MaplibreMap, aoiBoundsWgs84: AoiBoundsWgs84): void {
  const [west, south, east, north] = aoiBoundsWgs84;
  whenReady(map, () => {
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        duration: FLY_DURATION_MS,
        padding: FIT_PADDING_PX,
        pitch: OBLIQUE_PITCH_DEGREES,
        bearing: OBLIQUE_BEARING_DEGREES,
      },
    );
  });
}
export function resetCamera(map: MaplibreMap): void {
  whenReady(map, () => {
    map.easeTo({ pitch: 0, bearing: 0, duration: FLY_DURATION_MS });
  });
}
