// The kiosk's screen wake lock (ADR-0445 BZ-0445-07): held while playing (holdWakeLock asks
// again when the page comes back), released when closed or paused so the screen may sleep.
// Where the browser has no wake lock the health report says so, and the setup guide says to
// turn screen sleep off in the operating system.

import { holdWakeLock, type WakeLockHold } from '../devices/wakeLock';

export type WakeController = { sync(playing: boolean): void; held(): boolean; supported(): boolean };

export function wakeController(
  nav: Navigator = navigator,
  doc: Document = document,
  hold: (nav: Navigator, doc: Document) => WakeLockHold = holdWakeLock,
): WakeController {
  let current: WakeLockHold | null = null;
  return {
    sync(playing: boolean) {
      if (playing && !current) current = hold(nav, doc);
      else if (!playing && current) {
        current.release();
        current = null;
      }
    },
    held: () => Boolean(current?.held()),
    supported: () => Boolean((nav as Navigator & { wakeLock?: unknown }).wakeLock),
  };
}
