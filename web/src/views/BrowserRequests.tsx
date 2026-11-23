import { ApiError, type MixData, type MixItem, type Request } from '../api';
import type { PlayerLike } from '../playerContract';
import { navigate } from '../router';
import { Action } from '../ui/controls';
import { showToast } from '../ui/toasts';
import { ROOM_REQUEST_EVENT } from '../cloud/localFirstRequests';
import { AskRow, held, RoomRequests } from '../rooms/RoomRequests';
import { roomControl, ROOM_EVENT, useRoomLive } from '../rooms/useRoomSession';
import type { RequestRow, Stage } from './Requests';

export { useRoomLive };

// The Requests drawer in Cloud in the browser (rows that carry `browser_note`,
// localFirstRequests.ts). There is no planner there, so there is nothing to explain about spots,
// bridges or play times. Two parts, drawn around the panel's own search box:
//
// - `room`, first: the open room's requests, the same list as the Rooms page (RoomRequests):
//   who asked, Approve or Pass when the room asks for approval, then Add next and Dismiss.
// - `own`, under the Request a song search: the songs the host lined up here, each with the one
//   thing to do, Add next (it plays after the current song), plus Dismiss.
//
// With no mix at all the one thing is Start a mix with this song: a browser mix that begins with
// it, playing at once. Local mode keeps its own list in Requests.tsx, with the planner's words.

type Row = { request: RequestRow; stage: Stage };
type Playback = { mix: MixItem[]; player: PlayerLike; onMix: (data: MixData) => void };

/** No mix yet: make one that begins with the requested song, play it, and the request is done
 * (the same look the playing mix gives every few seconds settles it, and tells the room). */
export function startMixWith(send: Request, playback: Playback | undefined, refresh?: () => Promise<unknown> | void) {
  return async (request: RequestRow) => {
    try {
      const data = await send<MixData>(`/vibes/pick/build?start=${request.song_id}`, { method: 'POST', headers: { 'x-mix-order': '' } });
      playback?.onMix(data);
      void playback?.player.playFrom(0);
      await send('/requests/consider', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: data.mix.map((item) => item.song_id), position: 0 }) }).catch(() => undefined);
      await refresh?.();
      showToast(`Your mix starts with ${request.title ?? 'that song'}.`);
    } catch (problem) {
      if (!(problem instanceof ApiError && problem.code === 'not_enough_songs')) throw problem;
      showToast('A mix needs at least two songs that can play on this device.', { tone: 'problem', actions: [{ label: 'Connect music', run: () => navigate('/library') }] });
    }
  };
}

export function BrowserRequests({ part = 'own', rows, live, playback, send, refresh, onAdd, onDismiss }: {
  part?: 'room' | 'own';
  /** null while the list is loading */
  rows: Row[] | null;
  /** a mix is playing or paused, so Add next has a current song to follow */
  live: boolean;
  playback?: Playback;
  /** the adapted request client: builds the mix and settles the request */
  send: Request;
  refresh?: () => Promise<unknown> | void;
  onAdd: (request: RequestRow) => Promise<unknown>;
  onDismiss: (request: RequestRow) => Promise<unknown> | void;
}) {
  const onStart = startMixWith(send, playback, refresh);
  if (part === 'room') {
    return (
      <RoomRequests
        variant="drawer"
        control={roomControl()}
        mix={{ rows, live, onAdd, onDismiss: async (request) => { await onDismiss(request); }, onStart, inMix: (songId) => !!playback?.mix.some((item) => item.song_id === songId) }}
        onChanged={() => { window.dispatchEvent(new Event(ROOM_EVENT)); }}
        onMissing={() => window.dispatchEvent(new Event(ROOM_REQUEST_EVENT))}
      />
    );
  }
  const own = (rows ?? []).filter((row) => !row.request.room_name);
  if (!own.length) return null;
  return (
    <ul className="ask-list browser-requests" aria-label="Your requests">
      {own.map(({ request, stage }) => {
        const title = request.title ?? 'Unavailable song';
        const why = held(request, stage);
        const start = stage === 'no_mix';
        const label = start ? 'Start a mix with this song' : live ? 'Add next' : 'Add to mix';
        return (
          <AskRow key={request.id} title={title} artist={request.artist} note={stage === 'adding' ? '' : why} stage={stage}>
            {!why && <Action className="primary" aria-label={`${label}: ${title}`} run={() => (start ? onStart(request) : onAdd(request))} working="Working…">{label}</Action>}
            <button className="quiet" disabled={request.id < 0} aria-label={`Dismiss: ${title}`} onClick={() => { void onDismiss(request); }}>Dismiss</button>
          </AskRow>
        );
      })}
    </ul>
  );
}
