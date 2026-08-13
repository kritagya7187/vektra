import { GeoJsonLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import type { FeatureCollection } from 'geojson';
import type { AoiBoundsWgs84, BuildingGeoJsonProperties } from '../api';
import { heightFor, isHeightEstimated } from '../domain/buildingHeight';
import { geometryCentroid } from '../domain/geometryCentroid';
import { sampleGridAt } from '../domain/floodRaster';
import type { TwinBuilding } from '../domain/twinBuildings';
export const BUILDING_LAYER_ID = 'vektra-building-layer';
const FILL_RGB: readonly [number, number, number] = [140, 158, 173];
const FLOOD_AFFECTED_RGB: readonly [number, number, number] = [214, 96, 74];
const ESTIMATED_ALPHA = 150;
const NORMAL_ALPHA = 235;
const SELECTED_RGB: readonly [number, number, number] = [232, 179, 74];
const HIGHLIGHT_RGBA: [number, number, number, number] = [232, 179, 74, 90];
const SELECTED_LINE_RGBA: readonly [number, number, number, number] = [232, 179, 74, 255];
const TRANSPARENT_LINE_RGBA: readonly [number, number, number, number] = [0, 0, 0, 0];
function toFeatureCollection(
  twinBuildings: readonly TwinBuilding[],
): FeatureCollection<never, BuildingGeoJsonProperties> {
  return {
    type: 'FeatureCollection',
    features: twinBuildings.map((twinBuilding) => ({
      type: 'Feature',
      properties: twinBuilding.building,
      geometry: twinBuilding.geometry,
    })),
  } as unknown as FeatureCollection<never, BuildingGeoJsonProperties>;
}
export interface FloodContext {
  readonly maxDepthM: readonly (readonly number[])[];
  readonly aoiBoundsWgs84: AoiBoundsWgs84;
}
function floodAffectedBuildingIds(
  twinBuildings: readonly TwinBuilding[],
  flood: FloodContext | null,
): ReadonlySet<string> {
  if (!flood) {
    return new Set();
  }
  const affected = new Set<string>();
  for (const twinBuilding of twinBuildings) {
    const centroid = geometryCentroid(twinBuilding.geometry);
    const depth = sampleGridAt(flood.maxDepthM, flood.aoiBoundsWgs84, centroid.lon, centroid.lat);
    if (depth !== null && depth > 0) {
      affected.add(twinBuilding.building.buildingId);
    }
  }
  return affected;
}
export function createBuildingLayer(
  twinBuildings: readonly TwinBuilding[],
  selectedBuildingId: string | null,
  visible: boolean,
  flood: FloodContext | null = null,
  extruded = true,
): GeoJsonLayer {
  const affectedIds = floodAffectedBuildingIds(twinBuildings, flood);
  return new GeoJsonLayer({
    id: BUILDING_LAYER_ID,
    data: toFeatureCollection(twinBuildings),
    visible,
    pickable: true,
    extruded,
    filled: true,
    stroked: true,
    wireframe: false,
    autoHighlight: true,
    highlightColor: HIGHLIGHT_RGBA,
    lineWidthMinPixels: 1.5,
    getElevation: (feature) => heightFor(feature.properties as BuildingGeoJsonProperties),
    getFillColor: (feature): [number, number, number, number] => {
      const properties = feature.properties as BuildingGeoJsonProperties;
      const alpha = isHeightEstimated(properties) ? ESTIMATED_ALPHA : NORMAL_ALPHA;
      if (properties.buildingId === selectedBuildingId) {
        return [...SELECTED_RGB, alpha];
      }
      if (affectedIds.has(properties.buildingId)) {
        return [...FLOOD_AFFECTED_RGB, alpha];
      }
      return [...FILL_RGB, alpha];
    },
    getLineColor: (feature): readonly [number, number, number, number] => {
      const properties = feature.properties as BuildingGeoJsonProperties;
      return properties.buildingId === selectedBuildingId
        ? SELECTED_LINE_RGBA
        : TRANSPARENT_LINE_RGBA;
    },
    updateTriggers: {
      getFillColor: [selectedBuildingId, affectedIds],
      getLineColor: [selectedBuildingId],
    },
  });
}
export function buildingIdFromPickInfo(info: PickingInfo): string | null {
  const feature = info.object as
    | {
        properties?: {
          buildingId?: unknown;
        };
      }
    | undefined;
  const buildingId = feature?.properties?.buildingId;
  return typeof buildingId === 'string' ? buildingId : null;
}
