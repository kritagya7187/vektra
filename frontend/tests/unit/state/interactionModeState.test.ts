import { beforeEach, describe, expect, it } from 'vitest';
import { interactionModeStore, setInteractionMode } from '../../../src/state/interactionModeState';

beforeEach(() => {
  interactionModeStore.set({ mode: 'explore' });
});

describe('setInteractionMode', () => {
  it('defaults to explore', () => {
    expect(interactionModeStore.get().mode).toBe('explore');
  });
  it('sets exactly the requested mode', () => {
    setInteractionMode('measure');
    expect(interactionModeStore.get().mode).toBe('measure');
  });
  it('notifies subscribers on change', () => {
    let notified = false;
    const unsubscribe = interactionModeStore.subscribe(() => {
      notified = true;
    });
    setInteractionMode('simulate');
    unsubscribe();
    expect(notified).toBe(true);
  });
});
