import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// The host's room session, held by the shell and not by the Rooms page (flag `rooms`).
//
// A room lives on the server, but everything the host's browser did for it used to live in the
// Rooms page: reading the room, hearing about new requests, showing who is waiting. On any other
// page, or with the tab in the background, the host heard nothing, and a browser-first room with
// no mix playing looked to the server like a room with nobody there. This hook reads the open room
// on every page for as long as the host's browser is open:
//
// - each read is also the host's presence (GET /api/rooms/current marks the host as seen), so an
//   open room is not ended for having "no speaker" while its host is between mixes;
// - a request that was not there on the last read is handed to `onAsked` with the guest's
//   nickname, so the shell can say "Mia asked for Song by Artist" with something to press;
// - the room's code and how many guests are here feed the shell's "Room open" line;
// - who asked for each accepted request is kept (`askerOf`) for the Requests drawer.
//
// It reads every few seconds while a room is open, and at once when the workspace stream says
// the room changed (CloudApp passes `room.*` and `requests.room` events on as ROOM_EVENT). It
// does not pause in a background tab: hearing about requests while doing something else is the
// point. With no room open it only looks once a minute, and at once when the Rooms page opens one.

/** Dispatched on `window` when the open room changed: by CloudApp for each `room.*` and
 * `requests.room` event on the workspace stream, and by the Rooms page after the host acts. */
export const ROOM_EVENT = 'selecta:room';

type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
type Song = { song_id: number; title: string; artist: string };
export type RoomAsk = { request_id: string; song: Song | null; nickname: string | null; votes: number };
type Guest = { status: string; online?: boolean };
type Current = {
  room: {
    room: { id: string; name: string; status: string };
    code: string | null;
    guests: Guest[];
    inbox: RoomAsk[];
    coming_up: RoomAsk[];
  } | null;
};

export type RoomSession = {
  id: string;
  name: string;
  code: string | null;
  /** Guests whose page checked in within the last moments. */
  guestsHere: number;
  /** Requests waiting for the host to approve (a room set to "I approve each"). */
  toApprove: number;
  /** Accepted requests waiting for the host to add them to the mix. */
  toAdd: number;
};

/** `approve`: it waits for the host's yes. `add`: it is accepted and waits to be put in the mix. */
export type AskKind = 'approve' | 'add';

const askers = new Map<string, string>();
// the open room's id as last read: null when no room is open, undefined before the first read
let openRoom: string | null | undefined;

/** The open room's requests as last read, for every place that lists them (the Rooms page and
 * the Requests drawer show the same rows from this one copy). `done` is what left the accepted
 * list since this browser started watching, newest first: added to the mix or let go. */
export type RoomDone = RoomAsk & { at: number };
export type RoomLive = { id: string; name: string; code: string | null; inbox: RoomAsk[]; coming: RoomAsk[]; done: RoomDone[] };
type RoomRead = { room: { id: string; name: string }; code: string | null; inbox: RoomAsk[]; coming_up: RoomAsk[] };
const DONE_KEPT = 12;
let liveRoom: RoomLive | null = null;
const watchers = new Set<() => void>();
const watch = (listener: () => void) => { watchers.add(listener); return () => { watchers.delete(listener); }; };

const roomClosers = new Set<() => void>();
/** Hear the open room close (ended here, elsewhere or by time). Returns the unsubscribe. */
export function onRoomClosed(listener: () => void): () => void { roomClosers.add(listener); return () => { roomClosers.delete(listener); }; }

/** Take in a read of the open room (or null: no room is open). The shell's session and the
 * Rooms page both read the room; whichever read is newest is what every list shows. */
export function noteRoom(panel: RoomRead | null) {
  let next: RoomLive | null = null;
  // ADR-0475 D30: the room closing closes what was opened for it (the speaker picker)
  if (!panel && openRoom) for (const closed of roomClosers) closed();
  if (!panel) {
    openRoom = null;
    askers.clear();
  } else {
    openRoom = panel.room.id;
    askers.clear();
    for (const ask of [...panel.inbox, ...panel.coming_up]) if (ask.nickname) askers.set(ask.request_id, ask.nickname);
    const before = liveRoom && liveRoom.id === panel.room.id ? liveRoom : null;
    const still = new Set([...panel.inbox, ...panel.coming_up].map((ask) => ask.request_id));
    const left = (before?.coming ?? []).filter((ask) => !still.has(ask.request_id)).map((ask) => ({ ...ask, at: Date.now() }));
    const brief = (ask: RoomAsk): RoomAsk => ({ request_id: ask.request_id, song: ask.song && { song_id: ask.song.song_id, title: ask.song.title, artist: ask.song.artist }, nickname: ask.nickname, votes: ask.votes });
    next = {
      id: panel.room.id, name: panel.room.name, code: panel.code,
      inbox: panel.inbox.map(brief), coming: panel.coming_up.map(brief),
      // one a late read brought back is waiting again, and one that left twice is listed once
      done: [...left, ...(before?.done ?? []).filter((ask) => !still.has(ask.request_id) && !left.some((gone) => gone.request_id === ask.request_id))].slice(0, DONE_KEPT),
    };
  }
  if (JSON.stringify(next) === JSON.stringify(liveRoom)) return;
  liveRoom = next;
  for (const listener of watchers) listener();
}

