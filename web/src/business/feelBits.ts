import { RefObject, useLayoutEffect, useRef } from 'react';
import { feelCalm, feelOn } from '../feel/root';
import { visibleRows } from '../views/feelPieces';

/** Small feel helpers for the work tools (Business, Admin, the venue tablet; ADR-0477 plan 3.14).
 * These are calm on purpose: they answer a change in the data once and never move by themselves.
 * Each one does nothing while motion is off, so with the flags off, Still or reduced motion the
 * page draws exactly what it drew before. */

/** A number that goes up each time `value` changes while motion is on, so a status mark can be keyed
 * by it and ping once (.feel-pop). Zero until the first change, which lets the caller draw exactly
 * what it drew before; the first value it sees never counts, so a row scrolled into view or a page
 * opened afresh stays still. */
export function useChangePing(value: string | number | undefined): number {
  const was = useRef(value);
  const pings = useRef(0);
  if (was.current !== value) {
    if (was.current !== undefined && feelOn('motion') && !feelCalm()) pings.current += 1;
    was.current = value;
  }
  return pings.current;
}

/** How long after a list first draws its first read may still land and count as the first draw. */
const FIRST_READ_MS = 2000;

/** Rows that arrive while the page is open (a live request, a new alert, a command that just landed)
 * glow once with .feel-flash. The first list the page draws stays still, and only rows on screen
 * flash, at most 40. Each row names itself with `data-live-key`; `keys` lists them in order. */
export function useLiveFlash(listRef: RefObject<HTMLElement | null>, keys: readonly string[] | null) {
  const known = useRef<Set<string> | null>(null);
  const born = useRef(0);
  const signature = keys ? keys.join('\n') : null;
  useLayoutEffect(() => {
    if (!keys) return;
    if (!born.current) born.current = Date.now();
    const before = known.current;
    known.current = new Set(keys);
    // Many of these lists start empty and fill when their first read lands a moment later; that
    // first fill is the page drawing, not something arriving, so it stays still. An empty list that
    // fills later (the first guest request of the night) still glows.
    const firstFill = !!before && before.size === 0 && Date.now() - born.current < FIRST_READ_MS;
    if (!before || firstFill || !feelOn('motion') || feelCalm()) return;
    const fresh = keys.filter((key) => !before.has(key));
    if (!fresh.length) return;
    const wanted = new Set(fresh);
    for (const row of visibleRows(listRef.current, '[data-live-key]')) {
      if (!wanted.has(row.dataset.liveKey ?? '')) continue;
      row.classList.remove('feel-flash');
      // read layout once so the class added again starts its animation afresh
      void row.offsetWidth;
      row.classList.add('feel-flash');
      row.addEventListener('animationend', () => row.classList.remove('feel-flash'), { once: true });
    }
    // the signature carries every change of the list; keys itself is a new array on each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
