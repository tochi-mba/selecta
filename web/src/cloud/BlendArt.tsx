import { CSSProperties, PointerEvent, useRef } from 'react';
import { usePrefs } from '../state/prefs';
import { useReducedMotion } from '../ui/useReducedMotion';

// SelectaDJ's one picture: a song handing over to the next. Two lanes of bars, the two volume
// curves crossing, and a playhead moving through the blend. It is the drawing on the landing page
// and, with nothing in the second lane, the drawing on every "nothing here" page. Decoration only:
// the words beside it say everything it shows. Styles: styles/boot.css (.welcome-art).
//
// Motion follows the person's choice (state/prefs.ts) and the device's own setting:
//   Still, reduced motion, low power   a still drawing, the playhead resting on the blend
//   Subtle (the default)               the playhead crosses and the blend point answers it
//   Expressive                         each bar also lifts as the playhead passes, and the card
//                                      leans a few degrees toward the pointer

/** One lane of the drawing: bars whose heights never change between draws (no random numbers). */
function lane(count: number, seed: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.abs(Math.sin(index * 0.83 + seed) * Math.cos(index * 0.31 + seed * 2));
    return Math.round(10 + wave * 54);
  });
}
const BARS = 46;
const STEP = 10;
const LEFT = 12;
/** The bar the blend is centred on, and where the playhead rests when nothing moves. */
const SEAM = BARS / 2;
const OUTGOING = lane(BARS, 0.4);
const INCOMING = lane(BARS, 2.1);
/** How loud a lane is drawn at a bar: full before the blend, quiet after it (or the reverse). */
function level(index: number, rising: boolean): number {
  const through = Math.min(1, Math.max(0, (index - 15) / 16));
  const share = rising ? through : 1 - through;
  return Number((0.28 + share * 0.72).toFixed(2));
}
/** A bar's place in the row, for the moment the playhead reaches it. */
const at = (index: number) => ({ '--i': index }) as CSSProperties;
/** The furthest the card leans toward the pointer, in degrees. */
const LEAN = 3;

export type BlendVariant = 'blend' | 'missing';

/** Two songs, one fading out as the next fades in; or, for `missing`, a song with nothing after it. */
export function BlendArt({ variant = 'blend', from = 'Now playing', to = variant === 'missing' ? 'Nothing here' : 'Up next' }: {
  variant?: BlendVariant;
  /** The words on the two tags. Decoration, so they are never read out. */
  from?: string;
  to?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const { motion } = usePrefs();
  const leans = !still && motion === 'expressive';
  const missing = variant === 'missing';

  // The light under the pointer, and the lean toward it. Both are set straight on the element, so
  // following the pointer never re-renders the drawing.
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const element = card.current;
    if (!element || event.pointerType === 'touch') return;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    element.style.setProperty('--spot-x', `${(x * 100).toFixed(1)}%`);
    element.style.setProperty('--spot-y', `${(y * 100).toFixed(1)}%`);
    if (leans) {
      element.style.setProperty('--lean-x', `${((0.5 - y) * 2 * LEAN).toFixed(2)}deg`);
      element.style.setProperty('--lean-y', `${((x - 0.5) * 2 * LEAN).toFixed(2)}deg`);
    }
  };
  const settle = () => {
    for (const name of ['--spot-x', '--spot-y', '--lean-x', '--lean-y']) card.current?.style.removeProperty(name);
  };

  return (
    <div ref={card} className="welcome-art" data-variant={variant} aria-hidden="true" onPointerMove={follow} onPointerLeave={settle}>
      <span className="welcome-art-tag">{from}</span>
      <svg viewBox="0 0 480 300" preserveAspectRatio="xMidYMid meet" focusable="false">
        <g className="welcome-art-out">
          {OUTGOING.map((height, index) => (
            <rect key={index} className={missing && index >= SEAM ? 'spent' : undefined} style={at(index)} x={LEFT + index * STEP} y={78 - height / 2} width="5" height={height} rx="2.5" opacity={missing ? (index < SEAM ? 1 : 0.16) : level(index, false)} />
          ))}
        </g>
        {missing ? (
          // nothing is up next: an empty lane, drawn as the line a song would have sat on
          <path className="welcome-art-empty" d="M12 222 H468" />
        ) : (
          <g className="welcome-art-in">
            {INCOMING.map((height, index) => <rect key={index} style={at(index)} x={LEFT + index * STEP} y={222 - height / 2} width="5" height={height} rx="2.5" opacity={level(index, true)} />)}
          </g>
        )}
        <path className="welcome-art-curve" d={missing ? 'M12 132 H162 C200 132 220 144 240 150' : 'M12 132 H162 C230 132 250 168 318 168 H468'} />
        {!missing && <path className="welcome-art-curve rising" d="M12 168 H162 C230 168 250 132 318 132 H468" />}
        <circle className="welcome-art-ring" cx="240" cy="150" r="5" />
        <line className="welcome-art-head" x1="240" y1="20" x2="240" y2="280" />
        <circle className="welcome-art-seam" cx="240" cy="150" r="5" />
      </svg>
      <span className="welcome-art-tag next">{to}</span>
    </div>
  );
}
