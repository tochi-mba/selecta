import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Action, Skeleton } from '../ui/controls';
import { countOf, ELLIPSIS } from '../ui/format';
import { Icon } from '../ui/Icon';
import { navigate } from '../router';
import { showToast } from '../ui/toasts';
import type { RequestRow, Stage } from '../views/Requests';
import { useRoomLive, type RoomAsk, type RoomControl } from './useRoomSession';
import { feelOn } from '../feel/root';
import { FOLD_FALLBACK_MS, glideFrom, useFeelPart } from './feelHooks';
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
/** The waits before each re-ask for the browser's list while an accepted request has no row in it. */
export const MISSING_WAITS_MS = [0, 2000, 4000, 4000, 8000, 16000, 30000];
/** After this many re-asks (ten seconds) a row stops saying "Getting ready". */
export const STUCK_AFTER_ASKS = 4;
export const NOT_HERE_YET = 'This request hasn’t reached this browser yet, so it can’t be added here. SelectaDJ keeps trying.';

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

/** How long an approved request shows its drawn tick after it reaches its new place. */
const TICK_MS = 2400;

/** One request: the song, who asked, what can be done. The feel props (ADR-0477) change nothing
 * unless the screen passes them: `id` lets a row be found again after it moves to another list,
 * `ticked` draws a tick in its mark, `extraPops` pops a vote count that changed, and `leaving` is a
 * row already gone from the room, drawn only while it folds away. */
