import { useRef } from 'react';
import { useFlag } from '../flags';
import { length, runningTime } from '../lib';
import { navigate } from '../router';
import { sceneTransitionsSupported, sceneTransitionsWanted } from '../shell/sceneTransition';
import { MixSignature } from '../ui/MusicObjects';
import { PageLink } from '../shell/PageLink';
import { mixReadiness } from '../state/readiness';
import { Action, Status } from '../ui/controls';
import { ViewProps } from './shared';
import { PlayingBars } from './feelBits';
import { MixArt } from './MixArt';
import { useFeelOn } from './feelPieces';

/** The one mix that's really yours to hear right now. Its transitions being ready is a different thing
 * from its songs being saved, so it says which. */
export function CurrentMix({ mix, mixName, now, player, setView, prominent, lead, analysisAvailable = true }: Pick<ViewProps, 'mix' | 'mixName' | 'now' | 'player' | 'setView' | 'analysisAvailable'> & {
  prominent?: boolean;
  /** whether Play/Open is the page's one primary action (SF-0204-02); on My Mixes the drafts usually lead */
  lead?: boolean;
}) {
  const facts = mixReadiness(mix);
  const editing = useFlag('editor');
  // ADR-0477: the card wears the mix's own face while the feel is on (nothing is added with it off),
  // and Play or Open carries that face into Listen's cover when page transitions run
  const feel = useFeelOn();
  const tile = useRef<HTMLSpanElement>(null);
  const toListen = () => {
    const face = tile.current;
    if (face && sceneTransitionsSupported() && sceneTransitionsWanted()) navigate('/listen', { share: [[face, 'player-art']] });
    else setView('Now');
  };
  return (
    <section className={`carry-on ${prominent ? 'prominent' : ''}`} aria-label="Current mix">
      {feel && <MixArt seed={mixName} songs={mix} travels tileRef={tile} />}
      <div className="carry-on-words">
        <p className="eyebrow">
          {now.phase === 'idle' ? 'Current mix' : now.phase === 'paused' ? 'Paused' : 'Playing now'}
          {/* ADR-0477: this is the mix playing, so its bars answer the measured music (hidden with the feel off) */}
          {now.phase === 'playing' && <PlayingBars />}
        </p>
        <h2>{mixName}</h2>
        <div className="mix-identity">
          <MixSignature items={mix} />
          {prominent && <small className="soft">A picture of the song order, not the sound</small>}
        </div>
        <p className="soft">{mix.length} {mix.length === 1 ? 'song' : 'songs'}{prominent && mix.length ? `, about ${length(runningTime(mix))}` : ''}</p>
        {prominent && facts.seams > 0 && (
          <p>
            {analysisAvailable ? (
              <Status kind={facts.failed ? 'warning' : facts.allReady ? 'ready' : facts.rendering ? 'working' : 'planned'}>
                {facts.allReady ? 'Every transition is ready' : `${facts.ready} of ${facts.seams} transitions ready${facts.failed ? `, ${facts.failed} couldn’t be made` : ''}`}
              </Status>
            ) : (
              // nothing renders ahead in a browser mix, so a 0-of-N counter would read as failure
              <Status kind="planned">Transitions are worked out as the mix plays</Status>
            )}
          </p>
        )}
      </div>
      <div className="row wrap">
        {now.phase === 'idle' ? (
          <Action className={lead ? 'primary' : undefined} run={async () => {
            // the page change only starts its animation; the music starts straight after
            toListen();
            await player.togglePause();
          }}>
            Play
          </Action>
        ) : (
          <button className={lead ? 'primary' : undefined} onClick={toListen}>Open</button>
        )}
        {editing && <button onClick={() => setView('Edit')}>Edit</button>}
      </div>
    </section>
  );
}

/** Nothing is current yet, which isn't a problem, and here's what to do about it. */
export function NoCurrentMix({ lead = true }: { lead?: boolean }) {
  const drafts = useFlag('drafts');
  return (
    <section className="carry-on prominent" aria-label="Current mix">
      <div className="carry-on-words">
        <p className="eyebrow">Current mix</p>
        <h2>Nothing’s playing yet</h2>
        <p className="soft">{drafts ? 'Pick a mix to hear it, or play one of your drafts.' : 'Pick a mix to hear it.'}</p>
      </div>
      <PageLink to="/mixes" className={lead ? 'button primary' : 'button'}>Find a mix</PageLink>
    </section>
  );
}
