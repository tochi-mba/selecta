import { RefObject, useEffect } from 'react';

/** The nearest ancestor that scrolls vertically, the box a pinned header is sticky inside. */
export function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

/**
 * P0074 / MP-0288-06 (WCAG 2.4.11): a header pinned at the top of a scrolling panel (the transition's
 * identity, the Studio's head) must never hide the control that has the focus. The panel's
 * scroll-padding-top is set to the pinned header's real height, so the browser scrolls a focused control
 * clear of it, however many lines the header wraps to. The height is written as
 * `--sticky-clearance` on the scroll container; the stylesheet turns it into scroll-padding.
 */
export function useStickyClearance(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const container = scrollParent(element);
    if (!container) return;
    // a short screen unpins the header (typography.css, max-height: 420px), so then it needs no room
    const measure = () => {
      const pinned = getComputedStyle(element).position === 'sticky';
      const height = pinned ? Math.ceil(element.getBoundingClientRect().height) : 0;
      container.style.setProperty('--sticky-clearance', `${height}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      container.style.removeProperty('--sticky-clearance');
    };
  }, [ref]);
}
