import { PolygonLayer } from '@deck.gl/layers';
import type { AoiBoundsWgs84 } from '../api';
import { buildWaterMesh, type WaterCell } from '../domain/waterMesh';

export const FLOOD_WATER_LAYER_ID = 'vektra-flood-water';

const WATER_RGBA: readonly [number, number, number, number] = [36, 98, 176, 195];
const ELEVATION_SCALE = 1;

export function createFloodWaterLayer(
  grid: readonly (readonly number[])[],
  aoiBoundsWgs84: AoiBoundsWgs84,
  visible: boolean,
): PolygonLayer<WaterCell> {
  const data = buildWaterMesh(grid, aoiBoundsWgs84);
  return new PolygonLayer<WaterCell>({
    id: FLOOD_WATER_LAYER_ID,
    data,
    visible,
    extruded: true,
    filled: true,
    stroked: false,
    getPolygon: (cell) => cell.polygon,
    getElevation: (cell) => cell.depth * ELEVATION_SCALE,
    getFillColor: WATER_RGBA,
    material: {
      ambient: 0.25,
      diffuse: 0.55,
      shininess: 96,
      specularColor: [225, 238, 255],
    },
  });
}
