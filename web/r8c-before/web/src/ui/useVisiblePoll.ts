import { useEffect, useRef } from 'react';

/** Avoid background tab requests for presentation-only data. On return,
 * read immediately rather than waiting for another polling interval.
 * Slow reads must not pile up or overwrite a newer answer. */
export function useVisiblePoll(
  refresh: () => void | Promise<unknown>,
  everyMs: number,
  enabled = true,
): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let reading = false;
    let refreshOnFinish = false;
    const tick = () => {
      if (!live || document.visibilityState === 'hidden' || reading) return;
      // A synchronous refresh should still happen in this event, while an
      // asynchronous one holds the slot until it settles (success or failure).
      const result = latest.current();
      if (!result || typeof result.then !== 'function') return;
      reading = true;
      void Promise.resolve(result).then(
        () => {
          reading = false;
          if (live && refreshOnFinish) {
            refreshOnFinish = false;
            tick();
          }
        },
        () => {
          reading = false;
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
    const timer = window.setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', resumed);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resumed);
    };
  }, [everyMs, enabled]);
}
