import { RefObject, useEffect } from 'react';
import { tap, tick } from '../feel/haptics';
import { feelCalm, feelOn } from '../feel/root';
import { changeScene } from '../shell/sceneTransition';
import { motionMs } from '../ui/exitMotion';
import { visibleRows } from './feelPieces';

/** The Library's own feel pieces (ADR-0477, plan 3.6). Each one does nothing, and draws nothing
 * different, while its part of `<html data-feel>` is off, so the Library reads the same then. */

export type MatchPart = { text: string; hit: boolean };

/** The words of a search worth marking: two letters or more, each once, longest first so a longer
 * word wins where two overlap. */
function searchTerms(query: string): string[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word.length >= 2);
  return [...new Set(words)].sort((one, other) => other.length - one.length);
}

/** `text` cut into the stretches a search matched and the rest, in order. Matching ignores case.
 * When lower-casing would change the text's length (a few letters do), positions could not be
 * trusted, so nothing is marked rather than marking the wrong letters. */
export function matchParts(text: string, query: string): MatchPart[] {
  const terms = searchTerms(query);
  if (!text || !terms.length) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return [{ text, hit: false }];
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    let from = lower.indexOf(term);
    while (from >= 0) {
      for (let index = from; index < from + term.length; index += 1) marked[index] = true;
      from = lower.indexOf(term, from + term.length);
    }
  }
  const parts: MatchPart[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marked[index]) last.text += text[index];
    else parts.push({ text: text[index], hit: marked[index] });
  }
  return parts;
}

/** A row's words with what the search matched marked. With nothing to mark (no search, or the feel
 * off, which the page says by passing an empty `mark`) it is the plain text, exactly as before. The
 * mark is decoration: the row's accessible name already holds the whole text. */
export function Matched({ text, mark }: { text: string; mark: string }) {
  if (!mark) return <>{text}</>;
  const parts = matchParts(text, mark);
  if (parts.length === 1 && !parts[0].hit) return <>{text}</>;
  return <>{parts.map((part, index) => (part.hit ? <mark key={index} className="feel-match">{part.text}</mark> : part.text))}</>;
}

/** After "Select all": the ticks on screen land one after another, top to bottom. Only rows on
 * screen take part (at most 40), so a long list costs the same as a short one. The class comes off
 * when each tick has landed, with a timer behind it for a browser that sends no animationend. */
export function cascadeTicks(list: Element | null) {
  if (!list || !feelOn('motion') || feelCalm()) return;
  // after the ticks are drawn, so the newly checked boxes are the ones that move
  window.requestAnimationFrame(() => {
    visibleRows(list, ':scope > li').forEach((row, index) => {
      const box = row.querySelector<HTMLElement>('.library-batch-check');
      if (!box) return;
      box.style.setProperty('--i', String(index));
      box.classList.remove('feel-cascade');
      // read layout once so the class added again starts its animation afresh
      void box.offsetWidth;
      box.classList.add('feel-cascade');
      const clear = () => box.classList.remove('feel-cascade');
      box.addEventListener('animationend', clear, { once: true });
      window.setTimeout(clear, 1600);
    });
  });
}

/** Open a song's details from its row: the row's cover (and its title) travel into the sheet when
 * page transitions run; otherwise the sheet simply opens, as before. */
export function openFromRow(id: number, open: () => void) {
  const button = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(`[data-focus-key="song-details-${id}"]`);
  const cover = button?.querySelector('.cover-art');
  const title = button?.querySelector('b');
  if (!button || !feelOn('motion')) {
    open();
    return;
  }
  const share: [Element, string][] = [];
  if (cover) share.push([cover, 'song-art']);
  if (title) share.push([title, 'song-title']);
  changeScene(open, document, window, { direction: 'jump', share });
}

/** How far a finger carries a row before letting go does something; crossing it buzzes once. */
export const SWIPE_DETENT = 72;
/** The most a row follows the finger; past the detent it follows at a third of the pace. */
const SWIPE_MOST = SWIPE_DETENT * 1.4;
const SWIPE_START = 10;

