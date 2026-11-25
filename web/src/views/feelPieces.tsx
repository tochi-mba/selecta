import { RefObject, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { registerBeatTarget } from '../feel/beatBus';
import { feelCalm, feelOn, feelParts, onFeelChange } from '../feel/root';
import { flashOnce } from '../feel/flashOnce';
import { NumberRoll } from '../feel/numberRoll';
import { ICON_SLOTS, ICON_STROKES, type IconSize } from '../ui/Icon';
import { motionMs } from '../ui/exitMotion';

/** Small feel pieces (ADR-0477) shared by My Mixes, the Library, import and the editor. Each one
 * draws exactly what the page drew before while its part of `<html data-feel>` is off, so a screen
 * that uses them looks and reads the same with the flags off. */

/** The most rows a glide or a highlight touches at once, matching feel/flip.ts. */
export const VISIBLE_CAP = 40;

const motionNow = () => feelOn('motion');
const anyNow = () => feelParts().length > 0;
const never = () => false;

/** Whether arrivals, glides and rolls may move right now; redraws when that changes. */
export function useMotionOn(): boolean {
  return useSyncExternalStore(onFeelChange, motionNow, never);
}

/** Whether any part of the feel is on, for pieces that only add a wrapper when something uses it. */
export function useFeelOn(): boolean {
  return useSyncExternalStore(onFeelChange, anyNow, never);
}

/** A count that rolls to its new value while motion is on, and is the same plain words otherwise,
 * so the page's text (and what a screen reader hears) never changes. */
export function RollingCount({ value, format }: { value: number; format: (value: number) => string }) {
  const moving = useMotionOn();
  if (!moving) return <>{format(value)}</>;
  return <NumberRoll value={value} format={format} />;
}

/** A tick that draws itself once (feel-draw through .feel-tick). Decoration: the words beside it say
 * what happened. Shaped like the icon set's own check so it sits where an Icon would. */
export function DrawnTick({ size = 'toolbar', className }: { size?: IconSize; className?: string }) {
  const box = ICON_SLOTS[size];
  return (
    <svg className={className ? `ui-icon feel-drawn-tick ${className}` : 'ui-icon feel-drawn-tick'} data-size={size} viewBox="0 0 24 24" width={box} height={box}
      fill="none" stroke="currentColor" strokeWidth={ICON_STROKES[size]} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path className="feel-tick" pathLength={1} d="m5 12 4 4L19 6" />
    </svg>
  );
}

/** Fold a row away with .feel-collapse-out and resolve when it has gone, or at once when motion is
 * off (no animation runs then, so no event would come). The timer is the fallback for a browser
 * that never sends animationend. Null when nothing will move, so a caller can skip the wait and
 * remove the row in the same step it always did. The caller removes the row. */
export function foldAway(element: Element | null | undefined): Promise<void> | null {
  if (!element || !feelOn('motion') || feelCalm()) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      element.removeEventListener('animationend', onEnd);
      window.clearTimeout(timer);
      resolve();
    };
    const onEnd = (event: Event) => { if (event.target === element) finish(); };
    element.addEventListener('animationend', onEnd);
    element.classList.add('feel-collapse-out');
    const timer = window.setTimeout(finish, motionMs('--motion-handoff', 200) + 80);
  });
}

/** `work`, answered only once the row `find` names has folded away after it succeeded. With motion
 * off it is `work` itself, so nothing waits and nothing about the timing changes. */
export function afterFold<T>(work: Promise<T>, find: () => Element | null): Promise<T> {
  if (!feelOn('motion') || feelCalm()) return work;
  return work.then(async (answer) => {
    await foldAway(find());
    return answer;
  });
}

/** Take the fold back off a row React kept for something else (a list keyed by occurrence can hand
 * a removed row's node to the song that took its place). */
export function unfold(element: Element | null | undefined) {
  element?.classList.remove('feel-collapse-out');
}

/** A folded row that is still on the page a moment later was not removed after all (the list came
 * back unchanged, or could not be read): show it again. */
export function unfoldIfKept(element: Element | null | undefined, ms = 1000) {
  if (!element) return;
  window.setTimeout(() => { if (element.isConnected) unfold(element); }, ms);
}

/** A number that goes up each time `kind` turns 'ready' from something else while motion is on, so
 * a status chip can be keyed by it and pop (.feel-pop) once. Zero while nothing has turned ready,
 * which lets the caller draw the chip exactly as before. */
