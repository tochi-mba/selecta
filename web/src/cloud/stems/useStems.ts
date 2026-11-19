import { useEffect, useRef, useSyncExternalStore } from 'react';
import { STEMS_COPY } from './stemsCopy';
import type { SplitterState, StemsActions, StemsSnapshot, StemsStore } from './types';

import { useFlags } from '../../flags';
import { stemsFlagOn } from './flag';

export { STEMS_FLAG, stemsFlagOn } from './flag';

/** Whether stems are on, live: pass it as each surface's `enabled`. */
export function useStemsEnabled(): boolean {
  return stemsFlagOn(useFlags());
}

const NOTHING = () => () => {};
const NO_SNAPSHOT = () => null;

/** The store's latest snapshot, re-rendering when it changes. A null store reads as null, so a
 * surface can be handed nothing while the engine is not built or the flag is off. */
export function useStems(store: StemsStore | null | undefined): StemsSnapshot | null {
  return useSyncExternalStore(
    store ? store.subscribe : NOTHING,
    store ? store.get : NO_SNAPSHOT,
    store ? store.get : NO_SNAPSHOT,
  );
}

/** The toast to show when the splitter changes state, or null. Only a finished download is news
 * worth a toast; everything else is said on the card where it happened. */
export function splitterNotice(before: SplitterState | null | undefined, after: SplitterState | null | undefined): string | null {
  if (before?.state === 'downloading' && after?.state === 'ready') return STEMS_COPY.downloadedToast;
  return null;
}

/** Mount once at shell level: calls `notify` with the toast when the download finishes, wherever
 * the member is in the app. */
export function useSplitterNotices(store: StemsStore | null | undefined, notify: (words: string) => void): void {
  const snapshot = useStems(store);
  const before = useRef<SplitterState | null>(snapshot?.splitter ?? null);
  const say = useRef(notify);
  say.current = notify;
  useEffect(() => {
    const after = snapshot?.splitter ?? null;
    const words = splitterNotice(before.current, after);
    before.current = after;
    if (words) say.current(words);
  }, [snapshot?.splitter]);
}

/** A simple store holding a snapshot in memory, for tests, the harness and the integrator's
 * adapter. `set` replaces the snapshot and tells every listener. */
export function memoryStemsStore(initial: StemsSnapshot, actions: Partial<StemsActions> = {}): StemsStore & { set(next: Partial<StemsSnapshot>): void } {
  let current = initial;
  const listeners = new Set<() => void>();
  const noop = () => undefined;
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      current = { ...current, ...next };
      for (const listener of [...listeners]) listener();
    },
    actions: {
      download: actions.download ?? noop,
      pause: actions.pause ?? noop,
      resume: actions.resume ?? noop,
      cancel: actions.cancel ?? noop,
      remove: actions.remove ?? noop,
      retryAfterCrash: actions.retryAfterCrash ?? noop,
    },
  };
}

/** True when any transition still has stems queued or being prepared. */
export function stemsPending(snapshot: StemsSnapshot | null | undefined): boolean {
  return !!snapshot && Object.values(snapshot.windows).some((window) => window.state === 'queued' || window.state === 'running');
}
