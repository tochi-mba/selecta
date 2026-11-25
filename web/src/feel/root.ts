import { flagOn, onFlagsChange, type FlagId } from '../flags';
import { onPrefsChange, prefs } from '../state/prefs';

/** The feel system's one switchboard (ADR-0477).
 *
 * Every rule in styles/feel*.css is scoped to a word in `<html data-feel="...">`, and every engine in
 * this folder asks `feelOn()` before it does anything. The words come from the `app.feel_*` flags
 * and the person's motion choice, so a flag that is off, or Still, leaves the page exactly as it
 * was before the feel system existed. Nothing here touches audio.
 *
 *   motion   springy presses and releases, arrivals, sliding indicators
 *   depth    lift shadows, lit edges, the glow on the main action
 *   pointer  the soft light under the mouse (Expressive only)
 *   music    chrome that answers the measured beat (not in Still)
 *   ambient  the tint in the playing song's hue
 *   moments  celebrations at rare moments (Expressive only)
 *
 * The computer's reduced-motion setting and low power are honoured twice over: tokens.css takes
 * every duration to 0, and each engine checks `feelCalm()` itself, because a script animation is
 * not stopped by a stylesheet. */

export type FeelPart = 'motion' | 'depth' | 'pointer' | 'music' | 'ambient' | 'moments';

const FLAG: Record<FeelPart, FlagId> = {
  motion: 'app.feel_motion',
  depth: 'app.feel_depth',
  pointer: 'app.feel_pointer_light',
  music: 'app.feel_music',
  ambient: 'app.feel_ambient',
  moments: 'app.feel_moments',
};

/** Parts that only make sense with full motion. */
const EXPRESSIVE_ONLY: readonly FeelPart[] = ['pointer', 'moments'];
/** Parts that are movement, so Still turns them off. Depth and the ambient tint are not. */
const MOVING: readonly FeelPart[] = ['motion', 'pointer', 'music', 'moments'];
/** Parts the first low-power step drops (styles/tokens.css data-low-power='lite'). */
const COSTLY: readonly FeelPart[] = ['pointer', 'music', 'ambient'];

const PARTS = Object.keys(FLAG) as FeelPart[];

function lowPower(): 'lite' | 'auto' | null {
  if (typeof document === 'undefined') return null;
  const level = document.documentElement.dataset.lowPower;
  return level === 'lite' || level === 'auto' ? level : null;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

/** True when nothing may move by itself: Still, the computer's reduced-motion setting, or the
 * second low-power step. Engines that animate from script ask this before every animation. */
export function feelCalm(): boolean {
  return prefs().motion === 'still' || reducedMotion() || lowPower() === 'auto';
}

/** Whether one part of the feel is on right now. */
export function feelOn(part: FeelPart): boolean {
  if (!flagOn(FLAG[part])) return false;
  const { motion } = prefs();
  if (MOVING.includes(part) && feelCalm()) return false;
  if (EXPRESSIVE_ONLY.includes(part) && motion !== 'expressive') return false;
  if (COSTLY.includes(part) && lowPower() !== null) return false;
  return true;
}

/** The parts that are on, in a fixed order, as `data-feel` holds them. */
export function feelParts(): FeelPart[] {
  return PARTS.filter(feelOn);
}

const listeners = new Set<() => void>();

/** Told whenever the set of parts changes. Returns a way to stop being told. */
export function onFeelChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let written = '';

function write() {
  if (typeof document === 'undefined') return;
  const next = feelParts().join(' ');
  if (next === written && (document.documentElement.dataset.feel ?? '') === next) return;
  written = next;
  if (next) document.documentElement.dataset.feel = next;
  else delete document.documentElement.dataset.feel;
  for (const listener of listeners) listener();
}

let started = 0;
let stop: (() => void) | null = null;

/** Start keeping `data-feel` right. Safe to call more than once; each call returns its own stop,
 * and the watching ends when the last one is stopped. */
export function startFeel(): () => void {
  started += 1;
  if (!stop) {
    const offFlags = onFlagsChange(write);
    const offPrefs = onPrefsChange(write);
    const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
    media?.addEventListener?.('change', write);
    // low power is written to <html data-low-power> by ui/lowPower.ts; watch the attribute so this
    // folder needs nothing from it but the attribute
    const watcher = typeof MutationObserver !== 'undefined' && typeof document !== 'undefined'
      ? new MutationObserver(write)
      : null;
    watcher?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-low-power'] });
    stop = () => {
      offFlags();
      offPrefs();
      media?.removeEventListener?.('change', write);
      watcher?.disconnect();
    };
  }
  write();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    started -= 1;
    if (started === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

/** For tests. */
export function resetFeel() {
  stop?.();
  stop = null;
  started = 0;
  written = '';
  if (typeof document !== 'undefined') delete document.documentElement.dataset.feel;
}
