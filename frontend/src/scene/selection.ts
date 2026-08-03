import type { PickingInfo } from '@deck.gl/core';
import { buildingIdFromPickInfo } from './buildingPickLayer';

/**
 * Step 20 §7: a single map click can mean one of two things -- selecting
 * a building (if it hit the invisible pick layer) or inspecting the
 * flood layer at that point (coordinates + max depth + arrival time +
 * duration, no exposure/damage computation). Both are resolved from the
 * same deck.gl pick result, since only one click actually happened.
 *
 * Pure translation function, no side effects, no MapLibre/deck.gl
 * instance ownership -- unlike the retired Cesium
 * ScreenSpaceEventHandler this file used to wrap, a deck.gl MapboxOverlay
 * needs no separate handler object to construct or destroy; twinScene.ts
 * wires this directly into the overlay's own onClick prop.
 */
export interface MapClickResult {
  readonly buildingId: string | null;
  readonly lon: number;
  readonly lat: number;
}

/** Null only when the click produced no resolvable map coordinate at all (e.g. off the rendered globe). */
export function resolveMapClick(info: PickingInfo): MapClickResult | null {
  const coordinate = info.coordinate as readonly [number, number] | undefined;
  if (!coordinate) {
    return null;
  }
  return {
    buildingId: buildingIdFromPickInfo(info),
    lon: coordinate[0],
    lat: coordinate[1],
  };
}
