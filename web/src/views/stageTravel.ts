// Listen's hero going on Stage and back (ADR-0477, plan 3.4). Split from ListenHero.tsx.
//
// The Stage itself (App.tsx: fullscreen, Escape, the Exit control, where focus goes) is unchanged;
// this only draws the change. Going on Stage, the cover grows out to fill the screen as it fades into
// the full-bleed wash of the song's colour (feel-listen.css .now.stage::before), and the title travels
// from its place in the hero to its place on Stage. Leaving reverses it: the wash fades back out, the
// cover settles back from the full screen into its place, and the title travels home.
//
// Only with the motion part on and not calm (so never under Still, reduced motion or the second
// low-power step); otherwise the Stage simply opens and closes at once, as before. Pause and every
// control answer at once throughout: nothing here waits or takes a press.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { feelCalm, feelOn } from '../feel/root';
import { motionMs } from '../ui/exitMotion';
import { springOf } from './feelBits';

type Box = { left: number; top: number; width: number; height: number };

const boxOf = (element: Element | null | undefined): Box | null => {
  const box = element?.getBoundingClientRect();
  return box && box.width && box.height ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
};

/** The move from where something is now back to where it was, as a FLIP's first frame. */
export function travelFrom(was: Box, now: Box): string {
  const dx = was.left - now.left;
  const dy = was.top - now.top;
  const scale = now.height ? was.height / now.height : 1;
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(3)})`;
}

/** What it would take to fill the window from a box: the move to the window's middle and the scale. */
export function fillFrom(box: Box, view: { width: number; height: number }): string {
  const dx = view.width / 2 - (box.left + box.width / 2);
  const dy = view.height / 2 - (box.top + box.height / 2);
  const scale = Math.max(view.width / box.width, view.height / box.height);
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(3)})`;
}

function moving(): boolean {
  return feelOn('motion') && !feelCalm();
}

type Look = Record<string, string>;

/** The cover's own painted look, read while it is still on the page: its copy is drawn outside the
 * hero, where the sheets that paint it no longer reach. */
function lookOf(cover: HTMLElement | null): Look {
  if (!cover) return {};
  const look = getComputedStyle(cover);
  const kept: Look = {};
  for (const name of ['background', 'border-radius', 'border', 'color', 'overflow', 'box-shadow']) kept[name] = look.getPropertyValue(name);
  return kept;
}

/** A copy of the cover laid over where it was, never in the page's flow and never pressable. */
function ghostOf(cover: HTMLElement, box: Box, look: Look): HTMLElement {
  const copy = cover.cloneNode(true) as HTMLElement;
  for (const [name, value] of Object.entries(look)) if (value) copy.style.setProperty(name, value);
  copy.removeAttribute('data-vt');
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.classList.add('stage-travel-ghost');
  Object.assign(copy.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0' });
  document.body.appendChild(copy);
  return copy;
}

function play(element: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions, done?: () => void) {
  if (!element || typeof (element as HTMLElement).animate !== 'function') { done?.(); return; }
  let animation: Animation;
  try {
    animation = (element as HTMLElement).animate(frames, options);
  } catch {
    animation = (element as HTMLElement).animate(frames, { ...options, easing: 'ease-out' });
  }
  if (done) animation.finished?.then(done, done);
}

/** Draws the hero's change of place when Stage opens or closes. `header` is the hero. */
export function useStageTravel(header: RefObject<HTMLElement | null>, stage: boolean) {
  // measured in the render that changes Stage, while the page still shows the old layout
  const seen = useRef(stage);
  const before = useRef<{ title: Box | null; cover: HTMLElement | null; coverBox: Box | null; look: Look } | null>(null);
  if (seen.current !== stage) {
    seen.current = stage;
    const node = header.current;
    if (node && moving()) {
      const cover = node.querySelector<HTMLElement>(':scope > .cover-art');
      before.current = { title: boxOf(node.querySelector(':scope > .track-title')), cover, coverBox: boxOf(cover), look: stage ? lookOf(cover) : {} };
    } else {
      before.current = null;
    }
  }

  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    const node = header.current;
    if (!was || !node || !moving() || typeof window === 'undefined') return;
    const duration = motionMs('--motion-spring-glide', 480);
    if (!duration) return;
    const easing = springOf('--spring-gentle');
    const fade = motionMs('--motion-overlay', 220);
    const view = { width: window.innerWidth, height: window.innerHeight };

    // the title travels between its two places (transform only, so nothing reflows)
    const title = node.querySelector(':scope > .track-title');
    const titleNow = boxOf(title);
    if (was.title && titleNow) play(title, [{ transform: travelFrom(was.title, titleNow), transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], { duration, easing });

    if (stage) {
      // the cover has gone from the page: a copy of it grows out to the whole screen and fades into
      // the wash, which fades in under it (feel-listen.css)
      if (was.cover && was.coverBox) {
        const ghost = ghostOf(was.cover, was.coverBox, was.look);
        const gone = () => ghost.remove();
        window.setTimeout(gone, duration + 80);
        play(ghost, [{ transform: 'none', opacity: 1 }, { transform: fillFrom(was.coverBox, view), opacity: 0 }], { duration, easing, fill: 'forwards' }, gone);
      }
      return;
    }
    // back from Stage: the wash (drawn only with the ambient part) fades away over the page, and the
    // cover settles from the full screen into its place
    if (feelOn('ambient')) {
      const wash = document.createElement('div');
      wash.className = 'stage-travel-wash';
      wash.setAttribute('aria-hidden', 'true');
      document.body.appendChild(wash);
      const washGone = () => wash.remove();
      window.setTimeout(washGone, duration + 80);
      play(wash, [{ opacity: 1 }, { opacity: 0 }], { duration: Math.max(fade, duration / 2), easing: 'ease-out', fill: 'forwards' }, washGone);
    }
    const cover = node.querySelector(':scope > .cover-art');
    const coverNow = boxOf(cover);
    if (coverNow) play(cover, [{ transform: fillFrom(coverNow, view), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration, easing });
  }, [stage, header]);
}
