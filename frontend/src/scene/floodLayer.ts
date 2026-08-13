import { BitmapLayer } from '@deck.gl/layers';
import type { AoiBoundsWgs84, FloodOutputSummary } from '../api';
import { arrivalColor, durationColor } from '../domain/colormap';
import { gridMax, rasterizeGrid } from '../domain/floodRaster';
import type { LayerVisibility } from '../domain/layers';
export const FLOOD_LAYER_IDS = {
  arrivalTime: 'vektra-flood-arrival-time',
  duration: 'vektra-flood-duration',
} as const;
function toBounds(aoi: AoiBoundsWgs84): [number, number, number, number] {
  const [west, south, east, north] = aoi;
  return [west, south, east, north];
}
export function createFloodLayers(
  summary: FloodOutputSummary,
  aoiBoundsWgs84: AoiBoundsWgs84,
  visibility: LayerVisibility,
): readonly BitmapLayer[] {
  const bounds = toBounds(aoiBoundsWgs84);
  const maxArrivalValue = gridMax(summary.arrivalTimeMin);
  const arrivalRaster = rasterizeGrid(summary.arrivalTimeMin, (value) =>
    arrivalColor(value, maxArrivalValue),
  );
  const maxDurationValue = gridMax(summary.durationAboveThresholdMin);
  const durationRaster = rasterizeGrid(summary.durationAboveThresholdMin, (value) =>
    durationColor(value ?? 0, maxDurationValue),
  );
  return [
    new BitmapLayer({
      id: FLOOD_LAYER_IDS.arrivalTime,
      image: { data: arrivalRaster.data, width: arrivalRaster.width, height: arrivalRaster.height },
      bounds,
      visible: visibility.arrivalTime,
      pickable: false,
    }),
    new BitmapLayer({
      id: FLOOD_LAYER_IDS.duration,
      image: {
        data: durationRaster.data,
        width: durationRaster.width,
        height: durationRaster.height,
      },
      bounds,
      visible: visibility.duration,
      pickable: false,
    }),
  ];
}
