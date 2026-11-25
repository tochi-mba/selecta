import { motionMs } from '../ui/exitMotion';
import { feelCalm, feelOn } from './root';

/** First, Last, Invert, Play (ADR-0477): when a list reorders, a row is added above others, or a
 * card changes size, the things that moved glide from where they were instead of jumping.
 *
 *   flip(rows, () => flushSync(() => setOrder(next)));
 *
 * `mutate` must have changed the page by the time it returns (or its promise settles): wrap a React
 * update in flushSync. Only transform is animated, on at most 40 elements that are on screen, with
 * the snappy spring; an element that left the page is skipped. Still, reduced motion, low power and
 * the motion flag off all mean the change simply happens. A second flip on the same element starts
 * from wherever the first one had got to, so every move can be interrupted. */
export const FLIP_LIMIT = 40;

const running = new WeakMap<Element, Animation>();

function onScreen(rect: DOMRect): boolean {
  if (!rect.width && !rect.height) return false;
  const height = window.innerHeight || document.documentElement.clientHeight;
  const width = window.innerWidth || document.documentElement.clientWidth;
  return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
}

/** The snappy spring as the stylesheet has it, or its plain fallback where the browser can't
 * animate a linear() curve from script. */
function easing(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--spring-snappy').trim();
  return value || 'ease-out';
}

export async function flip(elements: Iterable<Element>, mutate: () => void | Promise<void>): Promise<void> {
  if (typeof document === 'undefined' || feelCalm() || !feelOn('motion') || typeof Element.prototype.animate !== 'function') {
    await mutate();
    return;
  }
  const first = new Map<Element, DOMRect>();
  for (const element of elements) {
    if (first.size >= FLIP_LIMIT) break;
    // a move still under way is measured where it has got to, then stopped, so the next one
    // starts from there
    const rect = element.getBoundingClientRect();
    running.get(element)?.cancel();
    running.delete(element);
    if (onScreen(rect)) first.set(element, rect);
  }
  await mutate();
  const duration = motionMs('--motion-spring-snappy', 320);
  if (!duration || !first.size) return;
  const curve = easing();
  for (const [element, before] of first) {
    if (!element.isConnected) continue;
    const after = element.getBoundingClientRect();
    // centre to centre, because the element scales about its own centre
    const dx = before.left + before.width / 2 - (after.left + after.width / 2);
    const dy = before.top + before.height / 2 - (after.top + after.height / 2);
    const sx = after.width ? before.width / after.width : 1;
    const sy = after.height ? before.height / after.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    const from = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
    const frames: Keyframe[] = [{ transform: from }, { transform: 'translate(0, 0) scale(1, 1)' }];
    let animation: Animation;
    try {
      // added on top of the element's own transform, so a pressed or lifted card keeps its look
      animation = element.animate(frames, { duration, easing: curve, composite: 'add' });
    } catch {
      // an easing this browser can't parse from script: the plain curve, same length
      animation = element.animate(frames, { duration, easing: 'ease-out', composite: 'add' });
    }
    running.set(element, animation);
    animation.onfinish = () => {
      if (running.get(element) === animation) running.delete(element);
    };
  }
}
