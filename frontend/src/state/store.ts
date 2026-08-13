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
export type AsyncStatus = 'idle' | 'loading' | 'loaded' | 'error';
