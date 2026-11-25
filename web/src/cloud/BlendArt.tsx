import { CSSProperties, KeyboardEvent, PointerEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { feelOn, onFeelChange } from '../feel/root';
import { usePrefs } from '../state/prefs';
import { useReducedMotion } from '../ui/useReducedMotion';

// SelectaDJ's one picture: a song handing over to the next. Two lanes of bars, the two volume
// curves crossing, and a playhead moving through the blend. It is the drawing on the landing page
// and, with nothing in the second lane, the drawing on every "nothing here" page. Decoration only:
// the words beside it say everything it shows. Styles: styles/boot.css (.welcome-art), and the
// scrubbing styles/feel-entry.css.
//
// Motion follows the person's choice (state/prefs.ts) and the device's own setting:
//   Still, reduced motion, low power   a still drawing, the playhead resting on the blend
//   Subtle (the default)               the playhead crosses and the blend point answers it
//   Expressive                         each bar also lifts as the playhead passes, and the card
//                                      leans a few degrees toward the pointer
//
// With the feel system's motion on (ADR-0477), the blend drawing is also something to play with:
// the playhead can be dragged, or moved with the arrow keys once the drawing has focus. Its own
// loop pauses while the person drives it and carries on from where they left it. It is a drawing
// the person moves, never a sound or a measurement, and it says so in its name.

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
/** The drawing's width in its own units, and the stretch the playhead travels (blend-head in boot.css). */
const VIEW_WIDTH = 480;
const HEAD_FROM = 12;
const HEAD_SPAN = 460;
/** Where the blend sits on that stretch, so the value can say before, in or after it. */
const BLEND_FROM = 150 / HEAD_SPAN;
const BLEND_TO = 306 / HEAD_SPAN;
/** How long after the last key press the loop takes over again, in ms. */
const KEY_IDLE_MS = 2000;

export type BlendVariant = 'blend' | 'missing';

/** The loop's own animations inside the card (the playhead, the ring, the tags and the bars), not
 * the card's arrival. Empty where the browser has no animation API. */
function loops(card: HTMLElement | null): Animation[] {
  if (!card || typeof card.getAnimations !== 'function') return [];
  return card.getAnimations({ subtree: true }).filter((one) => {
    const name = (one as Animation & { animationName?: string }).animationName;
    return typeof name === 'string' && name.startsWith('blend-');
  });
}

/** How far through its crossing the playhead is now, from 0 to 1. */
function headProgress(card: HTMLElement | null): number | null {
  const head = card?.querySelector('.welcome-art-head');
  const playing = loops(card).find((one) => (one.effect as KeyframeEffect | null)?.target === head);
  const length = Number(playing?.effect?.getComputedTiming().duration);
  const time = Number(playing?.currentTime);
  if (!playing || !Number.isFinite(length) || length <= 0 || !Number.isFinite(time)) return null;
  return (time % length) / length;
}

/** What the slider says its value is, in words. */
function placeWords(share: number): string {
  const percent = Math.round(share * 100);
  const where = share < BLEND_FROM ? 'before the blend' : share > BLEND_TO ? 'after the blend' : 'in the blend';
  return `Playhead at ${percent} percent, ${where}`;
}

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
  const feelMoving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
  // Only the blend can be scrubbed: the missing drawing's playhead skips back by design, and with
  // nothing moving there is no loop to take over (the still drawing stays as it is).
  const scrubs = feelMoving && !still && !missing;
  const [place, setPlace] = useState(0.5);
  const [driving, setDriving] = useState(false);
  const idle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(idle.current), []);

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

  // Taking the playhead: every loop animation stops where it is and is moved to the same moment, so
  // the bars, the ring and the tags stay in step with the line exactly as the loop draws them.
  const hold = (share: number) => {
    const clamped = Math.min(1, Math.max(0, share));
    for (const one of loops(card.current)) {
      const length = Number(one.effect?.getComputedTiming().duration);
      if (!Number.isFinite(length) || length <= 0) continue;
      one.pause();
      one.currentTime = clamped * length;
    }
    setPlace(clamped);
    setDriving(true);
  };
  // Letting go: the loop carries on from where the person left it.
  const release = () => {
    window.clearTimeout(idle.current);
    for (const one of loops(card.current)) one.play();
    setDriving(false);
  };
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const svg = card.current?.querySelector('svg');
    const box = svg?.getBoundingClientRect();
    if (!box || !box.width) return;
    const x = ((event.clientX - box.left) / box.width) * VIEW_WIDTH;
    hold((x - HEAD_FROM) / HEAD_SPAN);
  };
  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.clearTimeout(idle.current);
    fromPointer(event);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) fromPointer(event);
  };
  const letGo = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    release();
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const now = driving ? place : headProgress(card.current) ?? place;
    const steps: Record<string, number> = {
      ArrowLeft: now - 1 / BARS, ArrowDown: now - 1 / BARS,
      ArrowRight: now + 1 / BARS, ArrowUp: now + 1 / BARS,
      PageDown: now - 0.1, PageUp: now + 0.1,
      Home: 0, End: 1,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    hold(steps[event.key]);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(release, KEY_IDLE_MS);
  };

  return (
    <div ref={card} className="welcome-art" data-variant={variant} aria-hidden={scrubs ? undefined : 'true'} data-scrub={scrubs ? (driving ? 'held' : 'free') : undefined} onPointerMove={follow} onPointerLeave={settle}>
      <span className="welcome-art-tag" aria-hidden={scrubs || undefined}>{from}</span>
      <svg viewBox="0 0 480 300" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden={scrubs || undefined}>
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
      <span className="welcome-art-tag next" aria-hidden={scrubs || undefined}>{to}</span>
      {scrubs && (
        // the whole card is the handle, so a drag can start anywhere on the drawing
        <div
          className="welcome-art-scrub"
          role="slider"
          tabIndex={0}
          aria-label="Blend preview"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(place * 100)}
          aria-valuetext={placeWords(place)}
          onPointerDown={grab}
          onPointerMove={drag}
          onPointerUp={letGo}
          onPointerCancel={letGo}
          onKeyDown={key}
          onBlur={() => { if (driving) release(); }}
        />
      )}
    </div>
  );
}
