import { feelOn, onFeelChange } from './root';

/** The soft light under the mouse (ADR-0477, styles/feel.css `[data-glow]`).
 *
 * One passive pointermove listener on the document serves every `[data-glow]` element, so a list
 * of a hundred cards adds no listeners. Moves are folded into one animation frame, and the
 * position is written as `--mx` and `--my` (px from the element's top left) on the lit element
 * only, never on the page root, so a move restyles one card and nothing else.
 *
 * It listens only while the pointer part of the feel is on (Expressive, the flag, no low power)
 * and the computer has a mouse that can hover. Keyboard focus inside a glowing element centres the
 * light there. */

const PRECISE = '(hover: hover) and (pointer: fine)';

function host(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-glow]');
}

function clear(element: HTMLElement) {
  element.style.removeProperty('--mx');
  element.style.removeProperty('--my');
}

function place(element: HTMLElement, x: number, y: number) {
  const box = element.getBoundingClientRect();
  element.style.setProperty('--mx', `${Math.round(x - box.left)}px`);
  element.style.setProperty('--my', `${Math.round(y - box.top)}px`);
}

let started = 0;
let stop: (() => void) | null = null;

/** Start the pointer light. Safe to call more than once; each call returns its own stop, and the
 * listening ends when the last one is stopped. */
export function startPointerLight(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  started += 1;
  if (!stop) stop = watch();
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

function watch(): () => void {
  const precise = window.matchMedia?.(PRECISE);
  let lit: HTMLElement | null = null;
  let frame = 0;
  let pending: { target: EventTarget | null; x: number; y: number } | null = null;
  let listening = false;

  const light = (next: HTMLElement | null) => {
    if (next === lit) return;
    if (lit) clear(lit);
    lit = next;
  };

  const flush = () => {
    frame = 0;
    const move = pending;
    pending = null;
    if (!move) return;
    const next = host(move.target);
    light(next);
    if (next) place(next, move.x, move.y);
  };

  const onMove = (event: PointerEvent) => {
    // a finger or a pen that cannot hover has no light under it
    if (event.pointerType === 'touch') return;
    pending = { target: event.target, x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(flush);
  };

  const onOut = (event: PointerEvent) => {
    // leaving the window, or into something outside the lit element
    const into = event.relatedTarget;
    if (lit && (!(into instanceof Node) || !lit.contains(into))) {
      pending = null;
      light(null);
    }
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches(':focus-visible')) return;
    const next = host(target);
    if (!next) return;
    light(next);
    const box = next.getBoundingClientRect();
    next.style.setProperty('--mx', `${Math.round(box.width / 2)}px`);
    next.style.setProperty('--my', `${Math.round(box.height / 2)}px`);
  };

  const onFocusOut = (event: FocusEvent) => {
    const into = event.relatedTarget;
    if (lit && (!(into instanceof Node) || !lit.contains(into)) && !lit.matches(':hover')) light(null);
  };

  const listen = () => {
    if (listening) return;
    listening = true;
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
  };

  const quiet = () => {
    if (!listening) return;
    listening = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerout', onOut);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    light(null);
  };

  const check = () => {
    if (feelOn('pointer') && (precise?.matches ?? false)) listen();
    else quiet();
  };

  const offFeel = onFeelChange(check);
  precise?.addEventListener?.('change', check);
  check();

  return () => {
    offFeel();
    precise?.removeEventListener?.('change', check);
    quiet();
  };
}
