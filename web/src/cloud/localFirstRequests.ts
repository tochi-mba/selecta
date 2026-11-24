import { ApiError, type MixData, type Request } from '../api';
import type { RequestRow } from '../views/Requests';
import type { PlayableSong } from './localFirstMixes';
import { askerOf, openRoomId } from '../rooms/useRoomSession';
import { addedOnReturn, comingUp, notHereWords, notOnSpeaker, playsOn, programmeWithNext, speakerHolds, type ControllerLink, type WhereHeld } from '../devices/controller';

/** The requests route family of the local-first adapter (ADR-0462 "one adapter per route family"):
 * `/requests`, `/requests/consider`, `/requests/insert` and `/requests/{id}/add` as the shared
 * Request a song panel (views/Requests.tsx) asks them, answered in the browser.
 *
 * What a request is here, honestly: a song saved for later, by the member on this browser or by a
 * room guest the host accepted. Nothing in a browser library is measured for key or tempo, so
 * SelectaDJ cannot look for a spot where a request fits or a bridge song that leads to it, and a
 * request never joins the mix on its own. The host adds it, and it goes in right after the song
 * that is playing, with the browser's own blend. Bridges and hearing a request's transitions
 * ahead are refused with that reason. The panel shows these rows as one short Waiting list
 * (views/BrowserRequests.tsx): who asked, Add next, Dismiss.
 *
 * Where it is kept: this browser's own requests in localStorage per workspace, next to the
 * recipe store's current-mix pointer, so they survive a reload. Room requests stay on the server
 * (`/api/room-requests`, kept by the Cloud planner `BrowserPlanner`) and are told about on the
 * workspace event stream (`requests.room`), which CloudApp passes on as `ROOM_REQUEST_EVENT`.
 */

/** CloudApp dispatches this on `window` for each `requests.room` event on the workspace stream. */
export const ROOM_REQUEST_EVENT = 'selecta:room-request';

export const JOINS_BY_HAND = 'Add next plays a song right after the current one.';
export const NOT_ON_THIS_DEVICE = 'This song’s file isn’t on this device. Connect it in Library to play it.';
export const NO_BRIDGES = 'SelectaDJ can’t look for bridge songs in your browser: nothing here is measured for key or tempo. Add the request to the mix directly instead.';
export const NOTHING_TO_HEAR = 'A request’s transitions are worked out in your browser as the mix plays, so there is nothing to hear ahead.';
export const NO_MIX_YET = 'There is no mix playing to add it to. Start a mix on Make a Mix first.';

/** A room request waiting for this workspace's browser mix, as `/api/room-requests` answers it. */
export type RoomRequest = { id: string; room_id: string; room_name: string; song_id: number; votes: number; handed_at: number | null };
type LocalRequest = { id: number; song_id: number; at: number };
type Saved = { next: number; local: LocalRequest[]; room: Record<string, number> };

// every `requests.room` event moves this on, so the next read asks the server again
let roomVersion = 0;
if (typeof window !== 'undefined') window.addEventListener(ROOM_REQUEST_EVENT, () => { roomVersion += 1; });
/** SSE can be blocked or a browser can miss an event while sleeping. The visible Requests
 * panel polls every 4 seconds, so refresh the room list on its next/second poll. */
const ROOM_REFRESH_MS = 6_000;

const queueKey = (workspaceId: string) => `selecta-requests:${workspaceId}`;
// the last room list the server gave, so the panel still shows it while the connection is down
const roomKey = (workspaceId: string) => `selecta-requests-room:${workspaceId}`;

function lastRoom(workspaceId: string): RoomRequest[] {
  try {
    const kept = JSON.parse(window.localStorage.getItem(roomKey(workspaceId)) ?? 'null') as unknown;
    return Array.isArray(kept) ? kept as RoomRequest[] : [];
  } catch { return []; }
}
function keepRoom(workspaceId: string, room: RoomRequest[]) {
  try { window.localStorage.setItem(roomKey(workspaceId), JSON.stringify(room)); } catch { /* kept for this visit only */ }
}

