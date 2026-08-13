import { GeoJsonLayer } from '@deck.gl/layers';
import type { FeatureCollection } from 'geojson';
import type { CityRunBoundary } from '../api';

export const ADMIN_BOUNDARY_LAYER_ID = 'vektra-admin-boundary';
const LINE_RGBA: readonly [number, number, number, number] = [232, 179, 74, 210];

export function createAdminBoundaryLayer(
  boundary: CityRunBoundary | null,
  visible: boolean,
): GeoJsonLayer | null {
  if (!boundary) {
    return null;
  }
  return new GeoJsonLayer({
    id: ADMIN_BOUNDARY_LAYER_ID,
    data: boundary as unknown as FeatureCollection,
    visible,
    pickable: false,
    filled: false,
    stroked: true,
    getLineColor: LINE_RGBA,
    getLineWidth: 3,
    lineWidthMinPixels: 2,
  });
}
