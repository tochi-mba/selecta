import { useCallback, useEffect, useRef, useState } from 'react';
import { problemKind, ProblemKind } from '../api';

/** Reading something from the server, with every state it can really be in kept apart. Nothing loaded
 * yet isn't the same as nothing there, and a failed refresh keeps what's on screen and says it may be
 * out of date. An answer that arrives after a newer question was asked is thrown away. */

export type Loaded<T> =
  | { state: 'loading'; data: null; problem: null; stale: false }
  | { state: 'ready'; data: T; problem: null; stale: false }
  | { state: 'refreshing'; data: T; problem: null; stale: false }
  /** Still showing the last good answer, because the newest question failed. */
  | { state: 'stale'; data: T; problem: ProblemKind; stale: true; message: string }
  | { state: 'failed'; data: null; problem: ProblemKind; stale: false; message: string };

export function useLoaded<T>(
  load: () => Promise<T>,
  key: string,
  options: { every?: number } = {},
): Loaded<T> & { retry: () => Promise<void> } {
  const [value, setValue] = useState<Loaded<T>>({ state: 'loading', data: null, problem: null, stale: false });
  const asked = useRef(0);
  const latest = useRef(load);
  latest.current = load;

  const run = useCallback(async () => {
    const mine = ++asked.current;
    setValue((before) => (before.data === null ? before : { state: 'refreshing', data: before.data, problem: null, stale: false }));
    try {
      const data = await latest.current();
      if (mine === asked.current) setValue({ state: 'ready', data, problem: null, stale: false });
    } catch (error) {
      if (mine !== asked.current) return;
      const message = (error as Error).message;
      const kind = problemKind(error);
      setValue((before) => (before.data === null
        ? { state: 'failed', data: null, problem: kind, stale: false, message }
        : { state: 'stale', data: before.data, problem: kind, stale: true, message }));
    }
  }, []);

  useEffect(() => {
    setValue({ state: 'loading', data: null, problem: null, stale: false });
    void run();
    // Poll only while the UI is visible. An immediate read on return makes
    // stale status truthful without consuming resources in a hidden tab.
    const tick = () => { if (document.visibilityState !== 'hidden') void run(); };
    const returned = () => { if (document.visibilityState === 'visible') tick(); };
    const timer = options.every ? window.setInterval(tick, options.every) : undefined;
    if (options.every) document.addEventListener('visibilitychange', returned);
    return () => {
      asked.current += 1;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', returned);
    };
  }, [key, options.every, run]);

  return { ...value, retry: run };
}

/** True once something has taken longer than it should, so a wait can say so instead of spinning. */
export function useStalled(busy: boolean, afterMs = 10000): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!busy) return;
    const timer = window.setTimeout(() => setStalled(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [busy, afterMs]);
  return stalled;
}

let counter = 0;

/** Names one press of a button. Sending the same name again gets the first answer back, so retrying
 * after a lost reply can't do the thing twice. */
export function operationId(what: string): string {
  counter += 1;
  const unique = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${counter}`;
  return `${what}-${unique}`;
}
