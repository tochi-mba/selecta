import { flagOn } from '../flags';
import { PageLink } from '../shell/PageLink';

/** Designed empty and failure states for the local-first shell (ADR-0463 BF-0463-04).
 *
 * Every destination with nothing in it says what it will hold and points at the one thing that
 * fills it (Connect Music), never a blank table. A device that cannot play keeps a useful product:
 * the reason is shown and every way forward is a working link, never a loop back to a check it
 * cannot pass.
 */

export function LibraryEmpty() {
  return (
    <section className="empty-state" aria-labelledby="library-empty-title">
      <h2 id="library-empty-title">Your library is empty</h2>
      <p>Connect music from this device to begin. Your files stay where they are: SelectaDJ only keeps each song’s title, artist and a fingerprint.</p>
      <a className="button primary" href="#connect-music-title">Connect music</a>
    </section>
  );
}

/** `connected` is how many songs are in the catalogue; ideas need songs measured in the browser. */
export function MixesEmpty({ connected }: { connected: number }) {
  return (
    <main className="page" id="main">
      <h1 className="display small">Make a Mix</h1>
      <section className="empty-state" aria-labelledby="mixes-empty-title">
        {connected === 0 ? (
          <>
            <h2 id="mixes-empty-title">Mixes start with your music</h2>
            <p>Connect the songs on this device and SelectaDJ can shape them into a mix.</p>
            <PageLink to="/library" className="button primary">Connect music</PageLink>
          </>
        ) : (
          <>
            <h2 id="mixes-empty-title">Your songs are connected</h2>
            <p>{`${connected} ${connected === 1 ? 'song is' : 'songs are'} in your library. Mix ideas appear once SelectaDJ has measured tempo and key, and measuring in the browser is not available yet. Nothing has been lost; your library is ready for it.`}</p>
            <PageLink to="/library" className="button">See your library</PageLink>
          </>
        )}
      </section>
    </main>
  );
}

export function MyMixesEmpty({ connected }: { connected: number }) {
  return (
    <main className="page" id="main">
      <h1 className="display small">My Mixes</h1>
      <section className="empty-state" aria-labelledby="my-mixes-empty-title">
        <h2 id="my-mixes-empty-title">No mixes yet</h2>
        <p>{connected === 0 ? 'Connect your music, then the mixes you make are kept here.' : 'The mixes you make are kept here, ready to play on any of your devices.'}</p>
        <PageLink to={connected === 0 ? '/library' : '/mixes'} className="button primary">{connected === 0 ? 'Connect music' : 'Make a Mix'}</PageLink>
      </section>
    </main>
  );
}

export function ListenEmpty({ connected }: { connected: number }) {
  return (
    <main className="page" id="main">
      <h1 className="display small">Listen</h1>
      <section className="empty-state" aria-labelledby="listen-empty-title">
        <h2 id="listen-empty-title">Nothing is playing</h2>
        <p>{connected === 0
          ? 'Connect your music first, then make a mix to hear it here.'
          : 'Make a mix from your connected songs to hear it here.'}</p>
        <div className="row wrap">
          <PageLink to={connected === 0 ? '/library' : '/mixes'} className="button primary">{connected === 0 ? 'Connect music' : 'Make a Mix'}</PageLink>
          <PageLink to="/mixes/mine" className="button">My Mixes</PageLink>
        </div>
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