/** The open room's requests, kept current by `noteRoom`; null when no room is open. */
export function useRoomLive(): RoomLive | null {
  return useSyncExternalStore(watch, () => liveRoom, () => null);
}

/** How many requests wait for the host: the one number behind the side bar badge, the Requests
 * drawer's count and the Rooms page. The room's come from the shared read of the room (waiting
 * for approval, and accepted); the host's own are the rows no room asked for. Before the room
 * has been read, the room rows the browser already holds stand in. */
export function waitingCount(live: RoomLive | null, rows: Countable[] | null | undefined): number {
  // ADR-0475 R4: a row waiting on another device is counted apart, never in the badge
  const own = rows?.filter((row) => !row.room_name && actionableHere(row)).length ?? 0;
  if (!live) return own + (rows?.filter((row) => row.room_name && actionableHere(row)).length ?? 0);
  const { ready, onTheWay } = addable(live.coming, rows);
  return own + live.inbox.length + ready + onTheWay;
}

/** A request row as the counts read it. */
type Countable = { room_name?: string; room_request_id?: string; browser_note?: string; stage?: string };
/** ADR-0475 R4: a Cloud row can be acted on from this device when the device that would play it
 * holds the song (the browser family marks that `searching`). A row waiting on another device
 * (its file is elsewhere, or a folder needs choosing again) is counted apart. Rows without a
 * browser note (local mode) are always actionable. */
export const actionableHere = (row: Countable) => !row.browser_note || row.stage === 'searching';

/** The accepted room requests, split by whether the host can add them now. A request can be
 * added once the browser's own Requests list holds its row (matched by the room request's id)
 * and the device that would play it holds the song; a row whose song waits on another device is
 * `onDevice`; one without a row yet is on its way. Before that list has loaded, every accepted
 * request counts as ready, as the room says. So the room line, the drawer and the Rooms page agree. */
export function addable(coming: readonly { request_id: string }[], rows: readonly Countable[] | null | undefined): { ready: number; onTheWay: number; onDevice: number } {
  if (!rows) return { ready: coming.length, onTheWay: 0, onDevice: 0 };
  const byId = new Map(rows.filter((row) => row.room_request_id).map((row) => [row.room_request_id!, row]));
  let ready = 0;
  let onDevice = 0;
  for (const ask of coming) {
    const row = byId.get(ask.request_id);
    if (!row) continue;
    if (actionableHere(row)) ready += 1; else onDevice += 1;
  }
  return { ready, onTheWay: coming.length - ready - onDevice, onDevice };
}

/** What the host can do to a room request from any page: say yes to one waiting for approval,
 * or pass on one. Set while the shell's room session runs; null when it doesn't. */
export type RoomControl = { approve: (requestId: string) => Promise<void>; pass: (requestId: string) => Promise<void> };
let control: RoomControl | null = null;
export function roomControl(): RoomControl | null {
  return control;
}

/** The id of the room that is open now, null when none is, undefined while that isn't known
 * (no read yet, or Rooms is off). The Requests drawer drops a closed room's requests by it. */
export function openRoomId(): string | null | undefined {
  return openRoom;
}

const OPEN_MS = 8_000;
const IDLE_MS = 60_000;
const SOON_MS = 250;

