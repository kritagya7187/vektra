import { describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/state/store';

describe('Store', () => {
  it('returns the initial state from get()', () => {
    const store = new Store({ count: 0 });
    expect(store.get()).toEqual({ count: 0 });
  });

  it('set() with a value replaces the state and notifies subscribers', () => {
    const store = new Store({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ count: 1 });

    expect(store.get()).toEqual({ count: 1 });
    expect(listener).toHaveBeenCalledWith({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('set() with an updater function receives the previous state', () => {
    const store = new Store({ count: 5 });
    store.set((previous) => ({ count: previous.count + 1 }));
    expect(store.get()).toEqual({ count: 6 });
  });

  it('does not notify subscribers when the new state is reference-equal to the old state', () => {
    const state = { count: 0 };
    const store = new Store(state);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(state);

    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribe stops further notifications', () => {
    const store = new Store({ count: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.set({ count: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple independent subscribers', () => {
    const store = new Store({ count: 0 });
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);

    store.set({ count: 1 });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
