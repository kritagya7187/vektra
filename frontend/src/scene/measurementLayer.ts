import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { LonLat } from '../domain/measurement';

export const MEASUREMENT_PATH_LAYER_ID = 'vektra-measurement-path';
export const MEASUREMENT_POINTS_LAYER_ID = 'vektra-measurement-points';

const PATH_RGBA: readonly [number, number, number, number] = [232, 179, 74, 220];
const POINT_RGBA: readonly [number, number, number, number] = [232, 179, 74, 255];

export function createMeasurementLayers(points: readonly LonLat[]): Layer[] {
  if (points.length === 0) {
    return [];
  }
  const paths: readonly (readonly LonLat[])[] = points.length > 1 ? [points] : [];
  return [
    new PathLayer<readonly LonLat[]>({
      id: MEASUREMENT_PATH_LAYER_ID,
      data: paths,
      getPath: (path) => path.map(([lon, lat]): [number, number] => [lon, lat]),
      getColor: PATH_RGBA,
      getWidth: 2,
      widthUnits: 'pixels',
    }),
    new ScatterplotLayer<LonLat>({
      id: MEASUREMENT_POINTS_LAYER_ID,
      data: points,
      getPosition: ([lon, lat]) => [lon, lat],
      getFillColor: POINT_RGBA,
      getRadius: 5,
      radiusUnits: 'pixels',
    }),
  ];
}
