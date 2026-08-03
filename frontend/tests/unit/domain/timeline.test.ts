import { describe, expect, it } from 'vitest';
import {
  TIMELINE_METRICS,
  advance,
  currentMetric,
  initialTimelineState,
  pause,
  play,
  restart,
  seek,
  setSpeed,
} from '../../../src/domain/timeline';

describe('initialTimelineState', () => {
  it('starts paused, at frame 0', () => {
    const state = initialTimelineState();
    expect(state.playing).toBe(false);
    expect(state.index).toBe(0);
  });

  it('enforces a minimum speed even if a smaller one is requested', () => {
    const state = initialTimelineState(1);
    expect(state.speedMs).toBeGreaterThan(1);
  });
});

describe('currentMetric', () => {
  it('maps index to the real TIMELINE_METRICS sequence', () => {
    const state = { playing: false, index: 1, speedMs: 2000 };
    expect(currentMetric(state)).toBe(TIMELINE_METRICS[1]);
  });
});

describe('play / pause', () => {
  it('play sets playing true without touching the index', () => {
    const state = play({ playing: false, index: 1, speedMs: 2000 });
    expect(state.playing).toBe(true);
    expect(state.index).toBe(1);
  });

  it('pause sets playing false without touching the index', () => {
    const state = pause({ playing: true, index: 1, speedMs: 2000 });
    expect(state.playing).toBe(false);
    expect(state.index).toBe(1);
  });
});

describe('restart', () => {
  it('resets to index 0, preserving the current playing state', () => {
    expect(restart({ playing: true, index: 2, speedMs: 2000 })).toEqual({
      playing: true,
      index: 0,
      speedMs: 2000,
    });
    expect(restart({ playing: false, index: 2, speedMs: 2000 }).playing).toBe(false);
  });
});

describe('advance', () => {
  it('moves to the next index', () => {
    expect(advance({ playing: true, index: 0, speedMs: 2000 }).index).toBe(1);
  });

  it('wraps back to 0 after the last metric', () => {
    const lastIndex = TIMELINE_METRICS.length - 1;
    expect(advance({ playing: true, index: lastIndex, speedMs: 2000 }).index).toBe(0);
  });
});

describe('seek', () => {
  it('jumps directly to a given index', () => {
    expect(seek({ playing: false, index: 0, speedMs: 2000 }, 2).index).toBe(2);
  });

  it('clamps below zero', () => {
    expect(seek({ playing: false, index: 0, speedMs: 2000 }, -5).index).toBe(0);
  });

  it('clamps above the last valid index', () => {
    expect(seek({ playing: false, index: 0, speedMs: 2000 }, 999).index).toBe(
      TIMELINE_METRICS.length - 1,
    );
  });
});

describe('setSpeed', () => {
  it('updates the speed', () => {
    expect(setSpeed({ playing: false, index: 0, speedMs: 2000 }, 3000).speedMs).toBe(3000);
  });

  it('enforces the minimum speed floor', () => {
    expect(setSpeed({ playing: false, index: 0, speedMs: 2000 }, 1).speedMs).toBeGreaterThan(1);
  });
});
