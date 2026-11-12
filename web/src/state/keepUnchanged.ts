import type { MixData } from '../api';

/** r8c: a poll answer that says exactly what is already shown keeps the object already shown, so
 * React bails out instead of redrawing every page that reads it. */
export function keepIfSame<T>(before: T | null, next: T): T {
  if (before === null) return next;
  return JSON.stringify(before) === JSON.stringify(next) ? before : next;
}

/** A mix answer keeps every song object that hasn't changed, so the editor's memoised rows only
 * redraw the songs and transitions that really moved on. When nothing at all changed, the very same
 * MixData comes back and nothing redraws. */
export function keepUnchangedMix(before: MixData | null, next: MixData): MixData {
  if (!before) return next;
  let changed = before.mix.length !== next.mix.length;
  const mix = next.mix.map((item, index) => {
    const was = before.mix[index];
    if (was && JSON.stringify(was) === JSON.stringify(item)) return was;
    changed = true;
    return item;
  });
  const { mix: _beforeMix, ...beforeRest } = before;
  const { mix: _nextMix, ...nextRest } = next;
  if (!changed && JSON.stringify(beforeRest) === JSON.stringify(nextRest)) return before;
  return { ...next, mix: changed ? mix : before.mix };
}
