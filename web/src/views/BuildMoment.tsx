// The build moment (ADR-0477, plan 3.3): a mix has just been built, and Listen opens on the songs
// that were really chosen arriving in a line, with an arc drawn wherever the plan joins two of them.
//
// It never delays anything. Make a Mix hands the real plan over (announceBuilt) and goes to Listen
// and starts playback at once, as it always did; the moment is drawn over Listen's hero while that
// happens, takes no press (pointer-events: none), goes away at the first press or key anywhere, and
// is gone within MAX_MS whatever happens. It is decoration, so it is hidden from assistive
// technology: the notice Make a Mix already gives says what was built. It only exists under the
// moments part of the feel (Expressive, the flag on, no reduced motion, no low power).
import { CSSProperties, useEffect, useState } from 'react';
import type { MixItem } from '../api';
import { feelOn } from '../feel/root';
import { motionMs } from '../ui/exitMotion';
import { CoverArt } from './CoverArt';

/** The most covers drawn: a line longer than this is no longer read as a line. */
const MOST = 8;
/** The moment's ceiling, however the tokens are set. */
export const MAX_MS = 1200;
/** A plan handed over and not shown within this long belongs to something else: it is dropped. */
const FRESH_MS = 4000;

let built: { items: MixItem[]; at: number } | null = null;

/** Called by Make a Mix the moment the server has said which mix it made, before going to Listen. */
export function announceBuilt(items: readonly MixItem[]) {
  if (!feelOn('moments') || !items.length) {
    built = null;
    return;
  }
  built = { items: items.slice(0, MOST), at: performance.now() };
}

function fresh(): MixItem[] | null {
  if (!built || performance.now() - built.at > FRESH_MS) return null;
  return built.items;
}

export function BuildMoment() {
  // read without taking, so a development double render sees the same plan; the effect takes it
  const [items, setItems] = useState<MixItem[] | null>(() => (feelOn('moments') ? fresh() : null));
  useEffect(() => {
    built = null;
    if (!items) return;
    const end = () => setItems(null);
    // the moment's own length (its arcs, then its fade), never more than the ceiling
    const length = Math.min(MAX_MS, motionMs('--motion-spring-glide', 360) * 2 + motionMs('--motion-spring-snappy', 320) + 80);
    const timer = window.setTimeout(end, length);
    window.addEventListener('pointerdown', end, { capture: true, passive: true });
    window.addEventListener('keydown', end, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', end, { capture: true });
      window.removeEventListener('keydown', end, { capture: true });
    };
  }, [items]);
  if (!items) return null;
  const count = items.length;
  return (
    <div className="build-moment" aria-hidden="true" style={{ '--count': count } as CSSProperties}>
      <div className="build-moment-line" data-stagger="">
        {items.map((item, index) => (
          <span className="build-moment-song" key={`${index}-${item.song_id}`} style={{ '--i': index } as CSSProperties}>
            <CoverArt seed={item.song_id} songId={item.song_id} size="small" />
          </span>
        ))}
      </div>
      <svg className="build-moment-arcs" viewBox={`0 0 ${count * 10} 10`} preserveAspectRatio="none" focusable="false">
        {items.map((item, index) => (index > 0 && item.seam ? (
          <path key={index} className="feel-tick" pathLength={1} vectorEffect="non-scaling-stroke"
            style={{ '--i': index } as CSSProperties}
            d={`M${(index - 1) * 10 + 5} 8 Q${index * 10} 0 ${index * 10 + 5} 8`} />
        ) : null))}
      </svg>
    </div>
  );
}
