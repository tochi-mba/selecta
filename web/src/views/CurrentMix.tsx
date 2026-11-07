import { length, runningTime } from '../lib';
import { PageLink } from '../shell/PageLink';
import { mixReadiness } from '../state/readiness';
import { Action, Status } from '../ui/controls';
import { ViewProps } from './shared';

/** The one mix that's really yours to hear right now. Its transitions being ready is a different thing
 * from its songs being saved, so it says which. */
export function CurrentMix({ mix, mixName, now, player, setView, prominent }: Pick<ViewProps, 'mix' | 'mixName' | 'now' | 'player' | 'setView'> & { prominent?: boolean }) {
  const facts = mixReadiness(mix);
  return (
    <section className={`carry-on ${prominent ? 'prominent' : ''}`} aria-label="Current mix">
      <div className="carry-on-words">
        <p className="eyebrow">{now.phase === 'idle' ? 'Current mix' : now.phase === 'paused' ? 'Paused' : 'Playing now'}</p>
        <h2>{mixName}</h2>
        <p className="soft">{mix.length} {mix.length === 1 ? 'song' : 'songs'}{prominent && mix.length ? `, about ${length(runningTime(mix))}` : ''}</p>
        {prominent && facts.seams > 0 && (
          <p>
            <Status kind={facts.failed ? 'warning' : facts.allReady ? 'ready' : facts.rendering ? 'working' : 'planned'}>
              {facts.allReady ? 'Every transition is ready' : `${facts.ready} of ${facts.seams} transitions ready${facts.failed ? `, ${facts.failed} couldn’t be made` : ''}`}
            </Status>
          </p>
        )}
      </div>
      <div className="row wrap">
        {now.phase === 'idle' ? (
          <Action className={prominent ? 'primary' : undefined} run={async () => {
            setView('Now');
            await player.togglePause();
          }}>
            Play
          </Action>
        ) : (
          <button className={prominent ? 'primary' : undefined} onClick={() => setView('Now')}>Open</button>
        )}
        <button onClick={() => setView('Edit')}>Edit</button>
      </div>
    </section>
  );
}

/** Nothing is current yet, which isn't a problem, and here's what to do about it. */
export function NoCurrentMix() {
  return (
    <section className="carry-on prominent" aria-label="Current mix">
      <div className="carry-on-words">
        <p className="eyebrow">Current mix</p>
        <h2>Nothing’s playing yet</h2>
        <p className="soft">Pick a mix to hear it, or play one of your drafts.</p>
      </div>
      <PageLink to="/mixes" className="button primary">Find a mix</PageLink>
    </section>
  );
}
