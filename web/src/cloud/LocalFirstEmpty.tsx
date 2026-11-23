import { ReactNode, useId } from 'react';
import { flagOn } from '../flags';
import { PageLink } from '../shell/PageLink';
import { countOf } from '../ui/format';
import { Icon } from '../ui/Icon';

/** Designed empty and failure states for the local-first shell (ADR-0463 BF-0463-04).
 *
 * Every destination with nothing in it says what it will hold and points at the one thing that
 * fills it (Connect Music), never a blank table. A device that cannot play keeps a useful product:
 * the reason is shown and every way forward is a working link, never a loop back to a check it
 * cannot pass.
 */

/** The one shape of an empty place, shared by the local-first and hosted surfaces: a heading that
 * says what the place will hold, a line on how it fills, and the action that fills it. */
export function EmptyState({ title, children, actions, className = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={`empty-state ${className}`.trim()} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {typeof children === 'string' ? <p>{children}</p> : children}
      {actions && <div className="row wrap">{actions}</div>}
    </section>
  );
}

export function LibraryEmpty() {
  return (
    <section className="empty-state" aria-labelledby="library-empty-title">
      <h2 id="library-empty-title">Your library is empty</h2>
      <p>Connect music from this device to begin. Your files stay where they are: SelectaDJ only keeps each song’s title, artist and a fingerprint.</p>
      <a className="button primary" href="#connect-music-title">Connect music</a>
    </section>
  );
}

/** The three steps from nothing to a playing mix in a browser, with the one the member is on
 * marked. Drawn like local mode's getting-started steps (`.setup-steps`). */
type Step = 'connect' | 'mix' | 'listen';
const STEPS: { id: Step; label: string }[] = [
  { id: 'connect', label: 'Connect music' },
  { id: 'mix', label: 'Make a mix' },
  { id: 'listen', label: 'Listen' },
];

