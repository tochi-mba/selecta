import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Action, Skeleton } from '../ui/controls';
import { countOf, ELLIPSIS } from '../ui/format';
import { Icon } from '../ui/Icon';
import { navigate } from '../router';
import { showToast } from '../ui/toasts';
import type { RequestRow, Stage } from '../views/Requests';
import { useRoomLive, type RoomAsk, type RoomControl } from './useRoomSession';
import './rooms.css';

// The open room's requests, one list drawn the same way on the Rooms page and in the Requests
// drawer, so a request the host sees in one place is there, and can be acted on, in the other.
//
// Three short groups, in the order the host deals with them: Needs your approval (a room set to
// "I approve each": Approve or Pass), Ready to add (accepted: Add next while a mix plays, Add to
// mix when one is paused or stopped, Start a mix with this song when there is none, and Dismiss),
// and on the Rooms page Added to the mix (what the host has put in since opening the page).
// The requests come from the shared read of the room (useRoomSession's `useRoomLive`); the
// buttons that change the mix come from the browser's own Requests list (`mix`), matched to a
// room request by its id. A new row slides in; a row that is being dealt with says so.

type Row = { request: RequestRow; stage: Stage };
const LEAVE_MS = 4000;

/** The browser's Requests list and what it can do with a row; null where there is no such list
 * (a workspace whose mix is not built in this browser): SelectaDJ places the songs itself. */
export type RoomRequestsMix = {
  /** null while the list is still loading */
  rows: Row[] | null;
  /** a mix is playing or paused, so Add next has a current song to follow */
  live: boolean;
  onAdd: (request: RequestRow) => Promise<unknown>;
  onDismiss: (request: RequestRow) => Promise<unknown>;
  onStart: (request: RequestRow) => Promise<unknown>;
  /** the song is in the mix that is loaded now */
  inMix: (songId: number) => boolean;
};

/** Why a row has no Add button, in a few words; empty when it can be added. */
export function held(request: RequestRow, stage: Stage): string {
  if (stage === 'adding') return `Saving${ELLIPSIS}`;
  if (stage === 'unavailable') return 'No longer in your library.';
  if (stage === 'never') return 'Set to never play in your Library.';
  if (stage === 'in_mix') return 'Already in your mix.';
  // the browser family marks a song this device can play as `searching`
  if (request.stage !== 'searching') return request.browser_note ?? '';
  return '';
}

const firstArtist = (artist: string | null | undefined) => artist?.split(';')[0].trim() || 'Unknown artist';

/** One request: the song, who asked, what can be done. */
export function AskRow({ title, artist, who, extra, note, done, children, stage }: {
  title: string; artist: string | null | undefined; who?: string | null; extra?: string; note?: string; done?: boolean; stage?: string; children?: ReactNode;
}) {
  return (
    <li className={`ask ${done ? 'ask-done' : ''}`} data-stage={stage} data-testid="room-ask">
      <span className="ask-mark" aria-hidden="true"><Icon name={done ? 'check' : 'music'} size="toolbar" /></span>
      <span className="ask-song">
        <b>{title}</b>
        <span>{firstArtist(artist)}</span>
      </span>
      {(who || extra) && (
        <span className="ask-who">
          {who && <><span className="ask-face" aria-hidden="true">{who.trim()[0]?.toUpperCase() ?? '?'}</span><span><span className="visually-hidden">Asked by </span>{who}</span></>}
          {extra && <span className="ask-extra">{extra}</span>}
        </span>
      )}
      {children && <span className="ask-actions">{children}</span>}
      {note && <p className="ask-note">{note}</p>}
    </li>
  );
}

function Group({ title, count, help, children }: { title: string; count: number; help?: string; children: ReactNode }) {
  return (
    <section className="ask-group" aria-label={`${title}, ${count}`}>
      <header className="ask-group-head">
        <h4>{title}</h4>
        <span className="ask-count">{count}</span>
        {help && <p>{help}</p>}
      </header>
      <ul className="ask-list">{children}</ul>
    </section>
  );
}

