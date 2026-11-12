import type { DraftList, MixData } from '../api';

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

/** r8a: a drafts answer keeps every draft object that hasn't changed, so My Mixes' memoised rows only
 * redraw the drafts that really changed. When nothing at all changed, the very same list comes back. */
export function keepUnchangedDrafts(before: DraftList | null, next: DraftList): DraftList {
  if (!before) return next;
  const was = new Map(before.drafts.map((draft) => [draft.id, draft]));
  let changed = before.drafts.length !== next.drafts.length;
  const drafts = next.drafts.map((draft, index) => {
    const old = was.get(draft.id);
    if (old && JSON.stringify(old) === JSON.stringify(draft)) {
      if (before.drafts[index] !== old) changed = true;
      return old;
    }
    changed = true;
    return draft;
  });
  const { drafts: _beforeDrafts, ...beforeRest } = before;
  const { drafts: _nextDrafts, ...nextRest } = next;
  if (!changed && JSON.stringify(beforeRest) === JSON.stringify(nextRest)) return before;
  return { ...next, drafts: changed ? drafts : before.drafts };
}

/** A list answer keeps each entry that is exactly as it was (matched by content, wherever it now
 * sits), so memoised rows for those entries don't redraw. */
export function keepUnchangedItems<T>(before: readonly T[], next: T[]): T[] {
  const old = new Map(before.map((item) => [JSON.stringify(item), item]));
  return next.map((item) => old.get(JSON.stringify(item)) ?? item);
}
