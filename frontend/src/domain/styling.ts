/**
 * Colors are plain CSS strings, not Cesium.Color — this module has no
 * Cesium dependency, keeping it a pure, independently-testable mapping
 * (scene/buildingLayer.ts is the only place that converts to Cesium's
 * own color type).
 */
export interface BuildingStyle {
  readonly fillColorCss: string;
  readonly outlineColorCss: string;
}

/**
 * Neutral "context city" tone: a light warm-neutral grey, not the first
 * step of any implied data-driven gradient — every building renders with
 * this same honest, non-committal material until a domain-specific
 * visualization is built on top of it.
 */
export const NEUTRAL_FILL_CSS = '#f0f2f4';
export const NEUTRAL_OUTLINE_CSS = '#aab4bd';

export const SELECTED_OUTLINE_CSS = '#e8b34a';

export function defaultBuildingStyle(): BuildingStyle {
  return {
    fillColorCss: NEUTRAL_FILL_CSS,
    outlineColorCss: NEUTRAL_OUTLINE_CSS,
  };
}
