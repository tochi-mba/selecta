import { useSyncExternalStore } from 'react';
import { flagOn, onFlagsChange } from '../flags';
import { onPrefsChange, prefs } from '../state/prefs';

/** SF-0235-08: when this device can't keep up with decorative motion, lower it automatically.
 *
 * A short frame sample runs while the page is visible. If most frames in two windows in a row take
 * longer than a struggling budget, the page switches to the same Still styling a person can choose,
 * which drops movement but keeps every value, label and control (Still never hides information).
 * Nothing about the music, the mix or the saved preference changes; "Use full motion here" in the
 * Workspace undoes it for this browser session. Feature flag: `app.auto_low_motion`. */

/** A frame slower than this is a struggling frame (under about 20 frames a second). */
export const SLOW_FRAME_MS = 50;
/** Frames per window. */
export const WINDOW_FRAMES = 90;
/** Share of slow frames in a window that counts as struggling. */
export const SLOW_SHARE = 0.5;
/** A gap longer than this is the tab being hidden or the machine sleeping, not a slow frame. */
const GAP_MS = 1000;
const DISMISS_KEY = 'selecta-full-motion';
/** Calm windows in a row before the sampler rests, so a healthy device pays almost nothing. */
const CALM_WINDOWS = 4;
/** How long the sampler rests between bursts. */
export const REST_MS = 60_000;

/** True when a window of frame gaps says the device is struggling. Pure, for tests. */
export function struggling(deltas: readonly number[]): boolean {
  const real = deltas.filter((delta) => delta > 0 && delta < GAP_MS);
  if (real.length < WINDOW_FRAMES * 0.6) return false;
  const slow = real.filter((delta) => delta > SLOW_FRAME_MS).length;
  return slow / real.length >= SLOW_SHARE;
}

let lowered = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (lowered === next) return;
  lowered = next;
  if (typeof document !== 'undefined') {
    if (next) document.documentElement.dataset.lowPower = 'auto';
    else delete document.documentElement.dataset.lowPower;
  }
  for (const listener of listeners) listener();
}

/** Whether motion is lowered automatically right now. */
export function lowPowerActive(): boolean {
  return lowered;
}

export function useLowPower(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => lowered,
    () => lowered,
  );
}

function dismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** The person wants full motion back here: stop lowering it for this browser session. */
export function keepFullMotion() {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // private windows may refuse storage; the choice still holds until reload
  }
  stopped = true;
  set(false);
}

let stopped = false;

type Clock = {
  frame: (callback: (time: number) => void) => number;
  cancel: (handle: number) => void;
  hidden: () => boolean;
  later: (callback: () => void, ms: number) => number;
  clear: (handle: number) => void;
};

const browserClock = (): Clock => ({
  frame: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
  hidden: () => document.visibilityState === 'hidden',
  later: (callback, ms) => window.setTimeout(callback, ms),
  clear: (handle) => window.clearTimeout(handle),
});

/** Starts watching frames. Returns a stop function. Does nothing when the flag is off, the person
 * already chose Still, or they asked for full motion in this session. */
export function watchLowPower(clock: Clock = browserClock()): () => void {
  stopped = dismissed();
  let handle = 0;
  let last = -1;
  let deltas: number[] = [];
  let strikes = 0;
  let calm = 0;
  let rest = 0;
  // With the flag off or Still chosen there is nothing to watch, so no frames are asked for at all
  // until one of those changes back (a hidden tab gets no frames from the browser anyway).
  let parked = false;
  const wanted = () => flagOn('app.auto_low_motion') && prefs().motion !== 'still';
  const tick = (time: number) => {
    if (stopped) return;
    if (!wanted()) {
      last = -1;
      deltas = [];
      parked = true;
      return;
    }
    if (clock.hidden()) {
      last = -1;
      deltas = [];
      handle = clock.frame(tick);
      return;
    }
    if (last >= 0) deltas.push(time - last);
    last = time;
    if (deltas.length >= WINDOW_FRAMES) {
      const slow = struggling(deltas);
      strikes = slow ? strikes + 1 : 0;
      calm = slow ? 0 : calm + 1;
      deltas = [];
      if (strikes >= 2) {
        set(true);
        stopped = true;
        return;
      }
      if (calm >= CALM_WINDOWS) {
        calm = 0;
        last = -1;
        rest = clock.later(() => {
          if (!stopped) handle = clock.frame(tick);
        }, REST_MS);
        return;
      }
    }
    handle = clock.frame(tick);
  };
  const wake = () => {
    if (!parked || stopped || !wanted()) return;
    parked = false;
    handle = clock.frame(tick);
  };
  const unwatchFlags = onFlagsChange(wake);
  const unwatchPrefs = onPrefsChange(wake);
  if (!stopped) handle = clock.frame(tick);
  return () => {
    stopped = true;
    unwatchFlags();
    unwatchPrefs();
    clock.cancel(handle);
    clock.clear(rest);
  };
}

/** For tests. */
export function resetLowPower() {
  stopped = false;
  set(false);
  try {
    sessionStorage.removeItem(DISMISS_KEY);
  } catch {
    // nothing to clear
  }
}
