// Listen's hero (ADR-0477, plan 3.4): the playing song's cover, title and artist. Split out of
// Now.tsx (file length limit). With the feel off it is exactly the header Now.tsx drew before.
import { ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import type { MixItem } from '../api';
import { feelCalm, feelOn } from '../feel/root';
import { motionMs } from '../ui/exitMotion';
import { BuildMoment } from './BuildMoment';
import { CoverArt } from './CoverArt';
import { BeatSpot, spaceOf, springOf, useFeelPart } from './feelBits';

/** The whole song change on Listen, leaving and arriving, at most (ADR-0477). */
const LISTEN_CHANGE_MS = 320;
/** How long the outgoing cover and words take to leave. */
const LEAVE_MS = 120;

type Ghost = { copy: HTMLElement; left: number; top: number; width: number; height: number };

/** Copies of the cover, title and artist on show now, with where they are, for their leaving. */
function copyLeaving(header: HTMLElement): Ghost[] {
  const ghosts: Ghost[] = [];
  for (const element of Array.from(header.querySelectorAll<HTMLElement>(':scope > .cover-art, :scope > .track-title, :scope > .artist'))) {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const copy = element.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-vt');
    copy.removeAttribute('id');
    copy.setAttribute('aria-hidden', 'true');
    const look = getComputedStyle(element);
    for (const name of ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color', 'text-align', 'white-space', 'overflow-wrap']) {
      copy.style.setProperty(name, look.getPropertyValue(name));
    }
    ghosts.push({ copy, left: box.left, top: box.top, width: box.width, height: box.height });
  }
  return ghosts;
}

/** Lays the copies over where the old ones were, fades and lifts them away, then removes them. */
function leave(ghosts: Ghost[], duration: number, lift: number) {
  for (const { copy, left, top, width, height } of ghosts) {
    if (!duration || typeof copy.animate !== 'function') continue;
    Object.assign(copy.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, margin: '0', pointerEvents: 'none', boxSizing: 'border-box' });
    document.body.appendChild(copy);
    // a transformed ancestor would move a fixed box; correct by what it really landed on
    const landed = copy.getBoundingClientRect();
    if (landed.left !== left || landed.top !== top) Object.assign(copy.style, { left: `${2 * left - landed.left}px`, top: `${2 * top - landed.top}px` });
    const gone = () => copy.remove();
    window.setTimeout(gone, duration + 80);
    copy.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${-lift}px)` }], { duration, easing: 'ease-in', fill: 'forwards' }).finished?.then(gone, gone);
  }
}

export function ListenHero({ item, stage, children }: { item?: MixItem; stage: boolean; children: ReactNode }) {
  const header = useRef<HTMLElement>(null);
  const ambient = useFeelPart('ambient');
  const songId = item?.song_id;

  // The cover is the thing that travels between pages (feel-scene.css names it only while a page
  // transition runs). CoverArt takes no extra attributes, and wrapping it would break the sheets that
  // place it as the header's own child, so the name is set on its element here.
  // The title is the destination the mini player's title travels to (its `page-title` pair).
  useLayoutEffect(() => {
    header.current?.querySelector(':scope > .cover-art')?.setAttribute('data-vt', 'player-art');
    header.current?.querySelector(':scope > .track-title')?.setAttribute('data-vt', 'page-title');
  }, [songId, stage]);

  // The outgoing cover and words are copied the moment a new song is drawn, while the page still
  // shows the old ones (this render, before React commits), so they can leave once the real change
  // has landed. Only with motion on and not calm; the copies are never in the page's flow.
  const leaving = useRef<Ghost[]>([]);
  const copiedFor = useRef(songId);
  if (copiedFor.current !== songId) {
    copiedFor.current = songId;
    leaving.current = feelOn('motion') && !feelCalm() && header.current ? copyLeaving(header.current) : [];
  }

  // A new song: the cover settles in on a spring and the words slide up into place. Only on a real
  // change of song (the hand-over finishing, Next, a jump), never on the first draw, and never when
  // motion is calm. Playback has already moved on; this only follows it.
  const seen = useRef(songId);
  useEffect(() => {
    const before = seen.current;
    seen.current = songId;
    if (before === songId || before === undefined || songId === undefined) return;
    const ghosts = leaving.current;
    leaving.current = [];
    const node = header.current;
    if (!node || !feelOn('motion') || feelCalm()) return;
    const whole = motionMs('--motion-spring-snappy', 320);
    if (!whole) return;
    const easing = springOf();
    const rise = spaceOf('--space-3', 12);
    // the old ones leave first (a short fade and lift), then the new ones arrive; all of it within
    // about 320ms, and the real song has already changed underneath
    const out = ghosts.length ? Math.min(LEAVE_MS, whole / 3) : 0;
    const delay = out * 0.75;
    const duration = Math.max(1, Math.min(whole, LISTEN_CHANGE_MS) - delay);
    leave(ghosts, out, rise / 2);
    const run = (element: Element | null, frames: Keyframe[]) => {
      if (!element || typeof (element as HTMLElement).animate !== 'function') return;
      try {
        (element as HTMLElement).animate(frames, { duration, delay, easing, fill: 'backwards' });
      } catch {
        (element as HTMLElement).animate(frames, { duration, delay, easing: 'ease-out', fill: 'backwards' });
      }
    };
    run(node.querySelector(':scope > .cover-art'), [{ transform: 'scale(0.9)', opacity: 0.5 }, { transform: 'none', opacity: 1 }]);
    for (const words of Array.from(node.querySelectorAll(':scope > .track-title, :scope > .artist'))) {
      run(words, [{ transform: `translateY(${rise}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }]);
    }
  }, [songId]);

  return (
    <header ref={header} className="listen-identity">
      {item && !stage && <CoverArt seed={item.song_id} songId={item.song_id} size="hero" />}
      {/* the room's tint gathered behind the cover; it brightens on measured kicks and swells with the
          measured loudness the bus writes (--energy), and is still when nothing is measured */}
      {item && !stage && ambient && <span className="listen-bloom" aria-hidden="true"><BeatSpot kind="glow" /></span>}
      {children}
      {!stage && <BuildMoment />}
    </header>
  );
}
