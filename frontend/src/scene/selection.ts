import type { PickingInfo } from '@deck.gl/core';
import { buildingIdFromPickInfo } from './buildingLayer';
export interface MapClickResult {
  readonly buildingId: string | null;
  readonly lon: number;
  readonly lat: number;
  readonly screenX: number;
  readonly screenY: number;
}
export function resolveMapClick(info: PickingInfo): MapClickResult | null {
  const coordinate = info.coordinate as readonly [number, number] | undefined;
  if (!coordinate) {
    return null;
  }
  return {
    buildingId: buildingIdFromPickInfo(info),
    lon: coordinate[0],
    lat: coordinate[1],
    screenX: info.x,
    screenY: info.y,
  };
}
