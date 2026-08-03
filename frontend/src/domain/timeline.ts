/**
 * Step 20 Part 4 (approved scope-down, per AskUserQuestion): true
 * per-timestep animation has no data source -- flood-engine never
 * persists `timestep_records` (Step 17), and Step 19's frozen API only
 * ever returns the 3 summary rasters. "Time Animation" is instead a
 * play/pause/restart/speed-controlled cycle through those 3 real,
 * already-fetched layers (max depth -> arrival time -> duration above
 * threshold) -- a pure reducer, no MapLibre/deck.gl dependency, no
 * simulation rerun, no interpolation between frames.
 */

export const TIMELINE_METRICS = ['maxDepth', 'arrivalTime', 'duration'] as const;
export type TimelineMetric = (typeof TIMELINE_METRICS)[number];

export interface TimelineState {
  readonly playing: boolean;
  readonly index: number;
  readonly speedMs: number;
}

export const DEFAULT_TIMELINE_SPEED_MS = 2000;
const MIN_TIMELINE_SPEED_MS = 200;

export function initialTimelineState(speedMs: number = DEFAULT_TIMELINE_SPEED_MS): TimelineState {
  return { playing: false, index: 0, speedMs: Math.max(speedMs, MIN_TIMELINE_SPEED_MS) };
}

export function currentMetric(state: TimelineState): TimelineMetric {
  return TIMELINE_METRICS[state.index] ?? TIMELINE_METRICS[0];
}

export function play(state: TimelineState): TimelineState {
  return { ...state, playing: true };
}

export function pause(state: TimelineState): TimelineState {
  return { ...state, playing: false };
}

/** Resets to the first layer, preserving whatever play/pause state the caller was already in. */
export function restart(state: TimelineState): TimelineState {
  return { ...state, index: 0 };
}

/** Advances to the next layer, wrapping back to the first -- the auto-advance step a timer drives while playing. */
export function advance(state: TimelineState): TimelineState {
  return { ...state, index: (state.index + 1) % TIMELINE_METRICS.length };
}

/** The timeline slider's direct scrub target -- clamped to a valid index, never out of range. */
export function seek(state: TimelineState, index: number): TimelineState {
  const clamped = Math.min(Math.max(Math.trunc(index), 0), TIMELINE_METRICS.length - 1);
  return { ...state, index: clamped };
}

export function setSpeed(state: TimelineState, speedMs: number): TimelineState {
  return { ...state, speedMs: Math.max(speedMs, MIN_TIMELINE_SPEED_MS) };
}
