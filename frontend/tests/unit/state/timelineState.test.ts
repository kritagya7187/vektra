import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pauseTimeline,
  playTimeline,
  restartTimeline,
  seekTimeline,
  setTimelineSpeedMs,
  timelineStore,
} from '../../../src/state/timelineState';
import { layerVisibilityStore } from '../../../src/state/layerVisibilityState';
import { initialTimelineState } from '../../../src/domain/timeline';
beforeEach(() => {
  vi.useFakeTimers();
  timelineStore.set(initialTimelineState());
  layerVisibilityStore.set({
    terrain: true,
    imagery: true,
    buildings3d: true,
    maxDepth: true,
    arrivalTime: false,
    duration: false,
  });
});
afterEach(() => {
  pauseTimeline();
  vi.useRealTimers();
});
describe('playTimeline', () => {
  it("sets playing true and shows the current frame's layer", () => {
    playTimeline();
    expect(timelineStore.get().playing).toBe(true);
    expect(layerVisibilityStore.get().maxDepth).toBe(true);
  });
  it('auto-advances to the next frame after one interval elapses', () => {
    playTimeline();
    vi.advanceTimersByTime(timelineStore.get().speedMs);
    expect(timelineStore.get().index).toBe(1);
    expect(layerVisibilityStore.get().arrivalTime).toBe(true);
    expect(layerVisibilityStore.get().maxDepth).toBe(false);
  });
});
describe('pauseTimeline', () => {
  it('stops auto-advance', () => {
    playTimeline();
    pauseTimeline();
    const indexAfterPause = timelineStore.get().index;
    vi.advanceTimersByTime(10000);
    expect(timelineStore.get().index).toBe(indexAfterPause);
  });
});
describe('restartTimeline', () => {
  it('resets to frame 0 and re-applies its layer', () => {
    seekTimeline(2);
    restartTimeline();
    expect(timelineStore.get().index).toBe(0);
    expect(layerVisibilityStore.get().maxDepth).toBe(true);
  });
});
describe('seekTimeline', () => {
  it('jumps to the given frame and shows exactly that layer', () => {
    seekTimeline(2);
    expect(timelineStore.get().index).toBe(2);
    expect(layerVisibilityStore.get().duration).toBe(true);
    expect(layerVisibilityStore.get().maxDepth).toBe(false);
  });
});
describe('setTimelineSpeedMs', () => {
  it('updates the stored speed', () => {
    setTimelineSpeedMs(3000);
    expect(timelineStore.get().speedMs).toBe(3000);
  });
  it('re-arms a running interval at the new speed rather than waiting for the old one', () => {
    playTimeline();
    setTimelineSpeedMs(1000);
    vi.advanceTimersByTime(1000);
    expect(timelineStore.get().index).toBe(1);
  });
});
