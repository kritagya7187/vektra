import { BitmapLayer } from '@deck.gl/layers';
import type { AoiBoundsWgs84, FloodOutputSummary } from '../api';
import { arrivalColor, depthColor, durationColor } from '../domain/colormap';
import { gridMax, rasterizeGrid } from '../domain/floodRaster';
import type { LayerVisibility } from '../domain/layers';
import type { TimelineMetric } from '../domain/timeline';

/**
 * Step 20 §3: displays exactly the three real Step 14 summary rasters
 * (max flood depth, arrival time, duration above threshold) already
 * fetched from the backend — no computation happens here, only
 * colormapping + rasterizing already-fetched numbers (domain/colormap.ts,
 * domain/floodRaster.ts) into a deck.gl BitmapLayer draped over the
 * run's own AOI bounds.
 */

export const FLOOD_LAYER_IDS = {
  maxDepth: 'vektra-flood-max-depth',
  arrivalTime: 'vektra-flood-arrival-time',
  duration: 'vektra-flood-duration',
} as const satisfies Record<TimelineMetric, string>;

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

  const maxDepthValue = gridMax(summary.maxDepthM);
  const maxDepthRaster = rasterizeGrid(summary.maxDepthM, (value) =>
    depthColor(value ?? 0, maxDepthValue),
  );

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
      id: FLOOD_LAYER_IDS.maxDepth,
      image: {
        data: maxDepthRaster.data,
        width: maxDepthRaster.width,
        height: maxDepthRaster.height,
      },
      bounds,
      visible: visibility.maxDepth,
      pickable: false,
    }),
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
