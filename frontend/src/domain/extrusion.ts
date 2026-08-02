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

/**
 * True when extrusionHeightFor() had neither real tag to work with and
 * fell all the way through to DEFAULT_EXTRUSION_HEIGHT_M — a legitimate,
 * EDD-permitted fallback, but one that was never visually or textually
 * disclosed as an estimate until the visualization redesign. The single
 * source both scene/buildingLayer.ts's alpha treatment and the
 * inspection panel's text read, so the two can't drift out of sync with
 * each other or with extrusionHeightFor()'s own real fallback condition.
 */
export function isHeightEstimated(building: BuildingGeoJsonProperties): boolean {
  const hasRealHeight = building.heightM !== null && building.heightM > 0;
  const hasRealLevels = building.buildingLevels !== null && building.buildingLevels > 0;
  return !hasRealHeight && !hasRealLevels;
}
