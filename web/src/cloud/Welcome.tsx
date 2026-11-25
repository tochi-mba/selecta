import { CSSProperties, RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { feelOn, onFeelChange } from '../feel/root';
import { BrandMark } from '../ui/BrandMark';
import { Icon, IconName } from '../ui/Icon';
import { BlendArt } from './BlendArt';
import { GateActions, GateButton, GateFoot } from './Gate';

// The first page a signed-out visitor sees: what SelectaDJ does, the two ways in, three plain
// benefits, the three steps from a folder of songs to a playing set, and a drawing of one song
// blending into the next. Nothing here is a screenshot, a price or a quote; every sentence is
// something the product does. Styles: styles/boot.css (.welcome), and with the feel system on,
// styles/feel-entry.css.

const BENEFITS: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'music', title: 'Your own music', detail: 'Mixes are made from the songs on your devices. Your files stay where they are.' },
  { icon: 'thread', title: 'Seamless from start to finish', detail: 'SelectaDJ plans the order and every blend, then plays the whole set for you.' },
  { icon: 'request', title: 'Requests from the room', detail: 'Open a room and share its QR code. Guests ask for songs from their own phones.' },
];

/** The same three steps the app itself shows once you are in (Connect music, Make a mix, Listen). */
const STEPS: { title: string; detail: string }[] = [
  { title: 'Connect your music', detail: 'Choose the folder your songs live in. They are read on your device and stay there.' },
  { title: 'Make a mix', detail: 'Choose a length and press Play. SelectaDJ lines up your songs and blends each one into the next.' },
  { title: 'Listen', detail: 'See what is playing, what is next and each transition as it happens.' },
];

/** The headline, a word at a time, so each word can arrive after the one before it. The last word
 * is lit the way the sung word is on Listen. A screen reader hears one ordinary sentence. */
const HEADLINE = ['Your', 'music,', 'mixed', 'seamlessly.'];
const order = (index: number) => ({ '--i': index }) as CSSProperties;

/** Whether the feel system's motion is on, kept current as the flag or the motion choice change. */
function useFeelMotion(): boolean {
  return useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
}

/** On a phone, once the hero's two buttons have scrolled out of view, the same two buttons wait in
 * a bar at the foot of the screen, so the way in is never more than a thumb away. It only exists
 * while the hero's buttons cannot be seen, so there are never two visible sets at once. */
function useHeroButtonsGone(words: RefObject<HTMLDivElement | null>, wanted: boolean): boolean {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const buttons = words.current?.querySelector('.gate-actions');
    if (!wanted || !buttons || typeof IntersectionObserver === 'undefined') {
      setGone(false);
      return;
    }
    // only a scroll past the buttons counts: before the page has been scrolled to them they are
    // below the fold on no phone, so "not intersecting and above the screen" is the one signal
    const watcher = new IntersectionObserver(([entry]) => {
      if (entry) setGone(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
    });
    watcher.observe(buttons);
    return () => watcher.disconnect();
  }, [words, wanted]);
  return gone;
}

export function Welcome({ problem, onSignIn, onSignUp }: { problem: string | null; onSignIn: () => unknown; onSignUp: () => unknown }) {
  const moving = useFeelMotion();
  const words = useRef<HTMLDivElement>(null);
  const docked = useHeroButtonsGone(words, moving);
  return (
    <main className="welcome">
      <header className="welcome-top">
        <p className="gate-brand" data-vt="brand-mark"><BrandMark className="small" /><span>SelectaDJ</span></p>
      </header>
      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="welcome-words" ref={words}>
          <h1 id="welcome-title">
            {HEADLINE.map((word, index) => (
              <span key={word}><span className={index === HEADLINE.length - 1 ? 'welcome-word lit' : 'welcome-word'} style={order(index)}>{word}</span>{index < HEADLINE.length - 1 && ' '}</span>
            ))}
          </h1>
          <p className="welcome-lead">SelectaDJ plans and plays seamless DJ mixes from the music on your own devices. Guests can request songs from a room by QR code.</p>
          {problem && <p className="gate-problem" role="alert"><Icon name="warning" size="compact" />{problem}</p>}
          <GateActions>
            <GateButton kind="primary" working="Opening sign-in…" hold run={onSignIn}>Sign in</GateButton>
            <GateButton working="Opening sign-up…" hold run={onSignUp}>Create account</GateButton>
          </GateActions>
        </div>
        <BlendArt />
      </section>
      <ul className="welcome-benefits" aria-label="What SelectaDJ does">
        {BENEFITS.map((benefit, index) => (
          <li key={benefit.title} style={order(index)} data-lift="" data-glow="">
            <span className="welcome-benefit-icon"><Icon name={benefit.icon} /></span>
            <h2>{benefit.title}</h2>
            <p>{benefit.detail}</p>
          </li>
        ))}
      </ul>
      <section className="welcome-steps" aria-labelledby="welcome-steps-title">
        <h2 id="welcome-steps-title">From a folder of songs to a full set</h2>
        <ol data-stagger="">
          {STEPS.map((step, index) => (
            <li key={step.title} style={order(index)}>
              <span className="welcome-step-number" aria-hidden="true">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>
      <GateFoot />
      {moving && docked && (
        <div className="welcome-dock" data-arrive="">
          <GateActions>
            <GateButton kind="primary" working="Opening sign-in…" hold run={onSignIn}>Sign in</GateButton>
            <GateButton working="Opening sign-up…" hold run={onSignUp}>Create account</GateButton>
          </GateActions>
        </div>
      )}
    </main>
  );
}
