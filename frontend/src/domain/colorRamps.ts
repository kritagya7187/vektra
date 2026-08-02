import type { HeatExposureFactorValue } from '../api';
import { NEUTRAL_FILL_CSS, NEUTRAL_OUTLINE_CSS, type BuildingStyle } from './styling';
import type { TwinBuilding } from './joinBuildingsWithResults';

/**
 * Visualization redesign — the single source of truth for turning real
 * factor values into color, shared identically by the 3D scene
 * (scene/buildingLayer.ts) and the 2D legend (panels/legendBar.ts) so
 * the two can never drift. Deliberately separate from domain/styling.ts:
 * styleForResult() there stays untouched, since it correctly enforces a
 * DIFFERENT invariant (the composite indexValue is never colored,
 * because it is never computed) — this module colors individual FACTOR
 * values instead, a distinct, real, currently-computable data source.
 *
 * 'landcover' is a real, named mode (it appears in the layer control),
 * but has no ramp implementation here: ESA WorldCover is not exposed as
 * structured per-building data anywhere in the API today (only
 * unstructured prose inside vegetation_land_cover's own `notes`) — see
 * panels/layerControl.ts for the disabled-with-explanation UI treatment.
 * Every function here treats 'landcover' as "no data", never fabricating
 * a color for it.
 */
export type VisualizationMode = 'default' | 'thermal' | 'ndvi' | 'landcover';

