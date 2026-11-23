import { BrandMark } from '../ui/BrandMark';
import { Icon, IconName } from '../ui/Icon';
import { GateActions, GateButton, GateFoot } from './Gate';

// The first page a signed-out visitor sees: what SelectaDJ does, the two ways in, three plain
// benefits and a drawing of one song blending into the next. Nothing here is a screenshot, a
// price or a quote; every sentence is something the product does. Styles: styles/boot.css (.welcome).

const BENEFITS: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'music', title: 'Your own music', detail: 'Mixes are made from the songs on your devices. Your files stay where they are.' },
  { icon: 'thread', title: 'Seamless from start to finish', detail: 'SelectaDJ plans the order and every blend, then plays the whole set for you.' },
  { icon: 'request', title: 'Requests from the room', detail: 'Open a room and share its QR code. Guests ask for songs from their own phones.' },
];

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
const OUTGOING = lane(BARS, 0.4);
const INCOMING = lane(BARS, 2.1);
/** How loud a lane is drawn at a bar: full before the blend, quiet after it (or the reverse). */
function level(index: number, rising: boolean): number {
  const through = Math.min(1, Math.max(0, (index - 15) / 16));
  const share = rising ? through : 1 - through;
  return Number((0.28 + share * 0.72).toFixed(2));
}

/** Two songs, one fading out as the next fades in. Decoration only. */
function BlendArt() {
  return (
    <div className="welcome-art" aria-hidden="true">
      <span className="welcome-art-tag">Now playing</span>
      <svg viewBox="0 0 480 300" preserveAspectRatio="xMidYMid meet" focusable="false">
        <g className="welcome-art-out">
          {OUTGOING.map((height, index) => <rect key={index} x={LEFT + index * STEP} y={78 - height / 2} width="5" height={height} rx="2.5" opacity={level(index, false)} />)}
        </g>
        <g className="welcome-art-in">
          {INCOMING.map((height, index) => <rect key={index} x={LEFT + index * STEP} y={222 - height / 2} width="5" height={height} rx="2.5" opacity={level(index, true)} />)}
        </g>
        <path className="welcome-art-curve" d="M12 132 H162 C230 132 250 168 318 168 H468" />
        <path className="welcome-art-curve rising" d="M12 168 H162 C230 168 250 132 318 132 H468" />
        <circle className="welcome-art-seam" cx="240" cy="150" r="5" />
      </svg>
      <span className="welcome-art-tag next">Up next</span>
    </div>
  );
}

export function Welcome({ problem, onSignIn, onSignUp }: { problem: string | null; onSignIn: () => unknown; onSignUp: () => unknown }) {
  return (
    <main className="welcome">
      <header className="welcome-top">
        <p className="gate-brand"><BrandMark className="small" /><span>SelectaDJ</span></p>
      </header>
      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="welcome-words">
          <h1 id="welcome-title">Your music, mixed seamlessly.</h1>
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
        {BENEFITS.map((benefit) => (
          <li key={benefit.title}>
            <span className="welcome-benefit-icon"><Icon name={benefit.icon} /></span>
            <h2>{benefit.title}</h2>
            <p>{benefit.detail}</p>
          </li>
        ))}
      </ul>
      <GateFoot />
    </main>
  );
}