function load(workspaceId: string): Saved {
  try {
    const saved = JSON.parse(window.localStorage.getItem(queueKey(workspaceId)) ?? 'null') as Partial<Saved> | null;
    if (saved && Array.isArray(saved.local)) {
      return { next: Number(saved.next) || 1, local: saved.local.filter((row) => Number.isInteger(row?.id) && Number.isInteger(row?.song_id)), room: saved.room ?? {} };
    }
  } catch { /* nothing kept here: start empty */ }
  return { next: 1, local: [], room: {} };
}
function save(workspaceId: string, saved: Saved) {
  try { window.localStorage.setItem(queueKey(workspaceId), JSON.stringify(saved)); } catch { /* kept for this visit only */ }
}

/** Nothing is playing and this device lacks the file: the R4 line, said about this device. */
function hereWords(note: string): string {
  return note.replace(/ This device can’t play it\.$/, ' Start the music there to add it.');
}

function refuse(message: string, code: string, status = 400): ApiError {
  return new ApiError(message, status, code, 'local-first:requests');
}

function bodyOf<T>(init?: RequestInit): T {
  try { return JSON.parse(String(init?.body ?? '{}')) as T; } catch { return {} as T; }
}

type Where = { order?: number[]; position?: number };

export type RequestsFamily = {
  /** The family's answer, or undefined when the request is not one of its routes. */
  answer: (method: string, route: string, query: URLSearchParams, init?: RequestInit) => Promise<unknown> | undefined;
};

