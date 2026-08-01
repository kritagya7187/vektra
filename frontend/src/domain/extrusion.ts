import type { BuildingGeoJsonProperties } from '../api';

/**
 * EDD Section 20: "extrusion of ingested OSM footprints using available
 * height/building:levels tags (falling back to a documented default
 * extrusion height where tags are absent)." Pure function, no Cesium
 * dependency, so it is independently testable (Section 13's own note
 * that OSM height/level tagging completeness for South Mumbai is
 * unverified — this fallback is expected to apply often).
 *
 * LEVEL_HEIGHT_M is a standard architectural storey-height convention
 * used only to convert a levels COUNT into a height when heightM itself
 * is absent — it is not a measured or scientific value and must never be
 * confused with one; DEFAULT_EXTRUSION_HEIGHT_M is the final fallback
 * when neither tag exists.
 */
export const LEVEL_HEIGHT_M = 3;
export const DEFAULT_EXTRUSION_HEIGHT_M = 6;

export function extrusionHeightFor(building: BuildingGeoJsonProperties): number {
  if (building.heightM !== null && building.heightM > 0) {
    return building.heightM;
  }
  if (building.buildingLevels !== null && building.buildingLevels > 0) {
    return building.buildingLevels * LEVEL_HEIGHT_M;
  }
  return DEFAULT_EXTRUSION_HEIGHT_M;
}
