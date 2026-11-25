import { flagOn } from '../flags';
import { prefs } from '../state/prefs';

/** A short buzz that answers a press, on a phone (ADR-0477, flag `app.feel_haptics`).
 *
 * In practice only Android browsers can vibrate; everywhere else, and whenever any condition below
 * fails, each call is a no-op. There is no iPhone workaround on purpose. A buzz is only ever an echo
 * of something the person just did, so a call outside a press (a timer, a network answer) is
 * ignored too: browsers refuse those anyway, and some log a warning for each refusal.
 *
 *   tap      a press that did something
 *   tick     a small step: a value moving one notch, a tab changing
 *   success  something finished that the person asked for
 *   warn     something they asked for did not happen
 *
 * Patterns are milliseconds of buzz and pause, kept short so none outlasts the press. */
const PATTERNS = {
  tap: [8],
  tick: [4],
  success: [10, 40, 14],
  warn: [18, 60, 18],
} as const;

type UserActivation = { isActive: boolean };

function allowed(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  if (typeof navigator.vibrate !== 'function') return false;
  if (!flagOn('app.feel_haptics') || !prefs().haptics) return false;
  if (!(window.matchMedia?.('(pointer: coarse)').matches ?? false)) return false;
  // inside a user gesture only; a browser without the activation API gets nothing, never a guess
  const activation = (navigator as Navigator & { userActivation?: UserActivation }).userActivation;
  return activation?.isActive === true;
}

function buzz(pattern: readonly number[]) {
  if (!allowed()) return;
  try {
    navigator.vibrate([...pattern]);
  } catch {
    // a browser that throws instead of refusing is treated as one that cannot buzz
  }
}

export function tap() {
  buzz(PATTERNS.tap);
}

export function tick() {
  buzz(PATTERNS.tick);
}

export function success() {
  buzz(PATTERNS.success);
}

export function warn() {
  buzz(PATTERNS.warn);
}
