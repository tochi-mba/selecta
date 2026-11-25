import { feelCalm, feelOn } from '../feel/root';
import { changeScene } from '../shell/sceneTransition';
import { motionMs } from '../ui/exitMotion';

/** The editor's own feel pieces (ADR-0477, plan 3.7). Each does nothing while motion is off or calm,
 * so the editor behaves exactly as before then. */

/** The gentle spring as the stylesheet has it: a song landing in the timeline settles, it never
 * bounces past its place (ADR-0137 keeps overshoot out of timeline drops). */
function gentle(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--spring-gentle').trim() || 'ease-out';
}

/** The move that carries an element from the box it was drawn in (`from`) to where it is now, as a
 * transform: centre to centre, and scaled from the old size. Null when it is already there. */
export function flyFrame(from: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, to: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): string | null {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const sx = to.width ? from.width / to.width : 1;
  const sy = to.height ? from.height / to.height : 1;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return null;
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
}

/** The chosen suggestion flies into the gap as the new row (plan 3.7 Adder). `from` is where the
 * suggestion was when it was pressed; `find` names the row once the server's mix is drawn. Waits two
 * frames for that drawing, and gives up quietly when the row is not there (the add was refused). */
export function flyInto(from: DOMRect | null | undefined, find: () => Element | null) {
  if (!from || typeof window === 'undefined' || feelCalm() || !feelOn('motion')) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const row = find();
    if (!row || typeof row.animate !== 'function') return;
    const frame = flyFrame(from, row.getBoundingClientRect());
    if (!frame) return;
    const duration = motionMs('--motion-spring-glide', 360);
    if (!duration) return;
    const frames: Keyframe[] = [{ transform: frame, opacity: 0.6 }, { transform: 'none', opacity: 1 }];
    try {
      row.animate(frames, { duration, easing: gentle() });
    } catch {
      row.animate(frames, { duration, easing: 'ease-out' });
    }
  }));
}

/** Open a transition so its small diagram in the row grows into the inspector's header (plan 3.7
 * Seams), when page transitions run. Only on opening from nothing: with another transition already
 * open, two diagrams would carry the name and the browser would skip the travel, so the inspector
 * just changes, as before. */
export function expandSeam(row: Element | null, opening: boolean, update: () => void) {
  const diagram = row?.querySelector('.music-seam-diagram');
  if (!opening || !diagram || !feelOn('motion')) {
    update();
    return;
  }
  changeScene(update, document, window, { direction: 'jump', share: [[diagram, 'seam-diagram']] });
}