export function RoomRequests({ variant, mix, control, votes = false, off = false, approving = false, unfit = [], onRetry, onChanged, onMissing, empty }: {
  variant: 'page' | 'drawer';
  mix: RoomRequestsMix | null;
  /** approve and pass, from whichever is reading the room here */
  control: RoomControl | null;
  votes?: boolean;
  /** requests are switched off in the room's settings */
  off?: boolean;
  /** the room is set to "I approve each", so the approval group shows even when it is empty */
  approving?: boolean;
  unfit?: RoomAsk[];
  onRetry?: (requestId: string) => Promise<unknown>;
  /** after a row was dealt with: read the room again, so the lists settle at once */
  onChanged?: () => Promise<unknown> | void;
  /** an accepted request has no row in the browser's list yet: ask for that list again */
  onMissing?: () => void;
  /** what the page shows when nothing has been asked for yet */
  empty?: ReactNode;
}) {
  const room = useRoomLive();
  // rows being added or dismissed keep what they showed until the room has been read again
  const [going, setGoing] = useState<Record<string, RequestRow>>({});
  const rows = mix?.rows ?? null;
  const roomRows = (rows ?? []).filter((row) => row.request.room_name);
  const rowOf = (ask: RoomAsk): Row | undefined => {
    const kept = going[ask.request_id];
    if (kept) return { request: kept, stage: 'searching' };
    return roomRows.find((row) => row.request.room_request_id === ask.request_id)
      // an older list without ids: the same song asked in a room is the same request
      ?? roomRows.find((row) => !row.request.room_request_id && row.request.song_id === ask.song?.song_id);
  };
  const coming = room?.coming ?? [];
  // room requests the browser holds while no read of the room is here to list them; once the room
  // has been read, its list is the only one, so every count and every list agree
  const loose = room ? [] : roomRows;
  const missing = !!mix && rows !== null && coming.some((ask) => !rowOf(ask));
  const asked = useRef(0);
  useEffect(() => {
    if (!missing || !onMissing || Date.now() - asked.current < 2000) return;
    asked.current = Date.now();
    onMissing();
  });

  const latest = useRef(room);
  latest.current = room;
  /** Do the thing, read the room again, and stay busy until the row has left its list (or a few
   * seconds have passed: it didn't work, and the row is put back as it was). */
  const settle = async (id: string, row: RequestRow | null, work: () => Promise<unknown>, from: 'inbox' | 'coming' = 'coming') => {
    if (row) setGoing((now) => ({ ...now, [id]: row }));
    try {
      await work();
      await onChanged?.();
      const until = Date.now() + LEAVE_MS;
      while (Date.now() < until && latest.current?.[from].some((ask) => ask.request_id === id)) await new Promise((done) => window.setTimeout(done, 100));
    } finally {
      if (row) setGoing((now) => { const { [id]: _gone, ...rest } = now; return rest; });
    }
  };
  const titleOf = (ask: RoomAsk) => ask.song?.title ?? 'A song';
  const voteWords = (ask: RoomAsk) => (votes && ask.votes > 1 ? countOf(ask.votes, 'vote') : undefined);

  const inbox = room?.inbox ?? [];
  const done = variant === 'page' && mix ? (room?.done ?? []).filter((ask) => ask.song && mix.inMix(ask.song.song_id)) : [];
  const waiting = inbox.length + coming.length + loose.length;
  const noMix = roomRows.some((row) => row.stage === 'no_mix');

  const acceptedActions = (id: string, title: string, row: Row | undefined) => {
    const pass = control && (
      <Action className="quiet" aria-label={`Dismiss: ${title}`} working={`Dismissing${ELLIPSIS}`} run={() => settle(id, null, async () => { await control.pass(id); showToast(`${title} was dismissed.`); })}>Dismiss</Action>
    );
    // no list in this browser: SelectaDJ puts accepted songs in the mix on its own
    if (!mix) return { note: '', buttons: <>{<span className="ask-state">Joins the mix on its own</span>}{pass}</> };
    if (!row) return { note: '', buttons: <>{<span className="ask-state">{rows === null ? `Loading${ELLIPSIS}` : `Getting ready${ELLIPSIS}`}</span>}{rows !== null && pass}</> };
    const why = going[id] ? '' : held(row.request, row.stage);
    const dismiss = (
      <Action className="quiet" aria-label={`Dismiss: ${title}`} working={`Dismissing${ELLIPSIS}`} waiting={row.request.id < 0}
        run={() => settle(id, row.request, async () => { await mix.onDismiss(row.request); showToast(`${title} was dismissed.`); })}>Dismiss</Action>
    );
    // a song whose file is on another device: say so, and offer the way to bring it here
    if (why) return { note: why, buttons: <>{why === row.request.browser_note && row.stage !== 'in_mix' && <button type="button" onClick={() => navigate('/library')}>Connect music</button>}{dismiss}</> };
    const start = row.stage === 'no_mix';
    const label = start ? 'Start a mix with this song' : mix.live ? 'Add next' : 'Add to mix';
    return {
      note: '',
      buttons: <>
        <Action className="primary" aria-label={`${label}: ${title}`} working={start ? `Starting${ELLIPSIS}` : `Adding${ELLIPSIS}`}
          run={() => settle(id, row.request, () => (start ? mix.onStart(row.request) : mix.onAdd(row.request)))}>{label}</Action>
        {dismiss}
      </>,
    };
  };

  if (variant === 'drawer' && !room && !loose.length) return null;
  const nothing = !waiting && !done.length && !unfit.length;

  return (
    <div className={`asks asks-${variant}`} data-testid="room-requests" aria-busy={Object.keys(going).length > 0 || undefined}>
      {variant === 'drawer' && (
        <header className="asks-head">
          <h3>From your room</h3>
          <span className="ask-count" data-testid="room-requests-count">{waiting}</span>
          {room && <p>{room.name}{room.code ? ` · ${room.code}` : ''}</p>}
        </header>
      )}
      {nothing && variant === 'drawer' && <p className="asks-none">{off ? 'Requests are off for this room.' : 'No requests from guests yet.'}</p>}
      {nothing && variant === 'page' && (empty ?? null)}
      {(inbox.length > 0 || (approving && !nothing)) && (
        <Group title="Needs your approval" count={inbox.length}>
          {inbox.length === 0 && <li className="asks-none">Nothing to approve right now.</li>}
          {inbox.map((ask) => (
            <AskRow key={ask.request_id} title={titleOf(ask)} artist={ask.song?.artist} who={ask.nickname} extra={voteWords(ask)} stage="approve">
              {control && <>
                <Action className="primary" aria-label={`Approve ${titleOf(ask)}`} working={`Approving${ELLIPSIS}`} run={() => settle(ask.request_id, null, () => control.approve(ask.request_id), 'inbox')}>Approve</Action>
                <Action className="quiet" aria-label={`Pass on ${titleOf(ask)}`} working={`Passing${ELLIPSIS}`} run={() => settle(ask.request_id, null, async () => { await control.pass(ask.request_id); showToast(`You passed on ${titleOf(ask)}.`); }, 'inbox')}>Pass</Action>
              </>}
            </AskRow>
          ))}
        </Group>
      )}
      {(coming.length > 0 || loose.length > 0) && (
        <Group title={mix ? 'Ready to add' : 'Accepted'} count={coming.length + loose.length}
          help={!mix ? undefined : noMix ? 'No mix yet. Start one with a request, then add the others.' : mix.live ? 'Add next plays a song right after the current one.' : 'Add to mix puts a song at the end of your mix.'}>
          {coming.map((ask) => {
            const row = rowOf(ask);
            const { note, buttons } = acceptedActions(ask.request_id, titleOf(ask), row);
            return <AskRow key={ask.request_id} title={titleOf(ask)} artist={ask.song?.artist} who={ask.nickname ?? row?.request.asked_by} extra={voteWords(ask)} note={note} stage={row?.stage}>{buttons}</AskRow>;
          })}
          {loose.map((row) => {
            const id = row.request.room_request_id ?? `row-${row.request.id}`;
            const title = row.request.title ?? 'Unavailable song';
            const { note, buttons } = acceptedActions(id, title, row);
            return <AskRow key={id} title={title} artist={row.request.artist} who={row.request.asked_by ?? 'A guest'} note={note} stage={row.stage}>{buttons}</AskRow>;
          })}
        </Group>
      )}
      {rows === null && mix && coming.length === 0 && variant === 'page' && !nothing && <Skeleton variant="rows" lines={2} label="Loading requests" />}
      {unfit.length > 0 && (
        <Group title="Couldn’t be added" count={unfit.length}>
          {unfit.map((ask) => (
            <AskRow key={ask.request_id} title={titleOf(ask)} artist={ask.song?.artist} who={ask.nickname}>
              {onRetry && <Action working={`Trying${ELLIPSIS}`} run={() => onRetry(ask.request_id)}>Try again</Action>}
            </AskRow>
          ))}
        </Group>
      )}
      {done.length > 0 && (
        <Group title="Added to the mix" count={done.length}>
          {done.map((ask) => <AskRow key={ask.request_id} done title={titleOf(ask)} artist={ask.song?.artist} who={ask.nickname} />)}
        </Group>
      )}
    </div>
  );
}
