import type { BuildingGeoJsonProperties } from '../api';
const LEVEL_HEIGHT_M = 3;
const DEFAULT_HEIGHT_M = 6;
export function heightFor(building: BuildingGeoJsonProperties): number {
  if (building.heightM !== null) {
    return building.heightM;
  }
  if (building.buildingLevels !== null) {
    return building.buildingLevels * LEVEL_HEIGHT_M;
  }
  return DEFAULT_HEIGHT_M;
}
export function isHeightEstimated(building: BuildingGeoJsonProperties): boolean {
  return building.heightM === null;
}
