import { useEffect, useRef } from 'react';

/** Avoid background tab requests for presentation-only data. On return,
 * read immediately rather than waiting for another polling interval.
 * Slow reads must not pile up or overwrite a newer answer.
 *
 * r8c: with `backoff`, each failed read doubles the wait before the next one (up to `maxMs`, eight
 * intervals by default), and the first good read goes straight back to the normal pace, so a server
 * that's away isn't asked again every interval. Returning to the tab still reads at once. */
export function useVisiblePoll(
  refresh: () => void | Promise<unknown>,
  everyMs: number,
  enabled = true,
  options: { backoff?: boolean; maxMs?: number } = {},
): void {
  const backoff = !!options.backoff;
  const maxMs = options.maxMs ?? everyMs * 8;
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let reading = false;
    let refreshOnFinish = false;
    // how many interval ticks to let pass before the next read, after failures
    let skip = 0;
    let failures = 0;
    const tick = (fromTimer = false) => {
      if (!live || document.visibilityState === 'hidden' || reading) return;
      if (fromTimer && skip > 0) {
        skip -= 1;
        return;
      }
      // A synchronous refresh should still happen in this event, while an
      // asynchronous one holds the slot until it settles (success or failure).
      const result = latest.current();
      if (!result || typeof result.then !== 'function') return;
      reading = true;
      void Promise.resolve(result).then(
        () => {
          reading = false;
          failures = 0;
          skip = 0;
          if (live && refreshOnFinish) {
            refreshOnFinish = false;
            tick();
          }
        },
        () => {
          reading = false;
          if (backoff) {
            failures += 1;
            const wait = Math.min(everyMs * 2 ** failures, Math.max(maxMs, everyMs));
            skip = Math.max(Math.round(wait / everyMs) - 1, 0);
          }
          if (live && refreshOnFinish) {
            refreshOnFinish = false;
            tick();
          }
        },
      );
    };
    const resumed = () => {
      if (document.visibilityState !== 'visible') return;
      if (reading) refreshOnFinish = true;
      else tick();
    };
    const timer = window.setInterval(() => tick(true), everyMs);
    document.addEventListener('visibilitychange', resumed);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resumed);
    };
  }, [everyMs, enabled, backoff, maxMs]);
}
