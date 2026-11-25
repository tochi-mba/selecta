import { feelCalm, feelOn } from '../feel/root';
import { motionMs } from '../ui/exitMotion';

/** An example prompt flying into the box (ADR-0477, plan 3.9).
 *
 * The words are put in the box straight away; this only draws a copy of the chosen prompt that
 * travels from where it was pressed to the box and fades as it lands, so the eye follows the words
 * to where they now are. The copy is decoration: hidden from assistive technology, never pressable,
 * and removed when it lands. With the feel's motion off, Still, reduced motion or low power, or a
 * browser that cannot animate from script, nothing is drawn. Only transform and opacity move. */
export function flyInto(from: Element | null, findTarget: () => Element | null, words: string): void {
  if (!from || typeof document === 'undefined' || !feelOn('motion') || feelCalm()) return;
  if (typeof Element.prototype.animate !== 'function') return;
  const start = from.getBoundingClientRect();
  if (!start.width || !start.height) return;
  // the box may only be drawn on the next frame (a phone switches from the mix to the chat first)
  window.requestAnimationFrame(() => {
    const target = findTarget();
    if (!target) return;
    const end = target.getBoundingClientRect();
    if (!end.width || !end.height) return;
    const ghost = document.createElement('span');
    ghost.className = 'lucy-flight';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.textContent = words;
    Object.assign(ghost.style, {
      left: `${start.left}px`,
      top: `${start.top}px`,
      width: `${start.width}px`,
      height: `${start.height}px`,
    });
    document.body.appendChild(ghost);
    // it lands on the box's first line, at the start, where the words now begin
    const dx = end.left - start.left;
    const dy = end.top - start.top;
    const scale = Math.min(1, end.width / start.width);
    const duration = motionMs('--motion-spring-glide', 360);
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--spring-snappy').trim() || 'ease-out';
    const remove = () => ghost.remove();
    if (!duration) {
      remove();
      return;
    }
    const flight = ghost.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(3)})`, opacity: 0 },
    ], { duration, easing, fill: 'forwards' });
    flight.onfinish = remove;
    flight.oncancel = remove;
    // a tab hidden mid-flight may never finish its animation, so the copy also goes after a while
    window.setTimeout(remove, duration * 2 + 200);
  });
}