export interface DataRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Reuses styling.ts's own neutral "context city" colors verbatim — a
 * building with no computable value for the active layer should read as
 * part of the quiet neutral base city, not as a distinct "error" grey
 * (which would draw exactly the attention a no-data state shouldn't).
 */
export const NO_DATA_FILL_CSS = NEUTRAL_FILL_CSS;
export const NO_DATA_OUTLINE_CSS = NEUTRAL_OUTLINE_CSS;

/**
 * Thermal ramp — ColorBrewer's "RdBu" 5-class diverging scheme (a real,
 * peer-reviewed cartographic standard, not an invented palette), cool
 * end first: blue (cooler surface) -> white (intermediate) -> red
 * (hotter surface). Deliberately NOT using this app's own
 * --color-danger (#e0685a) or --color-accent (#e8b34a) hues, so a hot
 * building is never visually confusable with an error state or a
 * selection outline.
 */
const THERMAL_RAMP_STOPS: readonly (readonly [number, string])[] = [
  [0, '#0571b0'],
  [0.25, '#92c5de'],
  [0.5, '#f7f7f7'],
  [0.75, '#f4a582'],
  [1, '#ca0020'],
];

/**
 * NDVI ramp — the standard remote-sensing convention: brown/tan (bare
 * ground or sparse vegetation, low NDVI) through yellow to green (dense
 * vegetation, high NDVI). Uses a distinct green hue/saturation from this
 * app's own --color-computable (#5fb890) badge color, so a "healthy
 * vegetation" building is never visually confusable with a "this factor
 * is computable" status badge.
 */
const NDVI_RAMP_STOPS: readonly (readonly [number, string])[] = [
  [0, '#a6611a'],
  [0.25, '#dfc27d'],
  [0.5, '#f7f7f7'],
  [0.75, '#a6dba0'],
  [1, '#008837'],
];

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const toHex = (channel: number): string => Math.round(channel).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Linear interpolation across a multi-stop ramp — t is already normalized to [0,1]. */
function interpolateRamp(ramp: readonly (readonly [number, string])[], t: number): string {
  const clamped = clamp01(t);
  for (let i = 0; i < ramp.length - 1; i += 1) {
    const [stopA, colorA] = ramp[i];
    const [stopB, colorB] = ramp[i + 1];
    if (clamped >= stopA && clamped <= stopB) {
      const localT = stopB === stopA ? 0 : (clamped - stopA) / (stopB - stopA);
      const rgbA = hexToRgb(colorA);
      const rgbB = hexToRgb(colorB);
      const mixed: [number, number, number] = [
        rgbA[0] + (rgbB[0] - rgbA[0]) * localT,
        rgbA[1] + (rgbB[1] - rgbA[1]) * localT,
        rgbA[2] + (rgbB[2] - rgbA[2]) * localT,
      ];
      return rgbToHex(mixed);
    }
  }
  return ramp[ramp.length - 1][1];
}

/** Exported for reuse by scene/thermalFieldLayer.ts — the halo's size/opacity scale by the same normalized [0,1] intensity the color ramp itself uses, one shared definition of "how intense is this value" for both. */
export function normalize(value: number, range: DataRange): number {
  if (range.max === range.min) {
    return 0.5; // every computable building has the identical value — render the ramp's neutral midpoint, not an arbitrary end
  }
  return (value - range.min) / (range.max - range.min);
}

/** Exported for reuse by scene/thermalFieldLayer.ts — the same "only a real, computable value counts" extraction this module already needed internally. */
export function factorValueFor(
  factors: readonly HeatExposureFactorValue[],
  factorKey: HeatExposureFactorValue['factorKey'],
): number | null {
  const factor = factors.find((f) => f.factorKey === factorKey);
  return factor && factor.isComputable ? factor.factorValue : null;
}

/**
 * Real min/max across only the COMPUTABLE values for one factor, across
 * every twin building currently loaded. Explicitly excludes
 * non-computable rows (their factorValue is always null) — a run with
 * zero or one computable building degrades to `null` (render everything
 * as "no data"), never divides by zero or guesses a range.
 */
function computeRange(
  twinBuildings: readonly TwinBuilding[],
  factorKey: HeatExposureFactorValue['factorKey'],
): DataRange | null {
  const values: number[] = [];
  for (const twin of twinBuildings) {
    const value = factorValueFor(twin.factors, factorKey);
    if (value !== null) {
      values.push(value);
    }
  }
  if (values.length === 0) {
    return null;
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function computeThermalRange(twinBuildings: readonly TwinBuilding[]): DataRange | null {
  return computeRange(twinBuildings, 'thermal_signature');
}

export function computeNdviRange(twinBuildings: readonly TwinBuilding[]): DataRange | null {
  return computeRange(twinBuildings, 'vegetation_land_cover');
}

export interface VisualizationRanges {
  readonly thermal: DataRange | null;
  readonly ndvi: DataRange | null;
}

export function computeVisualizationRanges(
  twinBuildings: readonly TwinBuilding[],
): VisualizationRanges {
  return {
    thermal: computeThermalRange(twinBuildings),
    ndvi: computeNdviRange(twinBuildings),
  };
}

/** Real Kelvin value -> ramp color, given the current run's real observed range. */
export function thermalColorFor(kelvin: number, range: DataRange): string {
  return interpolateRamp(THERMAL_RAMP_STOPS, normalize(kelvin, range));
}

/** Real NDVI value -> ramp color, given the current run's real observed range. */
export function ndviColorFor(ndvi: number, range: DataRange): string {
  return interpolateRamp(NDVI_RAMP_STOPS, normalize(ndvi, range));
}

/** The legend renders these same stops as swatches — never a second, hand-copied palette. */
export function thermalRampStops(): readonly (readonly [number, string])[] {
  return THERMAL_RAMP_STOPS;
}

export function ndviRampStops(): readonly (readonly [number, string])[] {
  return NDVI_RAMP_STOPS;
}

/**
 * Factor-driven building style for the active visualization mode — the
 * function scene/buildingLayer.ts calls instead of styling.ts's
 * styleForResult() whenever a data layer (not 'default') is active.
 * Always returns the "no data" treatment for a building with no
 * computable value for the active mode's factor, or for 'landcover'
 * (never fabricated), or when the run has no computable range at all.
 */
export function styleForVisualizationMode(
  mode: VisualizationMode,
  factors: readonly HeatExposureFactorValue[],
  ranges: VisualizationRanges,
): BuildingStyle {
  if (mode === 'thermal' && ranges.thermal) {
    const value = factorValueFor(factors, 'thermal_signature');
    if (value !== null) {
      const fillColorCss = thermalColorFor(value, ranges.thermal);
      return { fillColorCss, outlineColorCss: fillColorCss, hasComputedIndex: false };
    }
  }
  if (mode === 'ndvi' && ranges.ndvi) {
    const value = factorValueFor(factors, 'vegetation_land_cover');
    if (value !== null) {
      const fillColorCss = ndviColorFor(value, ranges.ndvi);
      return { fillColorCss, outlineColorCss: fillColorCss, hasComputedIndex: false };
    }
  }
  return {
    fillColorCss: NO_DATA_FILL_CSS,
    outlineColorCss: NO_DATA_OUTLINE_CSS,
    hasComputedIndex: false,
  };
}
