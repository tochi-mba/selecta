import { Action } from '../ui/controls';
import { JOINS_BY_HAND } from '../cloud/localFirstRequests';
import type { RequestRow, Stage } from './Requests';

// The Requests drawer's list in Cloud in the browser (rows that carry `browser_note`,
// localFirstRequests.ts). There is no planner there, so there is nothing to explain about spots,
// bridges or play times: one short Waiting list, each row saying who asked and offering one
// thing to do, Add next (it plays after the current song), plus Dismiss. Local mode keeps its own
// list in Requests.tsx, with the planner's words.

const HELP_IDLE = 'Add to mix puts a song at the end. While a mix plays, Add next plays it after the current song.';
const HELP_NO_MIX = 'Start a mix on Make a Mix, then add these to it.';

/** "Asked by Mia in Friday room" for a room guest's request; nothing for the member's own. */
function whoAsked(request: RequestRow): string {
  if (!request.room_name) return '';
  return `Asked by ${request.asked_by ?? 'a guest'} in ${request.room_name}`;
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

export function BrowserRequests({ rows, live, onAdd, onDismiss }: {
  rows: { request: RequestRow; stage: Stage }[];
  /** a mix is playing or paused, so Add next has a current song to follow */
  live: boolean;
  onAdd: (request: RequestRow) => Promise<unknown>;
  onDismiss: (request: RequestRow) => void;
}) {
  const noMix = rows.some((row) => row.stage === 'no_mix');
  return (
    <ul className="request-list browser-requests" aria-label="Your requests">
      <li className="request-group">
        <h3>Waiting</h3>
        <p>{live ? JOINS_BY_HAND : noMix ? HELP_NO_MIX : HELP_IDLE}</p>
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
