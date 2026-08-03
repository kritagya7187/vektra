/**
 * Step 20: pure colormap functions for the three real flood-engine
 * summary layers (Step 14 outputs — max depth, arrival time, duration
 * above threshold). No computation of new values happens here, only a
 * value -> RGBA color mapping for display — matching the "must not
 * compute flood depth/arrival time/duration" scientific boundary.
 */

export type Rgba = readonly [r: number, g: number, b: number, a: number];

const TRANSPARENT: Rgba = [0, 0, 0, 0] as const;
const MAX_ALPHA = 255;

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linear interpolation across a fixed list of RGB stops evenly spaced across [0, 1]. */
function interpolateStops(
  t: number,
  stops: readonly (readonly [number, number, number])[],
): readonly [number, number, number] {
  const clamped = clamp01(t);
  const segments = stops.length - 1;
  const scaled = clamped * segments;
  const index = Math.min(Math.floor(scaled), segments - 1);
  const localT = scaled - index;
  const [r1, g1, b1] = stops[index];
  const [r2, g2, b2] = stops[index + 1];
  return [
    Math.round(lerp(r1, r2, localT)),
    Math.round(lerp(g1, g2, localT)),
    Math.round(lerp(b1, b2, localT)),
  ];
}

/** Light blue (shallow) -> deep navy (deep). */
const DEPTH_STOPS: readonly (readonly [number, number, number])[] = [
  [198, 226, 255],
  [90, 160, 235],
  [20, 90, 190],
  [8, 33, 110],
];

/** Yellow (arrives fast) -> deep red (arrives slow). */
const ARRIVAL_STOPS: readonly (readonly [number, number, number])[] = [
  [255, 237, 111],
  [255, 149, 62],
  [214, 60, 46],
  [120, 15, 15],
];

/** Pale green (brief) -> deep purple (prolonged). */
const DURATION_STOPS: readonly (readonly [number, number, number])[] = [
  [217, 245, 208],
  [120, 198, 121],
  [90, 120, 168],
  [73, 30, 110],
];

/**
 * Maps a max-depth value (meters, >= 0) to a color. `maxValue` is the
 * run's own real maximum (for normalizing the ramp to the data actually
 * present) -- never a hardcoded scientific threshold. A non-positive
 * `maxValue` (a completely dry run) maps every depth to transparent
 * rather than dividing by zero.
 */
export function depthColor(depthM: number, maxValue: number, alpha = MAX_ALPHA): Rgba {
  if (!Number.isFinite(depthM) || depthM <= 0 || maxValue <= 0) {
    return TRANSPARENT;
  }
  const [r, g, b] = interpolateStops(depthM / maxValue, DEPTH_STOPS);
  return [r, g, b, alpha];
}

/**
 * Maps an arrival-time value (minutes) to a color. `null` (flood-engine's
 * own representation of "this cell's depth never crossed the nuisance
 * threshold" -- see backend/src/floodEngine/types.ts's own note on
 * `arrivalTimeMin`) renders fully transparent, preserved exactly, never
 * coerced to a number.
 */
export function arrivalColor(arrivalMin: number | null, maxValue: number, alpha = MAX_ALPHA): Rgba {
  if (arrivalMin === null || !Number.isFinite(arrivalMin) || maxValue <= 0) {
    return TRANSPARENT;
  }
  const [r, g, b] = interpolateStops(arrivalMin / maxValue, ARRIVAL_STOPS);
  return [r, g, b, alpha];
}

/** Maps a duration-above-threshold value (minutes, >= 0) to a color. Same normalization convention as depthColor. */
export function durationColor(durationMin: number, maxValue: number, alpha = MAX_ALPHA): Rgba {
  if (!Number.isFinite(durationMin) || durationMin <= 0 || maxValue <= 0) {
    return TRANSPARENT;
  }
  const [r, g, b] = interpolateStops(durationMin / maxValue, DURATION_STOPS);
  return [r, g, b, alpha];
}
