import { feelCalm, feelOn } from '../feel/root';
import { motionMs } from './exitMotion';

/** Every phone sheet can be dragged by its title bar (ADR-0477, plan 3.0 "Drawer and sheet"), the
 * way the editor's own sheet already is (views/PhoneSheet.tsx, which keeps its own handling and is
 * left alone: a sheet given a grabber is skipped here).
 *
 * Down follows the finger; letting go far enough, or with a flick, closes the sheet, and the exit
 * carries on from where the finger left it. Short of that it springs back. Up gives a little and
 * resists, like a rubber band, because a sheet that is already as tall as it gets has nowhere to go.
 *
 * The sheet moves by the `translate` property, never `transform`, because its arrival animation
 * holds `transform` and would hide anything written there. Only with the feel's motion on and only
 * where the sheet comes up from the bottom (the phone layout, max-width 760px, styles/shell.css);
 * everywhere else nothing listens and Close, Escape and a press outside work as they always did. */

/** The phone layout, where drawers and sheets rise from the bottom (styles/shell.css). */
export const PHONE_SHEET = '(max-width: 760px)';
/** How far down, in CSS pixels, a drag must go before letting go closes the sheet. */
export const CLOSE_AFTER = 96;
/** A flick: this fast (px per ms) closes the sheet even over a short distance. */
export const FLICK = 0.5;
/** The furthest the sheet gives when pulled up. */
const STRETCH = 24;

/** Where the sheet is drawn for a finger `moved` pixels from where it started: down follows it,
 * up gives a little and then holds. */
export function sheetOffset(moved: number): number {
  if (moved >= 0) return moved;
  return -Math.min(STRETCH, Math.sqrt(-moved) * 2);
}

/** Whether letting go after `moved` pixels at `speed` px per ms closes the sheet. */
export function sheetCloses(moved: number, speed: number): boolean {
  return moved > CLOSE_AFTER || (moved > 16 && speed > FLICK);
}

function phone(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.(PHONE_SHEET).matches ?? false);
}

/** Starts listening on `panel` (an open sheet's `.overlay-panel`). A drag starts on the title bar
 * or the panel's own top edge, never on a button, link or field. Returns the stop. */
export function dragToClose(panel: HTMLElement, close: () => void): () => void {
  let held: { id: number; y: number; at: number; moved: number; dragging: boolean } | null = null;
  let settle: Animation | null = null;
  const place = (offset: number) => {
    panel.style.translate = offset ? `0 ${offset.toFixed(1)}px` : '';
  };
  const start = (event: PointerEvent) => {
    if (held || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (!feelOn('motion') || !phone()) return;
    const target = event.target as Element | null;
    if (target?.closest('button, a, input, select, textarea, [role="slider"], [contenteditable="true"]')) return;
    const head = panel.querySelector('.overlay-head');
    const onHead = !!head && head.contains(target);
    if (!onHead && target !== panel) return;
    settle?.cancel();
    settle = null;
    held = { id: event.pointerId, y: event.clientY, at: event.timeStamp, moved: 0, dragging: false };
  };
  const move = (event: PointerEvent) => {
    if (!held || held.id !== event.pointerId) return;
    held.moved = event.clientY - held.y;
    // captured only once it really moves, so a tap on the title stays a tap
    if (!held.dragging && Math.abs(held.moved) > 4) {
      held.dragging = true;
      panel.setAttribute('data-sheet-drag', '');
      try { panel.setPointerCapture?.(event.pointerId); } catch { /* the browser no longer tracks it */ }
    }
    if (held.dragging) place(sheetOffset(held.moved));
  };
  const springBack = () => {
    const from = panel.style.translate;
    place(0);
    if (!from || feelCalm() || typeof panel.animate !== 'function') return;
    const curve = getComputedStyle(document.documentElement).getPropertyValue('--spring-snappy').trim() || 'ease-out';
    const duration = motionMs('--motion-spring-release', 420);
    try {
      settle = panel.animate([{ translate: from }, { translate: '0 0' }], { duration, easing: curve });
    } catch {
      settle = panel.animate([{ translate: from }, { translate: '0 0' }], { duration, easing: 'ease-out' });
    }
  };
  const end = (event: PointerEvent, cancelled = false) => {
    if (!held || held.id !== event.pointerId) return;
    const { moved, at, dragging } = held;
    held = null;
    panel.removeAttribute('data-sheet-drag');
    if (!dragging) return;
    const speed = moved / Math.max(1, event.timeStamp - at);
    // the sheet stays where the finger left it, so its exit (on a copy, ui/exitMotion.ts) goes on
    // down from there
    if (!cancelled && sheetCloses(moved, speed)) close();
    else springBack();
  };
  const cancel = (event: PointerEvent) => end(event, true);
  panel.addEventListener('pointerdown', start);
  panel.addEventListener('pointermove', move);
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', cancel);
  return () => {
    panel.removeEventListener('pointerdown', start);
    panel.removeEventListener('pointermove', move);
    panel.removeEventListener('pointerup', end);
    panel.removeEventListener('pointercancel', cancel);
    settle?.cancel();
  };
}
