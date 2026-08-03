import { GeoJsonLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import type { FeatureCollection } from 'geojson';
import type { BuildingGeoJsonProperties } from '../api';
import type { TwinBuilding } from '../domain/twinBuildings';

/**
 * Step 20 §2/§7: retires scene/buildingLayer.ts's manual Cesium-entity
 * extrusion (visible geometry is now Google Photorealistic 3D Tiles —
 * rendering both would be exactly the "duplicate building rendering"
 * this step's spec forbids). This layer is invisible (fully transparent
 * fill, no stroke) and exists only so a click can still resolve to a
 * `buildingId` — preserving the existing building-inspection feature
 * (state/buildingState.ts, panels/inspectionPanel.ts, both otherwise
 * completely unchanged) without rendering anything of its own.
 */

export const BUILDING_PICK_LAYER_ID = 'vektra-building-pick';

const TRANSPARENT: readonly [number, number, number, number] = [0, 0, 0, 0];

/**
 * Cast to the real `geojson` package's shape, which is what deck.gl's
 * GeoJsonLayer actually types its `data` prop against — this project's
 * own local GeoJsonFeatureCollection type (api/geometry.ts) is
 * structurally identical JSON but a nominally distinct TS type, and a
 * readonly array isn't assignable to GeoJSON's mutable `features: []`.
 * No data is reshaped, only the compile-time type changes.
 */
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

export function createBuildingPickLayer(twinBuildings: readonly TwinBuilding[]): GeoJsonLayer {
  return new GeoJsonLayer({
    id: BUILDING_PICK_LAYER_ID,
    data: toFeatureCollection(twinBuildings),
    pickable: true,
    stroked: false,
    filled: true,
    getFillColor: TRANSPARENT,
  });
}

/** Reads the buildingId off a deck.gl pick result — null for a click that hit nothing. */
export function buildingIdFromPickInfo(info: PickingInfo): string | null {
  const feature = info.object as { properties?: { buildingId?: unknown } } | undefined;
  const buildingId = feature?.properties?.buildingId;
  return typeof buildingId === 'string' ? buildingId : null;
}
