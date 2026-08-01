/**
 * A minimal observable store — not a state-management library. Design
 * review §8 deliberately avoids pulling in Redux/Zustand/etc for a
 * five-domain, mostly-read state shape this small; this is ~30 lines of
 * plain TypeScript, not a dependency.
 */
export type Listener<T> = (state: T) => void;
export type Unsubscribe = () => void;

export class Store<T> {
  private state: T;
  private readonly listeners = new Set<Listener<T>>();

  constructor(initialState: T) {
    this.state = initialState;
  }

  get(): T {
    return this.state;
  }

  set(updater: T | ((previous: T) => T)): void {
    const next =
      typeof updater === 'function' ? (updater as (previous: T) => T)(this.state) : updater;
    if (next === this.state) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  subscribe(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Shared shape for every async-loaded state domain (Run/Building/Scenario) — one consistent loading/error contract, no domain reinvents its own. */
export type AsyncStatus = 'idle' | 'loading' | 'loaded' | 'error';
