import type { HeatExposureResult } from '../api';

/**
 * Design review §19, the "Critical UX Requirement": HeatExposureResult.
 * indexValue is currently NULL for every result the backend has ever
 * produced (EDD Section 18's combination methodology is explicitly
 * "Requires future implementation"). This module is the single place
 * that decision is enforced for rendering — every building renders with
 * the same neutral, honest material until a real value exists.
 *
 * Colors are plain CSS strings, not Cesium.Color — this module has no
 * Cesium dependency, keeping it a pure, independently-testable mapping
 * (scene/buildingLayer.ts is the only place that converts to Cesium's
 * own color type).
 */
export interface BuildingStyle {
  readonly fillColorCss: string;
  readonly outlineColorCss: string;
  readonly hasComputedIndex: boolean;
}

/**
 * Thermal-field visual redirect: neutral "context city" tone shifted
 * from a dark slate to a light near-white — matching the reference
 * urban-planning visualization's "quiet, neutral base city" language.
 * Still deliberately not a "cold" color on any heat ramp (a light warm-
 * neutral grey, not the ramp's own blue endpoint) — not the first step
 * of an implied gradient. Exported so colorRamps.ts's "no data" state
 * can reuse these exact values rather than a second, hand-duplicated
 * grey — a building with no computable value should read as part of
 * the neutral context city, not as a distinct "error" grey.
 */
export const NEUTRAL_FILL_CSS = '#f0f2f4';
export const NEUTRAL_OUTLINE_CSS = '#aab4bd';

export const SELECTED_OUTLINE_CSS = '#e8b34a';

export function styleForResult(result: HeatExposureResult): BuildingStyle {
  const hasComputedIndex = result.indexValue !== null;

  // Section 18's weights/normalization are not yet defined anywhere —
  // there is no ramp to apply even on a future row where indexValue is
  // non-null, so styling stays neutral regardless. This is the one
  // branch a future phase would change once that methodology exists;
  // it deliberately computes nothing today rather than inventing a
  // temporary scale (explicitly forbidden by the approved design).
  return {
    fillColorCss: NEUTRAL_FILL_CSS,
    outlineColorCss: NEUTRAL_OUTLINE_CSS,
    hasComputedIndex,
  };
}
