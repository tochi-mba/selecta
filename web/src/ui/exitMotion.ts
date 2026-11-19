import { RefObject, useLayoutEffect, useRef, useState } from 'react';

/** The exit-animation protocol (the overhaul's cross-wave contract). Something closing sets
 * `data-closing` on its root; the sheets animate that at the motion tokens; this code takes it away
 * when the animation ends. If the animation never ends (the tab is hidden, the element is
 * `display: none`), a timeout of the token's own length takes it away anyway. The timeouts read the
 * `--motion-exit-*` tokens, which reduced motion keeps at a short fade instead of zeroing. If nothing animates at
 * all (reduced motion with no opacity fade, a sheet without the keyframes, a test runner with no
 * CSS), it goes at once, so nothing waits on motion that isn't there.
 *
 * Panels that pop in (menus, popovers, tooltips) also carry `data-motion="pop"`, the one hook the
 * sheets use for their appear animation. */

function toMs(value: string): number {
  const text = value.trim();
  if (!text) return Number.NaN;
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return Number.NaN;
  return text.endsWith('ms') ? number : text.endsWith('s') ? number * 1000 : number;
}

/** A motion token's length in milliseconds, read from the page at the moment it is needed, so a
 * theme, a density or reduced motion that changes the token changes the wait with it. */
export function motionMs(token: string, fallback = 220): number {
  if (typeof document === 'undefined') return fallback;
  const value = toMs(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(value) ? value : fallback;
}

/** The longest animation a node is running now, in milliseconds (duration plus delay), or 0 when
 * it has none. */
function animationLength(node: Element): number {
  const style = getComputedStyle(node);
  const names = (style.animationName || '').split(',').map((name) => name.trim());
  if (!names.some((name) => name && name !== 'none')) return 0;
  const durations = (style.animationDuration || '').split(',').map(toMs);
  const delays = (style.animationDelay || '').split(',').map(toMs);
  let longest = 0;
  names.forEach((name, index) => {
    if (!name || name === 'none') return;
    const duration = durations[index % Math.max(durations.length, 1)] ?? 0;
    const delay = delays[index % Math.max(delays.length, 1)] ?? 0;
    longest = Math.max(longest, (Number.isFinite(duration) ? duration : 0) + (Number.isFinite(delay) ? Math.max(delay, 0) : 0));
  });
  return longest;
}

/** Marks `node` as closing and calls `done` once its exit animation has finished, or at once when it
 * has none. The root or its first child may carry the animation (a backdrop fades while its panel
 * slides). Returns a cancel, which takes `data-closing` away again and never calls `done`. */
export function playExit(node: HTMLElement, done: () => void, token = '--motion-exit-drawer'): () => void {
  node.setAttribute('data-closing', '');
  const panel = node.firstElementChild;
  const longest = Math.max(animationLength(node), panel ? animationLength(panel) : 0);
  let finished = false;
  let timer: number | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    node.removeEventListener('animationend', ended);
    window.clearTimeout(timer);
    done();
  };
  const ended = (event: AnimationEvent) => {
    if (event.target === node || event.target === panel) finish();
  };
  if (longest <= 0) {
    finish();
    return () => {};
  }
  node.addEventListener('animationend', ended);
  // The fallback follows the same exit token as the stylesheet. Animation duration can be
  // clamped by reduced-motion rules or reported differently by a browser; it must not extend
  // the close beyond the contract (120ms for sheets, 80ms for menus under reduced motion).
  timer = window.setTimeout(finish, motionMs(token));
  return () => {
    if (finished) return;
    finished = true;
    node.removeEventListener('animationend', ended);
    window.clearTimeout(timer);
    node.removeAttribute('data-closing');
  };
}

/** Plays an overlay's exit on a copy of it, because whoever opened it has already taken the real one
 * out of the page. The copy is inert and hidden from assistive technology, so focus and the reading
 * order are already back on the page while it fades.
 *
 * Call it from the overlay's unmount clean-up, while the real one is still in the page. The copy
 * only goes in once the real one has actually left: React's development double-run of effects
 * unmounts and remounts the same node, and that must not flash a closing copy on open. */
export function exitGhost(node: HTMLElement | null, token = '--motion-exit-drawer') {
  const parent = node?.parentNode;
  if (!node?.isConnected || !parent) return;
  const after = node.nextSibling;
  const ghost = node.cloneNode(true) as HTMLElement;
  // keep the place the reader had scrolled to, so the closing panel doesn't jump to its top
  const scrolled = [node, ...node.querySelectorAll<HTMLElement>('.overlay-panel, .overlay-body')].map((part) => part.scrollTop);
  queueMicrotask(() => {
    if (node.isConnected || !parent.isConnected) return;
    ghost.setAttribute('inert', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.pointerEvents = 'none';
    ghost.removeAttribute('id');
    for (const named of ghost.querySelectorAll('[id]')) named.removeAttribute('id');
    for (const media of ghost.querySelectorAll('video, audio, iframe, object, embed')) media.remove();
    parent.insertBefore(ghost, after && after.parentNode === parent ? after : null);
    const parts = [ghost, ...ghost.querySelectorAll<HTMLElement>('.overlay-panel, .overlay-body')];
    scrolled.forEach((top, index) => { if (parts[index] && top) parts[index].scrollTop = top; });
    playExit(ghost, () => ghost.remove(), token);
  });
}

/** Keeps something on screen while it animates out. `present` is whether to render it at all;
 * `closing` is whether it is on its way out (render `data-closing`, `aria-hidden` and `inert`). */
export function usePresence<T extends HTMLElement>(open: boolean, token = '--motion-exit-menu'): { present: boolean; closing: boolean; ref: RefObject<T | null> } {
  const [shown, setShown] = useState(open);
  const ref = useRef<T | null>(null);
  const present = open || shown;
  const closing = !open && shown;
  useLayoutEffect(() => {
    if (open) {
      if (!shown) setShown(true);
      return undefined;
    }
    if (!shown) return undefined;
    const node = ref.current;
    if (!node) {
      setShown(false);
      return undefined;
    }
    return playExit(node, () => setShown(false), token);
  }, [open, shown, token]);
  return { present, closing, ref };
}
