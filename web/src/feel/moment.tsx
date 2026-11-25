import { CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { motionMs } from '../ui/exitMotion';
import { feelOn } from './root';

/** The one-shot celebration (ADR-0477), for the rare moments worth marking: onboarding finished, a
 * first mix built, the first hand-off, an upgrade, an export.
 *
 * A burst of bars radiates once from the middle of whatever positioned box holds it, and is gone.
 * It is decoration (aria-hidden): the words beside it say what happened, and it never plays for
 * something that did not happen. It runs only under data-feel~='moments' (Expressive, the flag on,
 * no reduced motion, no low power), never loops, and a module-wide budget lets at most one run at a
 * time and at most one every 8 seconds, so a celebration can never become a light show. When it is
 * refused, `onDone` is still called, at once, so the caller's flow never waits on it.
 *
 *   equalizer   lime bars, like a level meter jumping once
 *   blend       lime and request-blue bars in turn: two songs meeting
 *
 * Styles and the `feel-moment-ray` keyframes: styles/feel-parts.css (.feel-moment). */
export type MomentKind = 'equalizer' | 'blend';

/** The gap the budget keeps between two celebrations, in ms. */
export const MOMENT_GAP_MS = 8000;

let runningNow = false;
let lastStart = Number.NEGATIVE_INFINITY;

const RAYS = 18;
/** Each ray's length, the same every time (no random numbers), like BlendArt's lanes. */
const LENGTHS = Array.from({ length: RAYS }, (_, index) => Math.round(22 + Math.abs(Math.sin(index * 1.7 + 0.4)) * 30));

export function Moment({ kind, onDone }: { kind: MomentKind; onDone?: () => void }) {
  const [shown, setShown] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  useLayoutEffect(() => {
    const now = performance.now();
    if (!feelOn('moments') || runningNow || now - lastStart < MOMENT_GAP_MS) {
      done.current?.();
      return;
    }
    const before = lastStart;
    runningNow = true;
    lastStart = now;
    setShown(true);
    let finished = false;
    // the burst's own length: the release spring twice, plus the last ray's stagger
    const length = motionMs('--motion-spring-release', 420) * 2 + motionMs('--motion-stagger', 30) * RAYS / 2;
    const timer = window.setTimeout(() => {
      finished = true;
      runningNow = false;
      setShown(false);
      done.current?.();
    }, length);
    return () => {
      window.clearTimeout(timer);
      if (finished) return;
      runningNow = false;
      // taken away before it played (or React's development double run): the budget is not spent
      lastStart = before;
    };
  }, []);

  if (!shown) return null;
  return (
    <span className="feel-moment" data-kind={kind} aria-hidden="true">
      <svg viewBox="-100 -100 200 200" focusable="false">
        {LENGTHS.map((length, index) => (
          <g key={index} transform={`rotate(${(360 / RAYS) * index})`}>
            <rect
              className={kind === 'blend' && index % 2 ? 'feel-moment-ray other' : 'feel-moment-ray'}
              style={{ '--i': index % 6 } as CSSProperties}
              x="-2.5"
              y={-(24 + length)}
              width="5"
              height={length}
              rx="2.5"
            />
          </g>
        ))}
      </svg>
    </span>
  );
}
