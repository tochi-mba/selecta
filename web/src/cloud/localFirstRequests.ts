import { ApiError, type MixData, type Request } from '../api';
import type { RequestRow } from '../views/Requests';
import type { PlayableSong } from './localFirstMixes';

/** The requests route family of the local-first adapter (ADR-0462 "one adapter per route family"):
 * `/requests`, `/requests/consider`, `/requests/insert` and `/requests/{id}/add` as the shared
 * Request a song panel (views/Requests.tsx) asks them, answered in the browser.
 *
 * What a request is here, honestly: a song saved for later, by the member on this browser or by a
 * room guest the host accepted. Nothing in a browser library is measured for key or tempo, so
 * SelectaDJ cannot look for a spot where a request fits or a bridge song that leads to it, and a
 * request never joins the mix on its own. The host adds it, and it goes in right after the song
 * that is playing, with the browser's own blend. Bridges and hearing a request's transitions
 * ahead are refused with that reason.
 *
 * Where it is kept: this browser's own requests in localStorage per workspace, next to the
 * recipe store's current-mix pointer, so they survive a reload. Room requests stay on the server
 * (`/api/room-requests`, kept by the Cloud planner `BrowserPlanner`) and are told about on the
 * workspace event stream (`requests.room`), which CloudApp passes on as `ROOM_REQUEST_EVENT`.
 */

/** CloudApp dispatches this on `window` for each `requests.room` event on the workspace stream. */
export const ROOM_REQUEST_EVENT = 'selecta:room-request';

export const JOINS_BY_HAND = 'In your browser SelectaDJ can’t check which songs fit around a request, so it never joins on its own. While your mix plays, press Add to mix anyway and it plays right after the current song, with a browser blend.';
export const NOT_ON_THIS_DEVICE = 'This song isn’t on this device, so a browser mix can’t play it. Connect its file on this device first.';
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
/** Without an event, the room list is still asked again this often (the stream may be blocked). */
const ROOM_REFRESH_MS = 30_000;

const queueKey = (workspaceId: string) => `selecta-requests:${workspaceId}`;

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
export function requestsFamily({ cloud, workspaceId, songs, send }: {
  cloud: Request;
  workspaceId: string;
  songs: () => Promise<PlayableSong[]>;
  send: Request;
}): RequestsFamily {
  let rooms: Promise<RoomRequest[]> | null = null;
  let roomsAt = 0;
  let roomsVersion = -1;
  // the last request this browser put in the mix, so its Undo can take exactly that back out
  let lastJoin: { order: string; at: number } | null = null;

  const roomRequests = (): Promise<RoomRequest[]> => {
    if (!rooms || roomsVersion !== roomVersion || performance.now() - roomsAt > ROOM_REFRESH_MS) {
      roomsVersion = roomVersion;
      roomsAt = performance.now();
      // no Rooms here (off for this account, or not set up) is an empty list, not a broken panel
      rooms = cloud<{ requests: RoomRequest[] }>('/room-requests').then((answer) => answer.requests ?? []).catch(() => []);
    }
    return rooms;
  };
  const roomChanged = () => { rooms = null; };

  /** Every waiting request, this browser's own first, then the room's in the order they came. */
  const rows = async (): Promise<{ rows: RequestRow[]; saved: Saved; room: RoomRequest[] }> => {
    const [all, room] = await Promise.all([songs(), roomRequests()]);
    const saved = load(workspaceId);
    // a room request gets a number of its own here, kept so its row keeps its place on screen
    const kept: Record<string, number> = {};
    for (const asked of room) {
      kept[asked.id] = saved.room[asked.id] ?? saved.next++;
    }
    const changed = JSON.stringify(kept) !== JSON.stringify(saved.room);
    saved.room = kept;
    if (changed) save(workspaceId, saved);
    const row = (id: number, songId: number, from?: string): RequestRow => {
      const song = all.find((one) => one.id === songId);
      const where = from ? `Asked for in ${from}. ` : '';
      return {
        id, song_id: songId, title: song?.title ?? null, artist: song?.artist ?? null, status: 'waiting',
        // a song no longer in the catalogue really has gone from the library
        available: song ? 1 : 0,
        stage: song?.playable ? 'searching' : 'waiting',
        browser_note: `${where}${song?.playable ? JOINS_BY_HAND : NOT_ON_THIS_DEVICE}`,
      };
    };
    return {
      rows: [
        ...saved.local.map((asked) => row(asked.id, asked.song_id)),
        ...room.map((asked) => row(kept[asked.id], asked.song_id, asked.room_name)),
      ],
      saved,
      room,
    };
  };
  const list = async () => ({ requests: (await rows()).rows });

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
  const join = async (id: number, where: Where | undefined): Promise<MixData> => {
    const { rows: now } = await rows();
    const asked = now.find((row) => row.id === id);
    if (!asked) throw refuse('That request isn’t waiting any more.', 'no_request', 404);
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
    lastJoin = { order: changed.mix.map((item) => item.song_id).join(','), at };
    // it is in the mix now; a room that isn't told this time is told on the next look (settle)
    await finish(id, 'played').catch(() => undefined);
    return changed;
  };

  /** A look while the mix plays: requests whose song is in the mix now are done. Nothing is
   * offered to join on its own (`offer` stays empty), because nothing can say where it fits. */
  const consider = async (init?: RequestInit) => {
    const { order = [] } = bodyOf<Where>(init);
    const inMix = new Set(order);
    const { rows: now } = await rows();
    const settled: string[] = [];
    for (const row of now) {
      if (!inMix.has(row.song_id)) continue;
      if (await finish(row.id, 'played').catch(() => false)) settled.push(row.title ?? 'A requested song');
    }
    return { ...(await list()), settled };
  };

  const undo = (init?: RequestInit): Promise<MixData> | undefined => {
    let expected: string | null = null;
    try { expected = new Headers(init?.headers).get('x-mix-order'); } catch { /* no header */ }
    const last = lastJoin;
    // only the request this browser just added; any other undo is the mix family's to answer
    if (!last || expected !== last.order) return undefined;
    lastJoin = null;
    return send<MixData>(`/mix/songs/${last.at}`, { method: 'DELETE', headers: { 'x-mix-order': last.order } });
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
