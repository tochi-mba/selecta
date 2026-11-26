import { ReactNode, useId } from 'react';
import { flagOn } from '../flags';
import { PageLink } from '../shell/PageLink';
import { countOf } from '../ui/format';
import { Icon } from '../ui/Icon';
import { BlendArt } from './BlendArt';
import './cloudMusic.css';

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

function StepsToAMix({ at, first }: { at: Step; first?: string }) {
  const here = STEPS.findIndex((step) => step.id === at);
  return (
    <ol className="setup-steps" aria-label="Steps to a playing mix">
      {STEPS.map((step, index) => (
        <li key={step.id} className={index < here ? 'done' : undefined} aria-current={index === here ? 'step' : undefined}>
          {index < here && <span className="setup-step-mark"><Icon name="check" size="compact" /></span>}
          <span className="setup-step-label">{step.id === 'connect' && first ? first : step.label}</span>
          {index < here && <span className="visually-hidden"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}

/** Why a library with songs in it cannot play here yet, in one honest line. */
const chooseAgain = (connected: number) => `This browser lets go of your music when the page closes, so choose your ${countOf(connected, 'song')} again. Nothing is lost.`;

/** One guided empty page: what the page is for, why it is empty in one line, the one action
 * that fills it, and where that sits in the three steps. */
function MusicEmpty({ page, title, lead, at, heading, children, actions, current, first }: {
  page: string; title: string; lead: string; at: Step; heading: string; children: string; actions: ReactNode; current?: ReactNode;
  /** the first step's name when it is not Connect music (Upload music, cloud only) */
  first?: string;
}) {
  const id = useId();
  return (
    <main className={`page ${page}`} id="main">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="display small">{title}</h1>
          <p className="page-lead">{lead}</p>
        </div>
      </header>
      {current}
      <section className="empty-state boxed music-empty" aria-labelledby={id} data-glow="" data-arrive="">
        <span className="empty-state-icon" aria-hidden="true"><Icon name="music" /></span>
        <h2 id={id}>{heading}</h2>
        <p>{children}</p>
        <div className="empty-state-actions">{actions}</div>
        <StepsToAMix at={at} first={first} />
      </section>
    </main>
  );
}

/** `connected` is how many songs are in the catalogue; ideas need songs this browser can open.
 * `current` is the current mix's card, when there is one: it stays in view even while too few
 * songs can play here to make a new mix. */
/** cloud.one_shell, cloud only: songs come from uploading, never from a folder on this device. */
export type CloudOnlyEmpty = { upload: string | null };

/** Uploading as the way to fill an empty page, for an account with no music on its devices. */
function CloudOnlyMusicEmpty({ shared, cloudOnly, connected, starting }: {
  shared: { page: string; title: string; lead: string; current?: ReactNode };
  cloudOnly: CloudOnlyEmpty; connected: number; starting: string;
}) {
  const upload = cloudOnly.upload;
  return (
    <MusicEmpty {...shared} at="connect" first="Upload music" heading={connected === 0 ? `Upload songs to ${starting}` : `Upload more songs to ${starting}`}
      actions={upload ? <PageLink to={upload} className="button primary big">Upload music</PageLink> : <PageLink to="/library" className="button primary big">See your library</PageLink>}>
      {connected === 0 ? 'Songs you upload are kept in your cloud library and play on all your devices.' : 'A mix needs at least two songs in your cloud library.'}
    </MusicEmpty>
  );
}

export function MixesEmpty({ connected, checking, current, onSetUp, cloudOnly }: {
  connected: number; checking?: { checked: number; total: number | null }; current?: ReactNode;
  /** given while getting started is unfinished (Finish later): opens it again where it was left */
  onSetUp?: () => void;
  /** cloud.one_shell: no music on this account's devices, so the way forward is uploading */
  cloudOnly?: CloudOnlyEmpty;
}) {
  const shared = { page: 'mixes', title: 'Make a Mix', lead: 'Choose a length and press Play. SelectaDJ lines up your songs and blends each one into the next.', at: 'connect' as const, current };
  if (cloudOnly) return <CloudOnlyMusicEmpty shared={shared} cloudOnly={cloudOnly} connected={connected} starting="make a mix" />;
  const setUp = onSetUp && <button type="button" className="quiet" onClick={onSetUp}>Finish setting up</button>;
  if (checking) {
    return (
      <MusicEmpty {...shared} heading="Checking your music" actions={<><PageLink to="/library" className="button">See your library</PageLink>{setUp}</>}>
        {`${checking.checked} of ${checking.total ?? 'your'} songs checked. You can make a mix as soon as two can play here.`}
      </MusicEmpty>
    );
  }
  return (
    <MusicEmpty {...shared} heading={connected === 0 ? 'Connect your music to make a mix' : 'Choose your music again to make a mix'}
      actions={<><PageLink to="/library" className="button primary big">Connect music</PageLink>{setUp}</>}>
      {connected === 0 ? 'Pick the songs on this device and SelectaDJ turns them into a mix. Your files stay where they are.' : chooseAgain(connected)}
    </MusicEmpty>
  );
}

/** `playable` is how many songs this browser can open now; `saved` how many mixes the account
 * holds (null before the server has said). */
export function ListenEmpty({ connected, playable = connected, saved = null, cloudOnly }: { connected: number; playable?: number; saved?: number | null; cloudOnly?: CloudOnlyEmpty }) {
  const canMix = playable >= 2;
  const shared = { page: 'listen-idle', title: 'Listen', lead: 'What’s playing, what’s next and each transition as it happens.' };
  const mine = !!saved && <PageLink to="/mixes/mine" className="button big">My Mixes</PageLink>;
  // cloud.one_shell: no music on this account's devices, so the way forward is uploading
  if (!canMix && cloudOnly) return <CloudOnlyMusicEmpty shared={shared} cloudOnly={cloudOnly} connected={connected} starting="start listening" />;
  if (!canMix) {
    return (
      <MusicEmpty {...shared} at="connect" heading={connected === 0 ? 'Connect your music to start listening' : 'Choose your music again to listen'}
        actions={<><PageLink to="/library" className="button primary big">Connect music</PageLink>{connected > 0 && mine}</>}>
        {connected === 0 ? 'Pick the songs on this device, make a mix, and it plays here. Your files stay where they are.' : chooseAgain(connected)}
      </MusicEmpty>
    );
  }
  return (
    <MusicEmpty {...shared} at="mix" heading="Nothing is playing yet"
      actions={<><PageLink to="/mixes" className="button primary big">Make a Mix</PageLink>{mine}</>}>
      {saved ? `Make a new mix, or play one of your ${countOf(saved, 'saved mix', 'saved mixes')}.` : 'Make a mix from your songs and it plays here.'}
    </MusicEmpty>
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

/** The frame of a page that is not there: what happened and the ways back, beside the drawing of a
 * song with nothing after it (BlendArt). The address asked for is shown when it is the problem. */
function Lost({ eyebrow, title, path, actions, children }: { eyebrow: string; title: string; path?: string; actions: ReactNode; children: ReactNode }) {
  return (
    <main className="page lost-page" id="main">
      <div className="lost-words" data-arrive="">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="display small">{title}</h1>
        {children}
        {path && <p className="lost-path"><span className="visually-hidden">The address asked for: </span>{path}</p>}
        <div className="row wrap">{actions}</div>
      </div>
      <BlendArt variant="missing" />
    </main>
  );
}

/** A More address this account does not have (a flag off, or uploads without the hosted grant). */
export function NotOnThisAccount() {
  return (
    <Lost eyebrow="Not on this account" title="That page isn’t part of your account" actions={<PageLink to="/library" className="button primary">Go to Library</PageLink>}>
      <p className="lede">Your music and mixes are fine.</p>
    </Lost>
  );
}

/** A local-only address opened in Cloud: say so and offer the nearest place (ADR-0462). */
export function OnlyOnYourComputer({ title, nearest }: { title: string; nearest: { label: string; path: string } }) {
  return (
    <Lost eyebrow="On your computer" title={`${title} is part of SelectaDJ on your computer`} actions={<PageLink to={nearest.path} className="button primary">Go to {nearest.label}</PageLink>}>
      <p className="lede">This page needs the SelectaDJ app running on your own computer, so it isn’t in your browser. Your music and mixes are fine.</p>
    </Lost>
  );
}

/** An address that is no page at all (a mistyped or stale link): say so, and offer the way back. */
export function PageNotFound() {
  return (
    <Lost
      eyebrow="Error 404"
      title="We can’t find that page"
      path={window.location.pathname}
      actions={<><PageLink to="/mixes" className="button primary">Go to Make a Mix</PageLink><PageLink to="/library" className="button">Library</PageLink></>}
    >
      <p className="lede">The link may be old or mistyped. Your music and mixes are fine.</p>
    </Lost>
  );
}
