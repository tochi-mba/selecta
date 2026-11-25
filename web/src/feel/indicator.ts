import { RefObject, useLayoutEffect, useState } from 'react';
import { feelOn, onFeelChange } from './root';

/** The sliding indicator (ADR-0477): one mark under the chosen tab, segment or nav item that travels
 * to the next choice instead of jumping.
 *
 * The hook measures the active child of a container and writes where it is onto the container as
 * four custom properties; styles/feel-parts.css draws one `.feel-indicator` element from them with
 * translate and scale only, so travelling never lays the page out again:
 *
 *   --ind-x, --ind-y   the active child's top-left corner inside the container, in px
 *   --ind-w, --ind-h   its width and height, as plain numbers of px (scale factors need no unit)
 *
 * The container renders the mark itself, anywhere among its children (feel-parts.css stacks a fill
 * mark behind the words with z-index, so first or last both work):
 *   <span className="feel-indicator" aria-hidden="true" />
 * and may set data-indicator-shape="fill" for a block behind the choice instead of a line under it.
 *
 * A container that is drawn later than the component (its ref empty on the first render) is picked
 * up on the commit that draws it, and a ref that moves to a new element follows it.
 *
 * Without data-feel~='motion' nothing is measured and the mark is not drawn, so the container's own
 * static selected styles carry the choice, exactly as before. The choice is never carried by the
 * mark alone either way (aria-selected, aria-current and the existing styles stay). */
export const INDICATOR_CLASS = 'feel-indicator';

export function useSlidingIndicator(containerRef: RefObject<HTMLElement | null>, activeSelector: string) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  // every commit: one comparison, and a re-attach only when the container appeared or changed
  useLayoutEffect(() => {
    if (containerRef.current !== container) setContainer(containerRef.current);
  });
  useLayoutEffect(() => {
    if (!container) return;
    let observed: Element | null = null;
    let frame = 0;
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;

    function clear() {
      delete container!.dataset.indicator;
      for (const name of ['--ind-x', '--ind-y', '--ind-w', '--ind-h']) container!.style.removeProperty(name);
    }

    function measure() {
      if (!feelOn('motion')) {
        clear();
        return;
      }
      const active = container!.querySelector(activeSelector);
      if (active !== observed) {
        if (observed) resize?.unobserve(observed);
        if (active) resize?.observe(active);
        observed = active;
      }
      if (!(active instanceof HTMLElement) || !active.offsetWidth) {
        // nothing chosen, or the choice is hidden: no mark rather than a mark in the wrong place
        clear();
        return;
      }
      const box = container!.getBoundingClientRect();
      const rect = active.getBoundingClientRect();
      const style = container!.style;
      style.setProperty('--ind-x', `${(rect.left - box.left + container!.scrollLeft - container!.clientLeft).toFixed(1)}px`);
      style.setProperty('--ind-y', `${(rect.top - box.top + container!.scrollTop - container!.clientTop).toFixed(1)}px`);
      style.setProperty('--ind-w', rect.width.toFixed(1));
      style.setProperty('--ind-h', rect.height.toFixed(1));
      if (!container!.dataset.indicator) {
        // first placement: put the mark where it belongs without travel, then let later moves glide
        container!.dataset.indicator = 'placed';
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (container!.dataset.indicator === 'placed') container!.dataset.indicator = 'live';
        });
      }
    }

    // a change of choice shows as an attribute or class change on a child; a new child list too
    const mutations = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => measure()) : null;
    mutations?.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'aria-pressed', 'aria-checked', 'class', 'data-active'] });
    resize?.observe(container);
    const offFeel = onFeelChange(measure);
    measure();
    return () => {
      mutations?.disconnect();
      resize?.disconnect();
      offFeel();
      cancelAnimationFrame(frame);
      clear();
    };
  }, [container, activeSelector]);
}