export function useReadyPop(kind: string | undefined): number {
  const was = useRef(kind);
  const pops = useRef(0);
  if (was.current !== kind) {
    if (kind === 'ready' && was.current !== undefined && feelOn('motion')) pops.current += 1;
    was.current = kind;
  }
  return pops.current;
}

/** Three bars the beat bus moves on measured beats while something plays (feel-music.css draws
 * them only with data-feel~='music'; otherwise they take no room). Decoration only. */
export function PlayingBars() {
  const bars = useRef<HTMLSpanElement>(null);
  useEffect(() => (bars.current ? registerBeatTarget(bars.current, 'bars') : undefined), []);
  return <span ref={bars} data-playing-bars="" aria-hidden="true"><i /><i /><i /></span>;
}

/** The elements matching `selector` inside `list` that are on screen, at most `cap`, found by a
 * binary search, so a list of twenty thousand rows costs a handful of measurements. */
export function visibleRows(list: Element | null, selector: string, cap = VISIBLE_CAP): HTMLElement[] {
  if (!list || typeof window === 'undefined') return [];
  const rows = list.querySelectorAll<HTMLElement>(selector);
  if (!rows.length) return [];
  const height = window.innerHeight || document.documentElement.clientHeight;
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle].getBoundingClientRect().bottom <= 0) low = middle + 1;
    else high = middle;
  }
  const shown: HTMLElement[] = [];
  for (let index = low; index < rows.length && shown.length < cap; index += 1) {
    const rect = rows[index].getBoundingClientRect();
    if (rect.top >= height) break;
    if (rect.height || rect.width) shown.push(rows[index]);
  }
  return shown;
}

/** Glide the rows of a reordered list from where they were to where they are, on the gentle spring
 * (no overshoot: a dropped song settles, it never bounces past its place). Positions are kept
 * relative to the list, so scrolling between two orders does not count as a move. Only rows on
 * screen are measured and moved, at most 40, and nothing moves while motion is off or calm.
 * `key` reads a row's identity; `signature` changes when the order does. */
export function useRowGlide(listRef: RefObject<HTMLElement | null>, selector: string, key: (row: HTMLElement) => string | undefined, signature: string) {
  const last = useRef<{ signature: string; tops: Map<string, number> } | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const moving = feelOn('motion') && !feelCalm() && typeof list.animate === 'function';
    const before = last.current;
    if (!moving) {
      last.current = null;
      return;
    }
    const origin = list.getBoundingClientRect().top;
    const tops = new Map<string, number>();
    const rows = visibleRows(list, selector);
    const reordered = !!before && before.signature !== signature;
    const duration = reordered ? motionMs('--motion-spring-glide', 360) : 0;
    const curve = getComputedStyle(document.documentElement).getPropertyValue('--spring-gentle').trim() || 'ease-out';
    for (const row of rows) {
      const name = key(row);
      if (!name) continue;
      const top = row.getBoundingClientRect().top - origin;
      tops.set(name, top);
      const was = before?.tops.get(name);
      if (!duration || was === undefined || Math.abs(was - top) < 0.5) continue;
      const frames: Keyframe[] = [{ transform: `translateY(${(was - top).toFixed(1)}px)` }, { transform: 'translateY(0)' }];
      try {
        row.animate(frames, { duration, easing: curve, composite: 'add' });
      } catch {
        row.animate(frames, { duration, easing: 'ease-out', composite: 'add' });
      }
    }
    last.current = { signature, tops };
  });
}

/** Rows that newly appear in a list (an import adding songs, say) glow once with .feel-flash. The
 * first answer for a search, a page of "Show more" (`quiet`) and anything off screen stay still,
 * and at most 40 rows flash. `identity` names the search the rows answer. */
export function useArrivalFlash(listRef: RefObject<HTMLElement | null>, ids: readonly number[] | null, identity: string, quiet: RefObject<boolean>) {
  const known = useRef<{ identity: string; ids: Set<number> } | null>(null);
  useLayoutEffect(() => {
    if (ids === null) return;
    const before = known.current;
    known.current = { identity, ids: new Set(ids) };
    const hush = quiet.current;
    quiet.current = false;
    if (!before || before.identity !== identity || hush || !feelOn('motion') || feelCalm()) return;
    const fresh = new Set(ids.filter((id) => !before.ids.has(id)));
    if (!fresh.size) return;
    for (const row of visibleRows(listRef.current, ':scope > li')) {
      const id = Number(row.querySelector<HTMLElement>('[data-focus-key]')?.dataset.focusKey?.replace('song-details-', ''));
      if (!fresh.has(id)) continue;
      flashOnce(row);
    }
  }, [ids, identity]);
}
