import type { ReactNode } from 'react';
import type { VibeCard } from '../api';
import { SET_LENGTHS } from '../lib';
import { PageLink } from '../shell/PageLink';
import { Action } from '../ui/controls';
import { countOf } from '../ui/format';
import { Icon } from '../ui/Icon';
import './cloudMusic.css';

/** Make a Mix in a browser, as three short steps and one Play: the music this device can open,
 * how long, an optional shape. Views/Mixes.tsx owns the building; this only draws the choices. */
export function QuickMix({ hero, pending, playable, total, songs, onSongs, building, blocked, onPlay, shape, replacing, problem, playOn }: {
  /** SelectaDJ's pick; undefined while it loads or when it could not be read. */
  hero?: VibeCard;
  pending: boolean;
  /** Songs this device can open now, of how many the library lists. */
  playable: number;
  total: number;
  songs: number;
  onSongs: (songs: number) => void;
  building: boolean;
  blocked: boolean;
  onPlay: () => Promise<unknown> | unknown;
  /** The optional shaping step: what is set now, and how to change it. */
  shape?: { summary: string; open: () => void };
  /** What pressing Play does to the mix that is playing, when there is one. */
  replacing?: string;
  problem?: ReactNode;
  /** ADR-0475 R8: the mix plays on another device (see ViewProps.playOn). */
  playOn?: { name: string; now: boolean };
}) {
  // the songs counted are the ones the device that plays the mix holds
  const where = playOn?.now ? playOn.name : 'this device';
  const available = hero?.songs ?? playable;
  const short = available < songs;
  return (
    <section className="quick-mix" aria-labelledby="quick-mix-title">
      <h2 id="quick-mix-title" className="visually-hidden">Make a new mix</h2>
      <ol className="quick-steps">
        <li className="quick-step" data-done="true">
          <span className="quick-step-mark" aria-hidden="true"><Icon name="check" size="compact" /></span>
          <div className="quick-step-body">
            <h3>Your music</h3>
            <p>{playable < total ? `${playable} of ${countOf(total, 'song')} can play on ${where}.` : `${countOf(playable, 'song')} ready on ${where}.`}</p>
          </div>
          <PageLink to="/library" className="button small quiet">{playable < total ? 'Connect more' : 'Library'}</PageLink>
        </li>
        <li className="quick-step">
          <span className="quick-step-mark" aria-hidden="true">2</span>
          <div className="quick-step-body">
            <h3 id="quick-length">How long?</h3>
            <div className="choice-cards" role="group" aria-labelledby="quick-length">
              {SET_LENGTHS.map((option) => (
                <button key={option.songs} type="button" className="choice-card" aria-pressed={songs === option.songs} onClick={() => onSongs(option.songs)}>
                  <span className="choice-card-check" aria-hidden="true"><Icon name="check" size="compact" /></span>
                  <b>About {option.label}</b>
                  <span>Up to {option.songs} songs</span>
                </button>
              ))}
            </div>
            {short && <p className="hint" role="status">{countOf(available, 'song')} can play here, so this mix will be shorter. Connect more music for a longer one.</p>}
          </div>
        </li>
        {shape && (
          <li className="quick-step">
            <span className="quick-step-mark" aria-hidden="true">3</span>
            <div className="quick-step-body">
              <h3>Shape it <span className="badge">Optional</span></h3>
              <p>{shape.summary ? `${shape.summary.replace(/^./, (first) => first.toUpperCase())}.` : 'Set the feel and where the mix ends.'}</p>
            </div>
            <button type="button" className="small" aria-label="Shape this mix (optional)" onClick={shape.open}>Shape this mix</button>
          </li>
        )}
      </ol>
      <footer className="quick-play">
        <div className="quick-play-words">
          {pending ? <p className="skeleton-facts" aria-hidden="true"><i /><i /></p> : (
            <>
              <b>{hero?.name ?? 'SelectaDJ’s pick'}</b>
              <span>
                {hero && hero.songs > 0 ? `${countOf(Math.min(songs, hero.songs), 'song')}. ` : ''}
                {replacing ?? 'Each transition is worked out as it plays.'}
              </span>
            </>
          )}
        </div>
        <Action className="primary big" disabled={!hero?.ready || blocked} busy={building} working="Building…" run={onPlay}>
          <Icon name="play" /> {playOn?.now ? `Play on ${playOn.name}` : 'Play'}
        </Action>
      </footer>
      {hero && !hero.ready && <p className="hint">{hero.name} needs {hero.needs} more {hero.needs === 1 ? 'song' : 'songs'} this device can play.</p>}
      {problem}
    </section>
  );
}