export function useRoomSession({ api, workspaceId, enabled, onAsked }: {
  api: Api;
  workspaceId: string;
  /** The `rooms` flag is on for this account and Rooms is not locked to another plan. */
  enabled: boolean;
  onAsked?: (ask: RoomAsk, kind: AskKind, roomId: string) => void;
}): RoomSession | null {
  const [session, setSession] = useState<RoomSession | null>(null);
  const told = useRef(onAsked);
  told.current = onAsked;

  useEffect(() => {
    if (!enabled) { openRoom = undefined; setSession(null); return undefined; }
    let live = true;
    const tell = async (requestId: string, what: 'approve' | 'pass') => {
      if (!liveRoom) return;
      const read = await api<RoomRead>(`/rooms/${encodeURIComponent(liveRoom.id)}/requests/${encodeURIComponent(requestId)}/${what}`, { method: 'POST' }, workspaceId);
      if (read?.room) noteRoom(read);
      window.dispatchEvent(new Event(ROOM_EVENT));
    };
    const mine: RoomControl = { approve: (id) => tell(id, 'approve'), pass: (id) => tell(id, 'pass') };
    control = mine;
    let timer = 0;
    let reading = false;
    let again = false;
    // request ids already seen in this room, so each is announced once; null until the first read,
    // which only takes stock (a reload must not announce everything that was already waiting)
    let seen: { room: string; approve: Set<string>; add: Set<string> } | null = null;

    const read = async () => {
      if (!live) return;
      if (reading) { again = true; return; }
      reading = true;
      window.clearTimeout(timer);
      let open = seen !== null && seen.room !== '';
      try {
        const answer = await api<Current>('/rooms/current', {}, workspaceId);
        if (!live) return;
        const panel = answer.room;
        if (!panel) {
          seen = { room: '', approve: new Set(), add: new Set() };
          open = false;
          noteRoom(null);
          setSession(null);
        } else {
          open = true;
          noteRoom(panel);
          const first = seen === null || seen.room !== panel.room.id;
          const before = first ? { room: panel.room.id, approve: new Set<string>(), add: new Set<string>() } : seen!;
          if (!first) {
            for (const ask of panel.inbox) if (!before.approve.has(ask.request_id)) told.current?.(ask, 'approve', panel.room.id);
            // one the host just approved was announced when it arrived; only say what is new
            for (const ask of panel.coming_up) if (!before.add.has(ask.request_id) && !before.approve.has(ask.request_id)) told.current?.(ask, 'add', panel.room.id);
          }
          seen = {
            room: panel.room.id,
            approve: new Set([...before.approve, ...panel.inbox.map((ask) => ask.request_id)]),
            add: new Set([...before.add, ...panel.coming_up.map((ask) => ask.request_id)]),
          };
          const next: RoomSession = {
            id: panel.room.id,
            name: panel.room.name,
            code: panel.code,
            guestsHere: panel.guests.filter((guest) => guest.status === 'active' && guest.online).length,
            toApprove: panel.inbox.length,
            toAdd: panel.coming_up.length,
          };
          setSession((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
        }
      } catch {
        // the connection or the server is away: what was last known stays, and the next read tries again
      } finally {
        reading = false;
        if (live) {
          if (again) { again = false; void read(); }
          else timer = window.setTimeout(() => void read(), open ? OPEN_MS : IDLE_MS);
        }
      }
    };
    // a burst of events (a guest sending several songs) is one read, a moment later
    let soon = 0;
    const changed = () => {
      window.clearTimeout(soon);
      soon = window.setTimeout(() => void read(), SOON_MS);
    };
    const back = () => { if (document.visibilityState === 'visible') changed(); };
    window.addEventListener(ROOM_EVENT, changed);
    window.addEventListener('online', changed);
    document.addEventListener('visibilitychange', back);
    void read();
    return () => {
      live = false;
      if (control === mine) control = null;
      window.clearTimeout(timer);
      window.clearTimeout(soon);
      window.removeEventListener(ROOM_EVENT, changed);
      window.removeEventListener('online', changed);
      document.removeEventListener('visibilitychange', back);
    };
  }, [api, workspaceId, enabled]);

  // the line and every list count from the same read of the room, whichever page made it
  const shown = useRoomLive();
  if (!session || !shown || shown.id !== session.id) return session;
  if (session.toApprove === shown.inbox.length && session.toAdd === shown.coming.length) return session;
  return { ...session, toApprove: shown.inbox.length, toAdd: shown.coming.length };
}

/** "Mia asked for Song by Artist", or without a name when the room gave none. */
export function askWords(ask: RoomAsk): string {
  // a long credit line ("Ellie Goulding; Joe Kearns; ...") is said by its first name only
  const artist = ask.song?.artist?.split(';')[0].trim();
  const song = ask.song ? `${ask.song.title}${artist ? ` by ${artist}` : ''}` : 'a song';
  return `${ask.nickname ?? 'A guest'} asked for ${song}`;
}

/** The link in the shell's line for an open room: "Room open: ABCD-EFGH". The shell adds how
 * many guests are here and how many requests wait for approval as words of their own, so the
 * line wraps between them on a phone. */
export function roomLine(session: RoomSession): string {
  return `Room open: ${session.code ?? session.name}`;
}

/** Who asked for an accepted room request, by its id, as the last read of the open room gave it.
 * The Requests drawer in the browser (localFirstRequests.ts) names the guest from this. */
export function askerOf(requestId: string): string | null {
  return askers.get(requestId) ?? null;
}
