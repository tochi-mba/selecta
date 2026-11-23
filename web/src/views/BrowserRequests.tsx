import { useState } from 'react';
import { ApiError, type MixData, type MixItem, type Request } from '../api';
import type { PlayerLike } from '../playerContract';
import { navigate } from '../router';
import { Action } from '../ui/controls';
import { JOINS_BY_HAND } from '../cloud/localFirstRequests';
import type { RequestRow, Stage } from './Requests';

// The Requests drawer's list in Cloud in the browser (rows that carry `browser_note`,
// localFirstRequests.ts). There is no planner there, so there is nothing to explain about spots,
// bridges or play times: one short Waiting list, each row saying who asked and offering one
// thing to do, Add next (it plays after the current song), plus Dismiss. With no mix at all the
// one thing is Start a mix with this song: a browser mix that begins with it, playing at once.
// Local mode keeps its own list in Requests.tsx, with the planner's words.

const HELP_IDLE = 'Add to mix puts a song at the end. While a mix plays, Add next plays it after the current song.';
const HELP_NO_MIX = 'No mix is playing yet. Start one with a request and add the others after it.';

/** "Asked by Mia in Friday room" for a room guest's request; nothing for the member's own. */
function whoAsked(request: RequestRow): string {
  if (!request.room_name) return '';
  return `Asked by ${request.asked_by ?? 'a guest'} in ${request.room_name}`;
}

/** Play the new mix from its first song. The first play of a visit opens this device's speaker,
 * and the playback session then starts it wherever the last mix was left; so once it is playing
 * here, ask for the first song again. */
async function beginAtFirst(player: PlayerLike | undefined) {
  if (!player) return;
  const wasHere = ['playing', 'paused'].includes(player.state.phase);
  await player.playFrom(0);
  if (wasHere) return;
  for (let tries = 0; tries < 40; tries += 1) {
    await new Promise((done) => window.setTimeout(done, 250));
    if (player.state.phase === 'playing') { await player.playFrom(0); return; }
  }
}

/** Why a row has no Add button, in a few words; empty when it can be added. */
function held(request: RequestRow, stage: Stage): string {
  if (stage === 'adding') return 'Saving…';
  if (stage === 'unavailable') return 'No longer in your library.';
  if (stage === 'never') return 'Set to never play in your Library.';
  if (stage === 'in_mix') return 'Already in your mix.';
  // the browser family marks a song this device can play as `searching`
  if (request.stage !== 'searching') return request.browser_note ?? '';
  return '';
}

export function BrowserRequests({ rows, live, playback, send, refresh, onAdd, onDismiss }: {
  rows: { request: RequestRow; stage: Stage }[];
  /** a mix is playing or paused, so Add next has a current song to follow */
  live: boolean;
  playback?: { mix: MixItem[]; player: PlayerLike; onMix: (data: MixData) => void };
  /** the adapted request client: builds the mix and settles the request */
  send: Request;
  refresh?: () => Promise<unknown> | void;
  onAdd: (request: RequestRow) => Promise<unknown>;
  onDismiss: (request: RequestRow) => void;
}) {
  const noMix = rows.some((row) => row.stage === 'no_mix');
  const [tooFew, setTooFew] = useState('');
  // No mix yet: make one that begins with the requested song, play it, and the request is done
  // (the same look the playing mix gives every few seconds settles it, and tells the room).
  const startWith = async (request: RequestRow) => {
    setTooFew('');
    try {
      const data = await send<MixData>(`/vibes/pick/build?start=${request.song_id}`, { method: 'POST', headers: { 'x-mix-order': '' } });
      playback?.onMix(data);
      void beginAtFirst(playback?.player);
      await send('/requests/consider', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: data.mix.map((item) => item.song_id), position: 0 }) }).catch(() => undefined);
      await refresh?.();
    } catch (problem) {
      if (problem instanceof ApiError && problem.code === 'not_enough_songs') { setTooFew('A mix needs at least two songs that can play on this device.'); return; }
      throw problem;
    }
  };
  return (
    <ul className="request-list browser-requests" aria-label="Your requests">
      <li className="request-group">
        <h3>Waiting</h3>
        <p>{live ? JOINS_BY_HAND : noMix ? HELP_NO_MIX : HELP_IDLE}</p>
        {tooFew && <p className="warn" role="alert">{tooFew} <a href="/library" onClick={(event) => { event.preventDefault(); navigate('/library'); }}>Connect music</a></p>}
      </li>
      {rows.map(({ request, stage }) => {
        const title = request.title ?? 'Unavailable song';
        const who = whoAsked(request);
        const why = held(request, stage);
        return (
          <li key={request.id} className={`request-row browser-request ${why && stage !== 'adding' ? 'stuck' : 'quiet'}`} data-stage={stage}>
            <span className="request-name">
              <b>{title}</b>
              <span>{request.artist ?? 'Unknown artist'}</span>
              {who && <span className="request-who">{who}</span>}
            </span>
            <span className="browser-request-actions">
              {!why && stage === 'no_mix' && (
                <Action className="primary" aria-label={`Start a mix with this song: ${title}`} run={() => startWith(request)} working="Starting…">Start a mix with this song</Action>
              )}
              {!why && stage !== 'no_mix' && (
                <Action className="primary" aria-label={`${live ? 'Add next' : 'Add to mix'}: ${title}`} run={() => onAdd(request)} working="Adding…">
                  {live ? 'Add next' : 'Add to mix'}
                </Action>
              )}
              <button className="request-cancel" disabled={request.id < 0} aria-label={`Dismiss: ${title}`} onClick={() => onDismiss(request)}>
                Dismiss
              </button>
            </span>
            {why && <p className="request-detail">{why}</p>}
          </li>
        );
      })}
    </ul>
  );
}
