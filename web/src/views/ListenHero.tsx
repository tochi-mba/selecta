// Listen's hero (ADR-0477, plan 3.4): the playing song's cover, title and artist. Split out of
// Now.tsx (file length limit). With the feel off it is exactly the header Now.tsx drew before.
import { ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import type { MixItem } from '../api';
import { feelCalm, feelOn } from '../feel/root';
import { motionMs } from '../ui/exitMotion';
import { BuildMoment } from './BuildMoment';
import { CoverArt } from './CoverArt';
import { BeatSpot, spaceOf, springOf, useFeelPart } from './feelBits';

export function ListenHero({ item, stage, children }: { item?: MixItem; stage: boolean; children: ReactNode }) {
  const header = useRef<HTMLElement>(null);
  const ambient = useFeelPart('ambient');
  const songId = item?.song_id;

  // The cover is the thing that travels between pages (feel-scene.css names it only while a page
  // transition runs). CoverArt takes no extra attributes, and wrapping it would break the sheets that
  // place it as the header's own child, so the name is set on its element here.
  useLayoutEffect(() => {
    header.current?.querySelector(':scope > .cover-art')?.setAttribute('data-vt', 'player-art');
  }, [songId, stage]);

  // A new song: the cover settles in on a spring and the words slide up into place. Only on a real
  // change of song (the hand-over finishing, Next, a jump), never on the first draw, and never when
  // motion is calm. Playback has already moved on; this only follows it.
  const seen = useRef(songId);
  useEffect(() => {
    const before = seen.current;
    seen.current = songId;
    if (before === songId || before === undefined || songId === undefined) return;
    const node = header.current;
    if (!node || !feelOn('motion') || feelCalm()) return;
    const duration = motionMs('--motion-spring-snappy', 320);
    if (!duration) return;
    const easing = springOf();
    const rise = spaceOf('--space-3', 12);
    const run = (element: Element | null, frames: Keyframe[]) => {
      if (!element || typeof (element as HTMLElement).animate !== 'function') return;
      try {
        (element as HTMLElement).animate(frames, { duration, easing });
      } catch {
        (element as HTMLElement).animate(frames, { duration, easing: 'ease-out' });
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