export function AskRow({ title, artist, who, extra, note, done, children, stage, id, ticked, extraPops, leaving }: {
  title: string; artist: string | null | undefined; who?: string | null; extra?: string; note?: string; done?: boolean; stage?: string; children?: ReactNode;
  id?: string; ticked?: boolean; extraPops?: boolean; leaving?: { onGone: () => void };
}) {
  const row = useRef<HTMLLIElement>(null);
  const onGone = useRef(leaving?.onGone);
  onGone.current = leaving?.onGone;
  const isLeaving = !!leaving;
  useEffect(() => {
    if (!isLeaving) return undefined;
    // the fold ends the row; with no animation (calm) the timer does
    const element = row.current;
    // only the row's own fold counts; a child's animation ending bubbles up too
    const gone = (event?: Event) => { if (!event || event.target === element) onGone.current?.(); };
    element?.addEventListener('animationend', gone);
    const timer = window.setTimeout(gone, FOLD_FALLBACK_MS);
    return () => { element?.removeEventListener('animationend', gone); window.clearTimeout(timer); };
  }, [isLeaving]);
  const classes = `ask ${done ? 'ask-done' : ''}${leaving ? ' feel-collapse-out' : ''}`;
  return (
    <li ref={row} className={classes} data-stage={stage} data-testid={leaving ? undefined : 'room-ask'} data-request={id}
      aria-hidden={leaving ? true : undefined} inert={leaving ? true : undefined}>
      <span className="ask-mark" aria-hidden="true">{ticked ? (
        <svg className="room-tick" viewBox="0 0 24 24"><path className="feel-tick" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      ) : <Icon name={done ? 'check' : 'music'} size="toolbar" />}</span>
      <span className="ask-song">
        <b>{title}</b>
        <span>{firstArtist(artist)}</span>
      </span>
      {(who || extra) && (
        <span className="ask-who">
          {who && <><span className="ask-face" aria-hidden="true">{who.trim()[0]?.toUpperCase() ?? '?'}</span><span><span className="visually-hidden">Asked by </span>{who}</span></>}
          {/* keyed by its words, so a count that changed is a new node and pops once */}
          {extra && <span key={extra} className={extraPops ? 'ask-extra feel-pop' : 'ask-extra'}>{extra}</span>}
        </span>
      )}
      {/* the reason first, then what can be done about it */}
      {note && <p className="ask-note">{note}</p>}
      {children && <span className="ask-actions">{children}</span>}
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
  const moving = useFeelPart('motion');
  const list = useRef<HTMLDivElement>(null);
  // ADR-0477: an approved request glides from where it was to its place under Ready to add, then
  // shows a tick; one passed on folds away. Where each approved row was, by request id:
  const glides = useRef(new Map<string, DOMRect>());
  const [ticks, setTicks] = useState<ReadonlySet<string>>(() => new Set());
  // requests passed on, kept (with their place) only so they can fold away once the room drops them
  const [passing, setPassing] = useState<Record<string, { ask: RoomAsk; index: number }>>({});
  // each request's vote count when first seen here, so only a count that changed pops
  const firstVotes = useRef(new Map<string, number>());
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
  // ADR-0475 R4: "Ready to add" counts what can be added from this device; a request whose song
  // waits on another device (its file is elsewhere, or its folder needs choosing) is not counted
  const actionable = (row: Row | undefined) => !!row && !held(row.request, row.stage);
  const readyHere = coming.filter((ask) => actionable(rowOf(ask))).length + loose.filter(actionable).length;
  // a row whose song waits on another device (it has a browser note and is not addable here)
  const waitsOnDevice = (row: Row | undefined) => !!row && !going[row.request.room_request_id ?? ''] && !!row.request.browser_note && row.stage !== 'in_mix' && !actionable(row);
  const heldComing = mix && rows !== null ? coming.filter((ask) => waitsOnDevice(rowOf(ask))) : [];
  const readyComing = coming.filter((ask) => !heldComing.includes(ask));
  const heldLoose = mix ? loose.filter(waitsOnDevice) : [];
  const readyLoose = loose.filter((row) => !heldLoose.includes(row));
  const missing = !!mix && rows !== null && coming.some((ask) => !rowOf(ask));
  // An accepted request with no row in the browser's list yet: the list is asked for again at
  // once, then after 2, 4 and 4 seconds, then ever less often up to every 30 seconds. "Getting
  // ready" is only said for the first ten seconds; after that the row says plainly that the
  // request has not reached this browser, with Try now and Dismiss, never a spinner for hours.
  const [asks, setAsks] = useState(0);
  const askAgain = useRef(onMissing);
  askAgain.current = onMissing;
  useEffect(() => {
    if (!missing) {
      if (asks) setAsks(0);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      askAgain.current?.();
      setAsks((count) => count + 1);
    }, MISSING_WAITS_MS[Math.min(asks, MISSING_WAITS_MS.length - 1)]);
    return () => window.clearTimeout(timer);
  }, [missing, asks]);
  const stuck = missing && asks >= STUCK_AFTER_ASKS;

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
  // the votes a request has, and the dedication on it (ADR-0488), said beside who asked
  const voteWords = (ask: RoomAsk) => [ask.room_pick ? 'The room picked this' : '', votes && ask.votes > 1 ? countOf(ask.votes, 'vote') : '', ask.dedication ?? ''].filter(Boolean).join(' · ') || undefined;
  const votesMoved = (ask: RoomAsk) => {
    const first = firstVotes.current.get(ask.request_id);
    if (first === undefined) { firstVotes.current.set(ask.request_id, ask.votes); return false; }
    return moving && first !== ask.votes;
  };
  /** Where a row is now, kept before it moves to another list. */
  const noteGlide = (id: string) => {
    if (!feelOn('motion')) return;
    const element = list.current?.querySelector(`[data-request="${CSS.escape(id)}"]`);
    if (element) glides.current.set(id, element.getBoundingClientRect());
  };

  // after each draw: a row approved here that now sits in another list glides there from where it was
  useLayoutEffect(() => {
    if (!glides.current.size) return;
    const landed: string[] = [];
    for (const [id, from] of glides.current) {
      const element = list.current?.querySelector(`[data-request="${CSS.escape(id)}"]:not([data-stage="approve"])`);
      if (!element) continue;
      glides.current.delete(id);
      glideFrom(element, from);
      landed.push(id);
    }
    if (landed.length) setTicks((now) => new Set([...now, ...landed]));
  });
  useEffect(() => {
    if (!ticks.size) return undefined;
    const timer = window.setTimeout(() => setTicks(new Set()), TICK_MS);
    return () => window.clearTimeout(timer);
  }, [ticks]);

  const inbox = room?.inbox ?? [];
  // a passed request the room no longer lists is drawn where it was, folding away
  const folding = Object.entries(passing).filter(([id]) => !inbox.some((ask) => ask.request_id === id));
  const inboxRows: { ask: RoomAsk; leaving: boolean }[] = inbox.map((ask) => ({ ask, leaving: false }));
  for (const [, { ask, index }] of folding) inboxRows.splice(Math.min(index, inboxRows.length), 0, { ask, leaving: true });
  const dropPassing = (id: string) => setPassing((now) => { const { [id]: _gone, ...rest } = now; return rest; });
  const pass = async (ask: RoomAsk, index: number) => {
    // kept before the answer, so the row folds in the same draw that drops it from the room
    if (feelOn('motion')) setPassing((now) => ({ ...now, [ask.request_id]: { ask, index } }));
    try {
      await settle(ask.request_id, null, async () => { await control?.pass(ask.request_id); showToast(`You passed on ${titleOf(ask)}.`); }, 'inbox');
    } catch (problem) {
      dropPassing(ask.request_id);
      throw problem;
    }
  };
  const done = variant === 'page' && mix ? (room?.done ?? []).filter((ask) => ask.song && mix.inMix(ask.song.song_id)) : [];
  const waiting = inbox.length + coming.length + loose.length;
  const noMix = roomRows.some((row) => row.stage === 'no_mix');

  const acceptedActions = (id: string, title: string, row: Row | undefined) => {
    const pass = control && (
      <Action className="quiet" aria-label={`Dismiss: ${title}`} working={`Dismissing${ELLIPSIS}`} run={() => settle(id, null, async () => { await control.pass(id); showToast(`${title} was dismissed.`); })}>Dismiss</Action>
    );
    // no list in this browser: SelectaDJ puts accepted songs in the mix on its own
    if (!mix) return { note: '', buttons: <>{<span className="ask-state">Joins the mix on its own</span>}{pass}</> };
    if (!row && stuck) {
      return { note: NOT_HERE_YET, buttons: <>{onMissing && <button type="button" aria-label={`Try now: ${title}`} onClick={() => onMissing()}>Try now</button>}{pass}</> };
    }
    if (!row) return { note: '', buttons: <>{<span className="ask-state">{rows === null ? `Loading${ELLIPSIS}` : `Getting ready${ELLIPSIS}`}</span>}{rows !== null && pass}</> };
    const why = going[id] ? '' : held(row.request, row.stage);
    const dismiss = (
      <Action className="quiet" aria-label={`Dismiss: ${title}`} working={`Dismissing${ELLIPSIS}`} waiting={row.request.id < 0}
        run={() => settle(id, row.request, async () => { await mix.onDismiss(row.request); showToast(`${title} was dismissed.`); })}>Dismiss</Action>
    );
    // a song whose file is on another device: say so, and offer the way to bring it here only
    // when that is the way on (ADR-0475 R4: never while another device has the file or plays)
    if (why) return { note: why, buttons: <>{why === row.request.browser_note && row.stage !== 'in_mix' && (row.request.connect_here ?? !row.request.plays_on) && <button type="button" className="quiet" onClick={() => navigate('/library')}>Connect music here</button>}{dismiss}</> };
    const start = row.stage === 'no_mix';
    const label = start ? 'Start a mix with this song' : mix.live ? 'Add next' : 'Add to mix';
    return {
      // where it will make sound, when that is not this device (ADR-0475 R4)
      note: row.request.where_note ?? '',
      buttons: <>
        <Action className="primary" aria-label={`${label}: ${title}`} working={start ? `Starting${ELLIPSIS}` : `Adding${ELLIPSIS}`}
          run={() => settle(id, row.request, () => (start ? mix.onStart(row.request) : mix.onAdd(row.request)))}>{label}</Action>
        {dismiss}
      </>,
    };
  };

  const comingRow = (ask: RoomAsk) => {
    const row = rowOf(ask);
    const { note, buttons } = acceptedActions(ask.request_id, titleOf(ask), row);
    return <AskRow key={ask.request_id} id={ask.request_id} ticked={ticks.has(ask.request_id)} extraPops={votesMoved(ask)} title={titleOf(ask)} artist={ask.song?.artist} who={ask.nickname ?? row?.request.asked_by} extra={voteWords(ask)} note={note} stage={row?.stage}>{buttons}</AskRow>;
  };
  const looseRow = (row: Row) => {
    const id = row.request.room_request_id ?? `row-${row.request.id}`;
    const title = row.request.title ?? 'Unavailable song';
    const { note, buttons } = acceptedActions(id, title, row);
    return <AskRow key={id} title={title} artist={row.request.artist} who={row.request.asked_by ?? 'A guest'} note={note} stage={row.stage}>{buttons}</AskRow>;
  };

  if (variant === 'drawer' && !room && !loose.length) return null;
  const nothing = !waiting && !done.length && !unfit.length;

  return (
    <div ref={list} className={`asks asks-${variant}`} data-testid="room-requests" aria-busy={Object.keys(going).length > 0 || undefined}>
      {variant === 'drawer' && (
        <header className="asks-head">
          <h3>From your room</h3>
          {waiting > 0 && <span className="ask-count" data-testid="room-requests-count">{waiting}</span>}
          {room && <p>{room.name}{room.code ? ` · ${room.code}` : ''}</p>}
        </header>
      )}
      {nothing && variant === 'drawer' && <p className="asks-none">{off ? 'Requests are off for this room.' : 'No requests from guests yet.'}</p>}
      {nothing && variant === 'page' && (empty ?? null)}
      {(inbox.length > 0 || folding.length > 0 || (approving && !nothing)) && (
        <Group title="Needs your approval" count={inbox.length}>
          {inbox.length === 0 && !folding.length && <li className="asks-none">Nothing to approve right now.</li>}
          {inboxRows.map(({ ask, leaving }, index) => leaving ? (
            <AskRow key={`gone-${ask.request_id}`} title={titleOf(ask)} artist={ask.song?.artist} who={ask.nickname} extra={voteWords(ask)} stage="approve"
              leaving={{ onGone: () => dropPassing(ask.request_id) }} />
          ) : (
            <AskRow key={ask.request_id} id={ask.request_id} title={titleOf(ask)} artist={ask.song?.artist} who={ask.nickname} extra={voteWords(ask)} extraPops={votesMoved(ask)} stage="approve">
              {control && <>
                <Action className="primary" aria-label={`Approve ${titleOf(ask)}`} working={`Approving${ELLIPSIS}`} run={() => { noteGlide(ask.request_id); return settle(ask.request_id, null, () => control.approve(ask.request_id), 'inbox'); }}>Approve</Action>
                <Action className="quiet" aria-label={`Pass on ${titleOf(ask)}`} working={`Passing${ELLIPSIS}`} run={() => pass(ask, index)}>Pass</Action>
              </>}
            </AskRow>
          ))}
        </Group>
      )}
      {(readyComing.length > 0 || readyLoose.length > 0) && (
        // counted: what the host can act on now; a request still on its way says so in its own row
        <Group title={mix ? 'Ready to add' : 'Accepted'} count={mix && rows !== null ? readyHere : coming.length + loose.length}
          help={!mix ? undefined : noMix ? 'No mix yet. Start one with a request, then add the others.' : mix.live ? 'Add next plays a song right after the current one.' : 'Add to mix puts a song at the end of your mix.'}>
          {readyComing.map(comingRow)}
          {readyLoose.map(looseRow)}
        </Group>
      )}
      {(heldComing.length > 0 || heldLoose.length > 0) && (
        // ADR-0475 R4: requests whose song waits on another device, apart from what can be added
        <Group title="Waiting on a device" count={heldComing.length + heldLoose.length}
          help="Each says which device has the song, or that none does right now.">
          {heldComing.map(comingRow)}
          {heldLoose.map(looseRow)}
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
