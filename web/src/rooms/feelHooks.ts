import { useSyncExternalStore } from 'react';
import { feelCalm, feelOn, onFeelChange, type FeelPart } from '../feel/root';
import { motionMs } from '../ui/exitMotion';

// The feel system (ADR-0477) as the Rooms and Devices screens ask for it. Kept here, beside the
// screens that use it, so these folders share one small reading of <html data-feel> and nothing
// in another worker's folder.

/** Whether one part of the feel is on, kept current as flags, the motion choice or low power change. */
export function useFeelPart(part: FeelPart): boolean {
  return useSyncExternalStore(onFeelChange, () => feelOn(part), () => false);
}

/** Slides an element from where it was (`from`, measured before it moved) to where it is now.
 * Used when a row leaves one list and appears in another, which flip() cannot follow because the
 * row is a new element. Only transform moves; with motion off or calm it does nothing. */
export function glideFrom(element: Element, from: DOMRect): void {
  if (feelCalm() || !feelOn('motion') || typeof element.animate !== 'function') return;
  const to = element.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  const duration = motionMs('--motion-spring-glide', 360);
  if (!duration) return;
  // the row's own arrival would fight the glide, so it is finished at once
  for (const running of element.getAnimations?.() ?? []) if (running instanceof CSSAnimation) running.finish();
  const curve = getComputedStyle(document.documentElement).getPropertyValue('--spring-snappy').trim() || 'ease-out';
  const frames: Keyframe[] = [{ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` }, { transform: 'translate(0, 0)' }];
  try {
    element.animate(frames, { duration, easing: curve });
  } catch {
    // an easing this browser cannot parse from script: the plain curve, same length
    element.animate(frames, { duration, easing: 'ease-out' });
  }
}

/** How long a folding row may take before it is removed anyway (no animationend when calm). */
export const FOLD_FALLBACK_MS = 600;
