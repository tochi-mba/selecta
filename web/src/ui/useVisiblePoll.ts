import { useEffect, useRef } from 'react';

/** Avoid background tab requests for presentation-only data. On return,
 * read immediately rather than waiting for another polling interval. */
export function useVisiblePoll(
  refresh: () => void | Promise<unknown>,
  everyMs: number,
  enabled = true,
): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState !== 'hidden') void latest.current();
    };
    const resumed = () => {
      if (document.visibilityState === 'visible') tick();
    };
    const timer = window.setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', resumed);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resumed);
    };
  }, [everyMs, enabled]);
}