/** `cloud` is the authenticated Cloud client; `send` is the adapted request, for the mix routes. */
export function requestsFamily({ cloud, workspaceId, songs, send, rooms: hasRooms, controller, holders }: {
  cloud: Request;
  /** ADR-0475: the device that is playing, when it is not this one. Requests are then added to
   * its programme, and a row is judged by what that device can play, not this one. */
  controller?: () => ControllerLink | null;
  /** ADR-0475 R4: which of the person's other devices hold a song, to say where it is when the
   * device that would play it cannot. */
  holders?: () => WhereHeld | null;
  workspaceId: string;
  /** False for an account without Rooms: its room list is empty and the server is never asked. */
  rooms?: boolean;
  songs: () => Promise<PlayableSong[]>;
  send: Request;
}): RequestsFamily {
  let rooms: Promise<RoomRequest[]> | null = null;
  let roomsAt = 0;
  let roomsVersion = -1;
  // the last request this browser put in the mix, so its Undo can take exactly that back out
  // (`room`: the room request it settled, so Undo can put that back to waiting as well)
  let lastJoin: { order: string; at: number; room?: string } | null = null;
  // the same for a request put into another device's programme: what the programme was before
  let lastSent: { order: string; before: number[]; index: number } | null = null;
  // room requests this device has just sent to the speaker: hidden here until the speaker's own
  // look settles them with the room, or the wait runs out and the row is shown again
  const sentToSpeaker = new Map<string, number>();
  const SENT_HIDES_MS = 30_000;

  const roomRequests = (): Promise<RoomRequest[]> => {
    if (hasRooms === false) return Promise.resolve([]);
    if (!rooms || roomsVersion !== roomVersion || performance.now() - roomsAt > ROOM_REFRESH_MS) {
      roomsVersion = roomVersion;
      roomsAt = performance.now();
      // no Rooms here (off for this account, or not set up) is an empty list, not a broken panel
      // offline, the last room list stands in rather than the room's requests vanishing
      rooms = cloud<{ requests: RoomRequest[] }>('/room-requests')
        .then((answer) => { const room = answer.requests ?? []; keepRoom(workspaceId, room); return room; })
        .catch(() => { rooms = null; return lastRoom(workspaceId); });
    }
    return rooms;
  };
  const roomChanged = () => { rooms = null; };
  // the last song list read, so a dropped connection keeps the panel's titles on screen
  let lastSongs: PlayableSong[] | null = null;
  const knownSongs = async (): Promise<PlayableSong[]> => {
    try {
      lastSongs = await songs();
    } catch (problem) {
      if (!lastSongs) throw problem;
    }
    return lastSongs;
  };

  /** Every waiting request, this browser's own first, then the room's in the order they came. */
  const rows = async (): Promise<{ rows: RequestRow[]; saved: Saved; room: RoomRequest[] }> => {
    const [all, handed] = await Promise.all([knownSongs(), roomRequests()]);
    // a room that has closed takes its unplayed requests with it: the server lists open rooms
    // only, and once this browser knows which room is open (or that none is) it holds to that
    const openNow = openRoomId();
    const room = openNow === undefined ? handed : handed.filter((asked) => asked.room_id === openNow);
    const saved = load(workspaceId);
    // a room request gets a number of its own here, kept so its row keeps its place on screen
    const kept: Record<string, number> = {};
    for (const asked of room) {
      kept[asked.id] = saved.room[asked.id] ?? saved.next++;
    }
    const changed = JSON.stringify(kept) !== JSON.stringify(saved.room);
    saved.room = kept;
    if (changed) save(workspaceId, saved);
    const link = controller?.() ?? null;
    const places = holders?.() ?? null;
    const row = (id: number, songId: number, from?: RoomRequest): RequestRow => {
      const song = all.find((one) => one.id === songId);
      // another device is playing: what matters is whether that device can play the song
      const there = link && song ? speakerHolds(link, songId) : false;
      // R4: the device that would play it cannot, so say where the file is (or that it is nowhere)
      const missing = song && (link ? !there : !song.playable) ? notHereWords(places ? places(songId) : null, link?.speakerName ?? 'This device') : null;
      const note = link ? (there ? JOINS_BY_HAND : missing?.note ?? notOnSpeaker(link.speakerName)) : song?.playable ? JOINS_BY_HAND : missing && places ? hereWords(missing.note) : NOT_ON_THIS_DEVICE;
      return {
        id, song_id: songId, title: song?.title ?? null, artist: song?.artist ?? null, status: 'waiting',
        // a song no longer in the catalogue really has gone from the library
        available: song ? 1 : 0,
        stage: (link ? there : song?.playable) ? 'searching' : 'waiting',
        browser_note: note,
        // R4 row five: connecting music here is the way on only when no device has the file
        ...(missing && places ? { connect_here: missing.connectHere } : {}),
        ...(link ? { plays_on: link.speakerName, ...(there ? { where_note: link.online ? playsOn(link.speakerName) : addedOnReturn(link.speakerName) } : {}) } : {}),
        // a room request says who asked and in which room; the member's own says neither
        ...(from ? { room_name: from.room_name, asked_by: askerOf(from.id), room_request_id: from.id } : {}),
      };
    };
    // on its way to the speaker: not offered again here while that device takes it in
    const nowMs = Date.now();
    for (const [roomId, until] of sentToSpeaker) if (until < nowMs || !room.some((asked) => asked.id === roomId)) sentToSpeaker.delete(roomId);
    const shown = link ? room.filter((asked) => !sentToSpeaker.has(asked.id)) : room;
    return {
      rows: [
        ...saved.local.map((asked) => row(asked.id, asked.song_id)),
        ...shown.map((asked) => row(kept[asked.id], asked.song_id, asked)),
      ],
      saved,
      room,
    };
  };
  /** The list the Requests hook polls every four seconds. With nothing waiting (no request of
   * this browser's own, none from the open room) there are no titles to look up, so the library
   * is not read: an idle page used to read the whole catalogue on every poll. */
  const list = async () => {
    const handed = await roomRequests();
    const openNow = openRoomId();
    const waiting = openNow === undefined ? handed.length : handed.filter((asked) => asked.room_id === openNow).length;
    if (!waiting && !load(workspaceId).local.length) return { requests: [] as RequestRow[] };
    return { requests: (await rows()).rows };
  };

  /** Let a request go: this browser's own is forgotten, a room's is reported to the room. */
  const finish = async (id: number, outcome: 'played' | 'dismiss') => {
    const { saved, room } = await rows();
    const local = saved.local.find((asked) => asked.id === id);
    if (local) {
      saved.local = saved.local.filter((asked) => asked.id !== id);
      save(workspaceId, saved);
      return true;
    }
    const roomId = Object.entries(saved.room).find(([, number]) => number === id)?.[0];
    if (roomId && room.some((asked) => asked.id === roomId)) {
      await cloud(`/room-requests/${encodeURIComponent(roomId)}/${outcome}`, { method: 'POST' });
      roomChanged();
      return true;
    }
    return false;
  };

  const add = async (init?: RequestInit) => {
    const { song_id: songId } = bodyOf<{ song_id?: number }>(init);
    const song = (await songs()).find((one) => one.id === Number(songId));
    if (!song) throw refuse('That song isn’t in your library.', 'not_found', 404);
    const { rows: now, saved } = await rows();
    // asked for already: the list as it is, never a second row for the same song
    if (!now.some((row) => row.song_id === song.id)) {
      saved.local.push({ id: saved.next, song_id: song.id, at: Date.now() });
      saved.next += 1;
      save(workspaceId, saved);
    }
    return list();
  };

  /** Into the current recipe, right after the song that is playing (or at the end when nothing
   * is), through the mix family's own add, so its checks (plays here, mix unchanged) apply. */
  /** ADR-0475 R4: another device is the speaker, so the song goes into its programme, right
   * after the one it is playing, and the music there does not move. This device's own request is
   * done at once; a room's is settled by the speaker when the song is in its mix, exactly as
   * when the host adds it there. */
  const joinOnSpeaker = async (link: ControllerLink, asked: RequestRow): Promise<MixData> => {
    if (!speakerHolds(link, asked.song_id)) throw refuse(notOnSpeaker(link.speakerName), 'not_on_speaker', 409);
    const before = [...link.programme];
    let order = before;
    if (!comingUp(link, asked.song_id)) {
      const change = programmeWithNext(link, asked.song_id);
      if (!(await link.send('set_programme', change))) throw refuse(`${link.speakerName} didn’t take that. Try again.`, 'speaker_refused', 409);
      order = change.songs;
      lastSent = { order: order.join(','), before, index: change.song_index };
    }
    const { saved, room } = await rows();
    if (saved.local.some((own) => own.id === asked.id)) {
      saved.local = saved.local.filter((own) => own.id !== asked.id);
      save(workspaceId, saved);
    } else {
      const roomId = Object.entries(saved.room).find(([, number]) => number === asked.id)?.[0];
      if (roomId && room.some((one) => one.id === roomId)) sentToSpeaker.set(roomId, Date.now() + SENT_HIDES_MS);
    }
    const all = await knownSongs();
    return {
      name: '', can_undo: false,
      mix: order.map((songId, position) => {
        const song = all.find((one) => one.id === songId);
        return { position, song_id: songId, artist: song?.artist ?? '', title: song?.title ?? 'A song', duration: song?.duration ?? 0, bpm: null, key: null, locked: false, seam: null };
      }),
    };
  };

  const join = async (id: number, where: Where | undefined): Promise<MixData> => {
    const { rows: now } = await rows();
    const asked = now.find((row) => row.id === id);
    if (!asked) throw refuse('That request isn’t waiting any more.', 'no_request', 404);
    const link = controller?.() ?? null;
    if (link) return joinOnSpeaker(link, asked);
    const mix = await send<MixData>('/mix');
    if (!mix.mix.length) throw refuse(NO_MIX_YET, 'no_mix', 409);
    const order = (where?.order?.length ? where.order : mix.mix.map((item) => item.song_id)).join(',');
    const playing = Number.isInteger(where?.position) ? Number(where?.position) : mix.mix.length - 1;
    const at = Math.max(0, Math.min(mix.mix.length, playing + 1));
    const changed = await send<MixData>('/mix/songs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mix-order': order },
      body: JSON.stringify({ song_id: asked.song_id, position: at }),
    });
    lastJoin = { order: changed.mix.map((item) => item.song_id).join(','), at, room: asked.room_request_id };
    // it is in the mix now; a room that isn't told this time is told on the next look (settle)
    await finish(id, 'played').catch(() => undefined);
    return changed;
  };

  /** A look while the mix plays: requests whose song is playing now or still to come are done.
   * A song that already played earlier in this mix does not count: the guest who asked would be
   * told it was added when they will not hear it again. Nothing is offered to join on its own
   * (`offer` stays empty), because nothing can say where it fits. */
  const consider = async (init?: RequestInit) => {
    const { order = [], position } = bodyOf<Where>(init);
    const from = Number.isInteger(position) ? Math.max(0, Number(position)) : 0;
    const inMix = new Set(order.slice(from));
    const { rows: now } = await rows();
    const settled: string[] = [];
    // with another device playing, a room's request is settled by that device, which knows the
    // song really is in its mix; only this device's own requests are let go of here
    const remote = !!controller?.();
    for (const row of now) {
      if (!inMix.has(row.song_id)) continue;
      if (remote && row.room_request_id) continue;
      if (await finish(row.id, 'played').catch(() => false)) settled.push(row.title ?? 'A requested song');
    }
    return { ...(await list()), settled };
  };

  const undo = (init?: RequestInit): Promise<MixData> | undefined => {
    let expected: string | null = null;
    try { expected = new Headers(init?.headers).get('x-mix-order'); } catch { /* no header */ }
    const sent = lastSent;
    const link = controller?.() ?? null;
    if (link && sent && expected === sent.order) {
      lastSent = null;
      // put the speaker's programme back as it was, without moving the music
      return link.send('set_programme', { songs: sent.before, song_index: Math.min(sent.index, sent.before.length - 1), keep_position: true })
        .then(() => ({ mix: [], name: '', can_undo: false }) as MixData);
    }
    const last = lastJoin;
    // only the request this browser just added; any other undo is the mix family's to answer
    if (!last || expected !== last.order) return undefined;
    lastJoin = null;
    return send<MixData>(`/mix/songs/${last.at}`, { method: 'DELETE', headers: { 'x-mix-order': last.order } }).then(async (mix) => {
      // The song is out of the mix again, so a guest's request for it is waiting again: without
      // this the room went on telling the guest it had played, and the host could not add it.
      // A room that can't be told now keeps the request as played; the mix is still right.
      if (last.room) {
        await cloud(`/room-requests/${encodeURIComponent(last.room)}/waiting`, { method: 'POST' }).catch(() => undefined);
        roomChanged();
      }
      return mix;
    });
  };

  return {
    answer: (method, route, _query, init) => {
      if (method === 'POST' && route === '/mix/undo') return undo(init);
      if (route !== '/requests' && !route.startsWith('/requests/')) return undefined;
      if (method === 'GET' && route === '/requests') return list();
      if (method === 'POST' && route === '/requests') return add(init);
      if (method === 'POST' && route === '/requests/consider') return consider(init);
      if (method === 'POST' && route === '/requests/insert') {
        const body = bodyOf<Where & { offer?: string }>(init);
        const id = Number(String(body.offer ?? '').replace(/^request-/, ''));
        if (!Number.isInteger(id)) return Promise.reject(refuse('That request isn’t waiting any more.', 'no_request', 404));
        return join(id, body);
      }
      const adding = /^\/requests\/(\d+)\/add$/.exec(route);
      if (method === 'POST' && adding) return join(Number(adding[1]), init?.body ? bodyOf<Where>(init) : undefined);
      const one = /^\/requests\/(\d+)$/.exec(route);
      if (method === 'DELETE' && one) {
        return (async () => {
          await finish(Number(one[1]), 'dismiss');
          return { ...(await list()), cancelled: true };
        })();
      }
      if (/^\/requests\/\d+\/(bridges|bridge)$/.test(route)) return Promise.reject(refuse(NO_BRIDGES, 'flag_off'));
      if (/^\/requests\/\d+\/hear$/.test(route)) return Promise.reject(refuse(NOTHING_TO_HEAR, 'flag_off'));
      return Promise.reject(refuse('SelectaDJ can’t do that with requests in your browser yet.', 'flag_off', 404));
    },
  };
}
