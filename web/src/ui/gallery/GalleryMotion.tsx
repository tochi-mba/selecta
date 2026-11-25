import { CSSProperties, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { MUSIC_MOTIONS } from '../../feel/beatBus';
import { flip } from '../../feel/flip';
import { success, tap } from '../../feel/haptics';
import { INDICATOR_CLASS, useSlidingIndicator } from '../../feel/indicator';
import { Moment, type MomentKind } from '../../feel/moment';
import { NumberRoll } from '../../feel/numberRoll';
import { feelCalm } from '../../feel/root';
import type { Motion } from '../../state/prefs';
import { Action } from '../controls';
import { lowPowerLevel, nudgeLowPower, useLowPowerLevel } from '../lowPower';
import { GALLERY_MOTION_LEVELS } from './specimens';

/**
 * The feel system's primitives (ADR-0477, FL-0477-06), each shown at Still, Subtle and Expressive
 * side by side. Every column sets data-motion-preview, which tokens.css reads, so the durations and
 * springs inside it are that level's whatever this browser is set to. The parts drawn by script
 * (the Action's tick, the number roll, FLIP, the celebration) follow this browser's real setting,
 * because a script asks feel/root.ts, not the column.
 *
 * Nothing here moves by itself. The beat ring pulses only when "Pretend beat" is pressed: in the app
 * it answers a measured kick, never a timer, so the gallery has no timer either.
 */
export function GalleryMotion() {
  const rings = useRef(new Map<Motion, HTMLElement>());
  const level = useLowPowerLevel();
  const beat = () => {
    if (feelCalm()) return;
    const ring = MUSIC_MOTIONS.ring;
    for (const [motion, element] of rings.current) {
      if (motion === 'still') continue;
      element.animate(ring.keyframes(1, 0.4), { duration: motion === 'subtle' ? ring.maxMs * 0.7 : ring.maxMs, easing: 'ease-out' });
    }
  };
  return (
    <section className="stack gallery-motion"><h3>Motion and feel</h3>
      <p className="hint">The same parts at three levels. Hover, focus and press each one. Low power here now: {level ?? 'off'}{lowPowerLevel() === 'lite' ? ' (lighter effects)' : ''}.</p>
      <div className="row wrap">
        <button type="button" onClick={beat}>Pretend beat</button>
        <button type="button" onClick={() => nudgeLowPower()}>Sample frames now</button>
        <button type="button" onClick={() => tap()}>Tap buzz</button>
        <button type="button" onClick={() => success()}>Success buzz</button>
      </div>
      <div className="gallery-motion-levels">
        {GALLERY_MOTION_LEVELS.map((motion) => (
          <MotionLevel key={motion} motion={motion} ring={(element) => {
            if (element) rings.current.set(motion, element);
            else rings.current.delete(motion);
          }} />
        ))}
      </div>
    </section>
  );
}

const NAMES: Record<Motion, string> = { still: 'Still', subtle: 'Subtle', expressive: 'Expressive' };
const TABS = ['Songs', 'Mixes', 'A longer third tab'];

function MotionLevel({ motion, ring }: { motion: Motion; ring: (element: HTMLElement | null) => void }) {
  const name = NAMES[motion];
  const [count, setCount] = useState(1280);
  const [arrival, setArrival] = useState(0);
  const [tick, setTick] = useState(0);
  const [order, setOrder] = useState(['A', 'B', 'C', 'D']);
  const [moment, setMoment] = useState<{ kind: MomentKind; at: number } | null>(null);
  const [momentWords, setMomentWords] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const shuffle = () => {
    const rows = list.current ? [...list.current.children] : [];
    void flip(rows, () => flushSync(() => setOrder((now) => [...now.slice(1), now[0]])));
  };
  const celebrate = (kind: MomentKind) => {
    setMomentWords('');
    setMoment({ kind, at: performance.now() });
  };
  const celebrated = () => {
    // a refusal calls back at once; a burst that played calls back when it is over
    setMomentWords(moment && performance.now() - moment.at < 50 ? 'Held back: at most one celebration every 8 seconds, and only in Expressive.' : 'Played once.');
    setMoment(null);
  };
  return (
    <div className="gallery-motion-level" data-motion-preview={motion}>
      <h4>{name}</h4>
      <div className="row wrap">
        <button type="button">Press me</button>
        <button type="button" className="primary">Primary</button>
      </div>
      <article className="card" data-lift data-glow><h3>Lifting card</h3><p className="soft">Hover or focus inside to lift it.</p><button type="button">Card action</button></article>
      <IndicatorTabs label={`${name} example tabs`} />
      <p><span className="gallery-motion-figure"><NumberRoll value={count} /></span> plays</p>
      <div className="row wrap">
        <button type="button" onClick={() => setCount((now) => now + 128)}>Add 128</button>
        <button type="button" onClick={() => setCount((now) => Math.max(0, now - 1000))}>Take 1,000</button>
      </div>
      <ol key={arrival} className="stack gallery-motion-arrive">
        {['First row arrives', 'Then the second', 'Then the third'].map((words, index) => <li key={words} style={{ '--i': index } as CSSProperties}>{words}</li>)}
      </ol>
      <button type="button" onClick={() => setArrival((now) => now + 1)}>Replay arrival</button>
      <ol ref={list} className="row wrap gallery-motion-flip" aria-label={`${name} reordering example`}>
        {order.map((item) => <li key={item} className="pill">Song {item}</li>)}
      </ol>
      <button type="button" onClick={shuffle}>Move the first to the end</button>
      <p className="row">
        <svg key={tick} className="action-tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        <button type="button" onClick={() => setTick((now) => now + 1)}>Draw the tick again</button>
      </p>
      <div className="row wrap">
        <Action run={() => new Promise<void>((resolve) => window.setTimeout(resolve, 600))} working="Saving…">Save</Action>
        <Action run={() => new Promise<void>((_, reject) => window.setTimeout(() => reject(new Error('Example: this one always fails.')), 600))} working="Saving…">Fail</Action>
      </div>
      <div className="gallery-motion-stage">
        <span ref={ring} className="gallery-motion-ring" aria-hidden="true" />
        {moment && <Moment key={moment.at} kind={moment.kind} onDone={celebrated} />}
      </div>
      <div className="row wrap">
        <button type="button" onClick={() => celebrate('equalizer')}>Celebrate</button>
        <button type="button" onClick={() => celebrate('blend')}>Celebrate a blend</button>
      </div>
      {momentWords && <p className="hint" role="status">{momentWords}</p>}
    </div>
  );
}

/** A row of choices with the sliding indicator: the mark travels to the chosen one instead of
 * jumping. Plain toggle buttons, so every one is reachable by Tab without a tab pattern's keys. */
function IndicatorTabs({ label }: { label: string }) {
  const [chosen, setChosen] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  useSlidingIndicator(strip, '[aria-pressed="true"]');
  return (
    <div ref={strip} className="gallery-motion-tabs" role="group" aria-label={label}>
      {TABS.map((tab, index) => (
        <button key={tab} type="button" aria-pressed={chosen === index} onClick={() => setChosen(index)}>{tab}</button>
      ))}
      <span className={INDICATOR_CLASS} aria-hidden="true" />
    </div>
  );
}
