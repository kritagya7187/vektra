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
export const DEPTH_STOPS: readonly (readonly [number, number, number])[] = [
  [198, 226, 255],
  [90, 160, 235],
  [20, 90, 190],
  [8, 33, 110],
];
export const ARRIVAL_STOPS: readonly (readonly [number, number, number])[] = [
  [255, 237, 111],
  [255, 149, 62],
  [214, 60, 46],
  [120, 15, 15],
];
export const DURATION_STOPS: readonly (readonly [number, number, number])[] = [
  [217, 245, 208],
  [120, 198, 121],
  [90, 120, 168],
  [73, 30, 110],
];
export function depthColor(depthM: number, maxValue: number, alpha = MAX_ALPHA): Rgba {
  if (!Number.isFinite(depthM) || depthM <= 0 || maxValue <= 0) {
    return TRANSPARENT;
  }
  const [r, g, b] = interpolateStops(depthM / maxValue, DEPTH_STOPS);
  return [r, g, b, alpha];
}
export function arrivalColor(arrivalMin: number | null, maxValue: number, alpha = MAX_ALPHA): Rgba {
  if (arrivalMin === null || !Number.isFinite(arrivalMin) || maxValue <= 0) {
    return TRANSPARENT;
  }
  const [r, g, b] = interpolateStops(arrivalMin / maxValue, ARRIVAL_STOPS);
  return [r, g, b, alpha];
}
export function durationColor(durationMin: number, maxValue: number, alpha = MAX_ALPHA): Rgba {
  if (!Number.isFinite(durationMin) || durationMin <= 0 || maxValue <= 0) {
    return TRANSPARENT;
  }
  const [r, g, b] = interpolateStops(durationMin / maxValue, DURATION_STOPS);
  return [r, g, b, alpha];
}
export const PRECIPITATION_STOPS: readonly (readonly [number, number, number])[] = [
  [96, 165, 250],
  [59, 130, 246],
  [124, 58, 237],
  [190, 24, 93],
];
export function precipitationColor(
  totalMm: number,
  maxValue: number,
): readonly [number, number, number] {
  if (!Number.isFinite(totalMm) || totalMm <= 0 || maxValue <= 0) {
    return PRECIPITATION_STOPS[0];
  }
  return interpolateStops(totalMm / maxValue, PRECIPITATION_STOPS);
}
export function precipitationIntensity(totalMm: number, maxValue: number): number {
  if (!Number.isFinite(totalMm) || totalMm <= 0 || maxValue <= 0) {
    return 0;
  }
  return clamp01(totalMm / maxValue);
}
