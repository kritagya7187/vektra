import {
  advance,
  currentMetric,
  initialTimelineState,
  pause,
  play,
  restart,
  seek,
  setSpeed as setTimelineSpeed,
  type TimelineState,
} from '../domain/timeline';
import { showOnlyFloodMetric } from './layerVisibilityState';
import { Store } from './store';
export const timelineStore = new Store<TimelineState>(initialTimelineState());
let intervalHandle: ReturnType<typeof setInterval> | null = null;
function applyCurrentMetric(): void {
  showOnlyFloodMetric(currentMetric(timelineStore.get()));
}
function stopInterval(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
function startInterval(): void {
  stopInterval();
  intervalHandle = setInterval(() => {
    timelineStore.set(advance(timelineStore.get()));
    applyCurrentMetric();
  }, timelineStore.get().speedMs);
}
export function playTimeline(): void {
  timelineStore.set(play(timelineStore.get()));
  applyCurrentMetric();
  startInterval();
}
export function pauseTimeline(): void {
  timelineStore.set(pause(timelineStore.get()));
  stopInterval();
}
export function restartTimeline(): void {
  timelineStore.set(restart(timelineStore.get()));
  applyCurrentMetric();
}
export function seekTimeline(index: number): void {
  timelineStore.set(seek(timelineStore.get(), index));
  applyCurrentMetric();
}
export function setTimelineSpeedMs(speedMs: number): void {
  timelineStore.set(setTimelineSpeed(timelineStore.get(), speedMs));
  if (timelineStore.get().playing) {
    startInterval();
  }
}