function StepsToAMix({ at }: { at: Step }) {
  const here = STEPS.findIndex((step) => step.id === at);
  return (
    <ol className="setup-steps" aria-label="Steps to a playing mix">
      {STEPS.map((step, index) => (
        <li key={step.id} className={index < here ? 'done' : undefined} aria-current={index === here ? 'step' : undefined}>
          {index < here && <span className="setup-step-mark"><Icon name="check" size="compact" /></span>}
          <span className="setup-step-label">{step.label}</span>
          {index < here && <span className="visually-hidden"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}

/** Why a library with songs in it cannot play here yet, in one honest sentence. */
const chooseAgain = (connected: number) => `Your library lists ${countOf(connected, 'song')}, but this browser can open fewer than two of them right now. A browser only keeps the songs you pick while the page is open, so choose your folder or songs again. Nothing has been lost.`;

/** `connected` is how many songs are in the catalogue; ideas need songs this browser can open.
 * `current` is the current mix's card, when there is one: it stays in view even while too few
 * songs can play here to make a new mix. */
export function MixesEmpty({ connected, checking, current }: { connected: number; checking?: { checked: number; total: number | null }; current?: ReactNode }) {
  return (
    <main className="page mixes" id="main">
      <h1 className="display small">Make a Mix</h1>
      {current}
      <section className="empty-state" aria-labelledby="mixes-empty-title">
        <StepsToAMix at="connect" />
        {checking ? (
          <>
            <h2 id="mixes-empty-title">Still checking your music</h2>
            <p>{`${checking.checked} of ${checking.total ?? 'your'} songs checked so far. Mixes open as soon as two songs can play here; you can keep using SelectaDJ while it finishes.`}</p>
            <div className="row wrap"><PageLink to="/library" className="button">See your library</PageLink></div>
          </>
        ) : connected === 0 ? (
          <>
            <h2 id="mixes-empty-title">Mixes start with your music</h2>
            <p>Connect the songs on this device and SelectaDJ shapes them into a mix, working out each transition as it plays. Your files stay where they are.</p>
            <div className="row wrap"><PageLink to="/library" className="button primary">Connect music</PageLink></div>
          </>
        ) : (
          <>
            <h2 id="mixes-empty-title">Choose your music again to make a mix</h2>
            <p>{chooseAgain(connected)}</p>
            <div className="row wrap"><PageLink to="/library" className="button primary">Connect music</PageLink></div>
          </>
        )}
      </section>
    </main>
  );
}

/** `playable` is how many songs this browser can open now; `saved` how many mixes the account
 * holds (null before the server has said). */
export function ListenEmpty({ connected, playable = connected, saved = null }: { connected: number; playable?: number; saved?: number | null }) {
  const canMix = playable >= 2;
  return (
    <main className="page" id="main">
      <h1 className="display small">Listen</h1>
      <section className="empty-state" aria-labelledby="listen-empty-title">
        <StepsToAMix at={canMix ? 'mix' : 'connect'} />
        {connected === 0 ? (
          <>
            <h2 id="listen-empty-title">Nothing is playing yet</h2>
            <p>Connect the songs on this device first. Then make a mix, and it plays here with what’s next and each transition as it happens.</p>
            <div className="row wrap"><PageLink to="/library" className="button primary">Connect music</PageLink></div>
          </>
        ) : !canMix ? (
          <>
            <h2 id="listen-empty-title">Choose your music again to listen</h2>
            <p>{chooseAgain(connected)}</p>
            <div className="row wrap">
              <PageLink to="/library" className="button primary">Connect music</PageLink>
              {!!saved && <PageLink to="/mixes/mine" className="button">My Mixes</PageLink>}
            </div>
          </>
        ) : (
          <>
            <h2 id="listen-empty-title">Nothing is playing yet</h2>
            <p>{saved
              ? `Make a new mix, or play one of your ${countOf(saved, 'saved mix', 'saved mixes')}. It plays here with what’s next and each transition as it happens.`
              : 'Make a mix from your songs and it plays here, with what’s next and each transition as it happens.'}</p>
            <div className="row wrap">
              <PageLink to="/mixes" className="button primary">Make a Mix</PageLink>
              {!!saved && <PageLink to="/mixes/mine" className="button">My Mixes</PageLink>}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

/** The capability-failed fork (ADR-0460): why this device cannot play, and what still works. */
export function CannotPlayHere({ reason }: { reason: string }) {
  return (
    <section className="panel stack" role="note" aria-labelledby="cannot-play-title">
      <h2 id="cannot-play-title">This device can’t play mixes</h2>
      <p>{reason}</p>
      <p>Everything else still works here: browse your library, build mixes, and control playback on another device. A recent desktop browser or a tablet with an up-to-date browser can be the speaker.</p>
      <div className="row wrap">
        <PageLink to="/library" className="button">Library</PageLink>
        <PageLink to="/mixes" className="button">Make a Mix</PageLink>
        {flagOn('devices') && <PageLink to="/account/devices" className="button primary">Choose a device to play</PageLink>}
      </div>
    </section>
  );
}

/** A More address this account does not have (a flag off, or uploads without the hosted grant). */
export function NotOnThisAccount() {
  return (
    <main className="page" id="main">
      <h1 className="display small">That page isn’t part of your account</h1>
      <p className="lede">Your music and mixes are fine.</p>
      <PageLink to="/library" className="button primary">Go to Library</PageLink>
    </main>
  );
}

/** A local-only address opened in Cloud: say so and offer the nearest place (ADR-0462). */
export function OnlyOnYourComputer({ title, nearest }: { title: string; nearest: { label: string; path: string } }) {
  return (
    <main className="page" id="main">
      <h1 className="display small">{title} is part of SelectaDJ on your computer</h1>
      <p className="lede">This page needs the SelectaDJ app running on your own computer, so it isn’t in your browser. Your music and mixes are fine.</p>
      <PageLink to={nearest.path} className="button primary">Go to {nearest.label}</PageLink>
    </main>
  );
}

/** An address that is no page at all (a mistyped or stale link): say so, and offer the way back. */
export function PageNotFound() {
  return (
    <main className="page" id="main">
      <h1 className="display small">We can’t find that page</h1>
      <p className="lede">The link may be old or mistyped. Your music and mixes are fine.</p>
      <div className="row wrap">
        <PageLink to="/mixes" className="button primary">Go to Make a Mix</PageLink>
        <PageLink to="/library" className="button">Library</PageLink>
      </div>
    </main>
  );
}