/** Where a row sits for a finger `dx` along: the finger's own distance up to the detent, then a
 * third of the extra, never past SWIPE_MOST. */
export function swipeOffset(dx: number): number {
  const reach = Math.abs(dx);
  const along = reach <= SWIPE_DETENT ? reach : Math.min(SWIPE_DETENT + (reach - SWIPE_DETENT) / 3, SWIPE_MOST);
  return Math.sign(dx) * along;
}

type Held = { id: number; row: HTMLElement; x: number; y: number; engaged: boolean; side: 'left' | 'right' | null };

/** Phone rows that answer a swipe (plan 3.6): a finger drawn left past the detent opens the row's
 * More actions menu, drawn right it ticks the row's box when it has one. Each detent crossed is a
 * small buzz where the phone can. One set of listeners on the list, never one per row, and a
 * vertical move is left to the page so scrolling is untouched. Mouse and pen do nothing here; the
 * same actions are always on the row as buttons. Off while motion is off or calm. */
export function useRowSwipe(list: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = list.current;
    if (!element) return undefined;
    let held: Held | null = null;
    let swallowClick = false;
    // the row settles back on the gentle spring from wherever the finger left it
    const release = (row: HTMLElement) => {
      const from = row.style.translate;
      delete row.dataset.swiping;
      delete row.dataset.swipe;
      row.style.translate = '';
      const duration = motionMs('--motion-spring-snappy', 320);
      if (!from || !duration || typeof row.animate !== 'function') return;
      const curve = getComputedStyle(document.documentElement).getPropertyValue('--spring-gentle').trim() || 'ease-out';
      const frames: Keyframe[] = [{ translate: from }, { translate: '0 0' }];
      try {
        row.animate(frames, { duration, easing: curve });
      } catch {
        row.animate(frames, { duration, easing: 'ease-out' });
      }
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !event.isPrimary || !feelOn('motion') || feelCalm()) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, select, textarea, [role="menu"]')) return;
      const row = target.closest<HTMLElement>('.library-rows > li');
      if (!row || row.parentElement !== element) return;
      held = { id: event.pointerId, row, x: event.clientX, y: event.clientY, engaged: false, side: null };
    };
    const move = (event: PointerEvent) => {
      if (!held || held.id !== event.pointerId) return;
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      if (!held.engaged) {
        // the page is scrolling: the row stays out of it
        if (Math.abs(dy) > SWIPE_START && Math.abs(dy) >= Math.abs(dx)) { held = null; return; }
        if (Math.abs(dx) < SWIPE_START || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        held.engaged = true;
        held.row.dataset.swiping = '';
      }
      held.row.style.translate = `${swipeOffset(dx).toFixed(1)}px 0`;
      const side = Math.abs(dx) >= SWIPE_DETENT ? (dx < 0 ? 'left' : 'right') : null;
      if (side !== held.side) {
        held.side = side;
        if (side) {
          held.row.dataset.swipe = side;
          tick();
        } else delete held.row.dataset.swipe;
      }
    };
    const up = (event: PointerEvent) => {
      if (!held || held.id !== event.pointerId) return;
      const { row, engaged, side } = held;
      held = null;
      if (!engaged) return;
      // the press that ends a swipe is not also a tap on whatever it ended over
      swallowClick = true;
      window.setTimeout(() => { swallowClick = false; }, 400);
      release(row);
      if (event.type !== 'pointerup' || !side) return;
      if (side === 'left') {
        const more = row.querySelector<HTMLButtonElement>('.song-actions .menu > button[aria-haspopup="menu"]');
        if (!more) return;
        tap();
        more.click();
        return;
      }
      const box = row.querySelector<HTMLInputElement>('.library-batch-check input[type="checkbox"]');
      if (!box || box.disabled) return;
      tap();
      box.click();
    };
    const click = (event: MouseEvent) => {
      // the swipe's own press on the menu or the box is made by script and goes through
      if (!swallowClick || !event.isTrusted) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('click', click, true);
    return () => {
      if (held) release(held.row);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('click', click, true);
    };
  }, [list]);
}
