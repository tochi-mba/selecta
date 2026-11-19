/** A tiny observable value, shaped for React's useSyncExternalStore (get + subscribe). */

export interface Observable<T> {
  get: () => T;
  subscribe: (listener: () => void) => () => void;
}

export interface WritableObservable<T> extends Observable<T> {
  set: (next: T) => void;
}

export function observable<T>(initial: T): WritableObservable<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // One broken subscriber must not stop the others hearing the change.
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
