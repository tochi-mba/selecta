import { motionMs } from '../ui/exitMotion';
import { feelOn, onFeelChange } from './root';

/** Glow a row once with .feel-flash (styles/feel.css), and make sure the class goes when the glow
 * is over.
 *
 * Removing it on animationend alone is not enough: if motion turns off mid-glow (Still, reduced
 * motion, the second low-power step) the sheet's selector stops matching, no animationend ever
 * fires, the class stays, and the row glows unprompted the moment motion comes back. So the class
 * also goes when the feel's motion turns off, and after the glow's own length as a last resort. */
export function flashOnce(element: HTMLElement) {
  // a glow started again ends the earlier one first, so its timer cannot cut the new one short
  ending.get(element)?.();
  element.classList.remove('feel-flash');
  // read layout once so the class added again starts its animation afresh
  void element.offsetWidth;
  element.classList.add('feel-flash');
  // the sheet's length (four slow beats) and a margin, for a browser that sends no animationend
  const timer = window.setTimeout(end, motionMs('--motion-slow', 360) * 4 + 250);
  const stopHearing = onFeelChange(() => { if (!feelOn('motion')) end(); });
  function onEnd(event: AnimationEvent) {
    // a child's own animation ending is not this glow ending
    if (event.target === element) end();
  }
  function end() {
    window.clearTimeout(timer);
    stopHearing();
    element.removeEventListener('animationend', onEnd);
    element.classList.remove('feel-flash');
    if (ending.get(element) === end) ending.delete(element);
  }
  ending.set(element, end);
  element.addEventListener('animationend', onEnd);
}

const ending = new WeakMap<HTMLElement, () => void>();
