import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixData, MixItem, Request } from '../api';
import type { RequestRow } from '../views/Requests';
import { requestWords } from '../views/Requests';
import type { PlayableSong } from './localFirstMixes';
import {
  JOINS_BY_HAND, NO_BRIDGES, NO_MIX_YET, NOT_ON_THIS_DEVICE, NOTHING_TO_HEAR, requestsFamily, ROOM_REQUEST_EVENT, type RoomRequest,
} from './localFirstRequests';

// Request a song in browser-first Cloud: a queue kept in this browser, joined by hand right after
// the song that is playing. Nothing is measured here, so bridges and previews are refused.

afterEach(() => window.localStorage.clear());

const SONGS: PlayableSong[] = [
  { id: 1, title: 'Alpha', artist: 'Rex', duration: 200, playable: true },
  { id: 2, title: 'Bravo', artist: 'Rex', duration: 200, playable: true },
  { id: 3, title: 'Charlie', artist: 'Moon', duration: 200, playable: true },
  { id: 4, title: 'Delta', artist: 'Moon', duration: 200, playable: false },
  { id: 5, title: 'Echo', artist: 'Sun', duration: 200, playable: true },
];
const roomRequest = (id: string, song_id: number, room_name = 'Friday room'): RoomRequest => ({ id, room_id: 'room-1', room_name, song_id, votes: 1, handed_at: null });
const item = (song_id: number, position: number) => ({ song_id, position, title: `Song ${song_id}`, artist: 'Rex' }) as unknown as MixItem;

function family({ mix = [] as number[], room = [] as RoomRequest[], roomFails = false, workspaceId = 'ws-1', songs = SONGS } = {}) {
  const state = { mix: [...mix], room: [...room], songs };
  const cloudCalls: string[] = [];
  const sent: { path: string; method: string; order: string | null; body: unknown }[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    cloudCalls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/room-requests') {
      if (roomFails) throw new Error('Rooms are off');
      return { requests: state.room };
    }
    const done = /^\/room-requests\/([^/]+)\/(played|dismiss)$/.exec(path);
    if (done) { state.room = state.room.filter((asked) => asked.id !== decodeURIComponent(done[1])); return {}; }
    throw new Error(`unexpected ${path}`);
  }) as Request;
  const data = (): MixData => ({ mix: state.mix.map(item), name: 'Mix', can_undo: false });
  const send = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as { song_id: number; position: number } : undefined;
    sent.push({ path, method, order: new Headers(init?.headers).get('x-mix-order'), body });
    if (path === '/mix/songs' && method === 'POST') state.mix.splice(body!.position, 0, body!.song_id);
    const removed = /^\/mix\/songs\/(\d+)$/.exec(path);
    if (removed && method === 'DELETE') state.mix.splice(Number(removed[1]), 1);
    return data();
  }) as Request;
  const made = requestsFamily({ cloud, workspaceId, songs: async () => state.songs, send });
  const ask = <T,>(method: string, route: string, body?: unknown, order?: string) => made.answer(method, route, new URLSearchParams(), {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: order === undefined ? undefined : { 'x-mix-order': order },
  }) as Promise<T> | undefined;
  const list = async () => (await ask<{ requests: RequestRow[] }>('GET', '/requests')!).requests;
  const request = async (songId: number) => (await ask<{ requests: RequestRow[] }>('POST', '/requests', { song_id: songId })!).requests;
  return { ask, list, request, state, cloudCalls, sent };
}

describe('asking for a song in the browser', () => {
  it('keeps the request waiting and says in its own words that it joins by hand', async () => {
    const { request } = family();
    const [row] = await request(2);
    expect(row).toMatchObject({ song_id: 2, title: 'Bravo', artist: 'Rex', status: 'waiting', available: 1, stage: 'searching', browser_note: JOINS_BY_HAND });
    expect(requestWords(row, 'searching')).toEqual({ label: 'Add it yourself', tone: 'quiet', detail: JOINS_BY_HAND });
    expect(requestWords(row, 'no_mix').label).toBe('Waiting for a mix');
  });

  it('says a song that is not on this device cannot play here', async () => {
    const { request } = family();
    const [row] = await request(4);
    expect(row).toMatchObject({ available: 1, stage: 'waiting', browser_note: NOT_ON_THIS_DEVICE });
    expect(requestWords(row, 'waiting')).toMatchObject({ label: 'Requested · waiting', detail: NOT_ON_THIS_DEVICE });
  });

  it('never keeps the same song twice, and refuses a song that is not in the library', async () => {
    const { request } = family();
    await request(2);
    expect(await request(2)).toHaveLength(1);
    expect((await request(3)).map((row) => row.song_id)).toEqual([2, 3]);
    await expect(request(99)).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('survives a reload, per workspace', async () => {
    const first = family();
    await first.request(2);
    await first.request(3);
    const again = family();
    const rows = await again.list();
    expect(rows.map((row) => row.song_id)).toEqual([2, 3]);
    // a row keeps its number, so it keeps its place on screen
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    expect(await family({ workspaceId: 'ws-other' }).list()).toEqual([]);
  });

  it('marks a request whose song has left the library as gone', async () => {
    const one = family();
    await one.request(2);
    const [row] = await family({ songs: SONGS.filter((song) => song.id !== 2) }).list();
    expect(row).toMatchObject({ song_id: 2, title: null, available: 0, stage: 'waiting' });
  });

  it('starts empty when what was kept cannot be read', async () => {
    window.localStorage.setItem('selecta-requests:ws-1', '{not json');
    expect(await family().list()).toEqual([]);
    window.localStorage.setItem('selecta-requests:ws-1', JSON.stringify({ next: 4, local: [{ id: 'x', song_id: 2 }, { id: 3, song_id: 3, at: 1 }] }));
    expect((await family().list()).map((row) => [row.id, row.song_id])).toEqual([[3, 3]]);
  });
});

describe('adding a request to the mix', () => {
  it('goes in right after the song that is playing, guarded by the mix order', async () => {
    const { request, ask, sent, state, list } = family({ mix: [1, 3, 5] });
    const [row] = await request(2);
    const changed = await ask<MixData>('POST', `/requests/${row.id}/add`, { order: [1, 3, 5], position: 0 })!;
    expect(changed.mix.map((song) => song.song_id)).toEqual([1, 2, 3, 5]);
    expect(state.mix).toEqual([1, 2, 3, 5]);
    expect(sent.find((call) => call.path === '/mix/songs')).toMatchObject({ method: 'POST', order: '1,3,5', body: { song_id: 2, position: 1 } });
    // it is in the mix now, so it is no longer waiting
    expect(await list()).toEqual([]);
  });

  it('goes at the end when nothing says which song is playing', async () => {
    const { request, ask, state } = family({ mix: [1, 3] });
    const [row] = await request(2);
    await ask('POST', `/requests/${row.id}/add`);
    expect(state.mix).toEqual([1, 3, 2]);
  });

  it('joins the same way through the insert route the playing mix uses', async () => {
    const { request, ask, state } = family({ mix: [1, 3, 5] });
    const [row] = await request(2);
    await ask('POST', '/requests/insert', { offer: `request-${row.id}`, order: [1, 3, 5], position: 1 });
    expect(state.mix).toEqual([1, 3, 2, 5]);
    await expect(ask('POST', '/requests/insert', { offer: 'prepared' })).rejects.toMatchObject({ code: 'no_request', status: 404 });
  });

  it('refuses when no mix is playing, and keeps the request', async () => {
    const { request, ask, list, sent } = family({ mix: [] });
    const [row] = await request(2);
    await expect(ask('POST', `/requests/${row.id}/add`)).rejects.toMatchObject({ message: NO_MIX_YET, code: 'no_mix', status: 409 });
    expect(sent.some((call) => call.path === '/mix/songs')).toBe(false);
    expect(await list()).toHaveLength(1);
  });

  it('refuses a request that is not waiting any more', async () => {
    const { ask } = family({ mix: [1, 3] });
    await expect(ask('POST', '/requests/41/add')).rejects.toMatchObject({ code: 'no_request', status: 404 });
  });

  it('never joins on its own: a look while the mix plays offers nothing, and settles what is in the mix', async () => {
    const { request, ask } = family({ mix: [1, 3] });
    await request(2);
    await request(3);
    const looked = await ask<{ requests: RequestRow[]; settled: string[]; offer?: unknown }>('POST', '/requests/consider', { order: [1, 3], position: 0 })!;
    expect(looked.settled).toEqual(['Charlie']);
    expect(looked.requests.map((row) => row.song_id)).toEqual([2]);
    expect(looked.requests.some((row) => row.ready || row.offer)).toBe(false);
  });

  it('takes its own join back out with Undo, and leaves any other undo alone', async () => {
    const { request, ask, state, sent } = family({ mix: [1, 3, 5] });
    const [row] = await request(2);
    // nothing joined yet: not this family's undo
    expect(ask('POST', '/mix/undo', undefined, '1,3,5')).toBeUndefined();
    await ask('POST', `/requests/${row.id}/add`, { order: [1, 3, 5], position: 0 });
    // an undo drawn against some other order is the mix's own
    expect(ask('POST', '/mix/undo', undefined, '1,3,5')).toBeUndefined();
    const back = await ask<MixData>('POST', '/mix/undo', undefined, '1,2,3,5')!;
    expect(back.mix.map((song) => song.song_id)).toEqual([1, 3, 5]);
    expect(state.mix).toEqual([1, 3, 5]);
    expect(sent[sent.length - 1]).toMatchObject({ path: '/mix/songs/1', method: 'DELETE', order: '1,2,3,5' });
    // once
    expect(ask('POST', '/mix/undo', undefined, '1,2,3,5')).toBeUndefined();
  });

  it('forgets a request the member cancels', async () => {
    const { request, ask } = family();
    const [row] = await request(2);
    expect(await ask('DELETE', `/requests/${row.id}`)!).toEqual({ requests: [], cancelled: true });
  });
});

describe('what a browser cannot do with a request', () => {
  it('refuses bridge songs and hearing ahead, each with its reason', async () => {
    const { ask } = family();
    await expect(ask('GET', '/requests/1/bridges')).rejects.toMatchObject({ message: NO_BRIDGES, code: 'flag_off' });
    await expect(ask('POST', '/requests/1/bridge')).rejects.toMatchObject({ message: NO_BRIDGES });
    await expect(ask('POST', '/requests/1/hear')).rejects.toMatchObject({ message: NOTHING_TO_HEAR, code: 'flag_off' });
    await expect(ask('POST', '/requests/1/priority')).rejects.toMatchObject({ status: 404, code: 'flag_off' });
  });

  it('leaves routes that are not requests to the rest of the adapter', () => {
    const { ask } = family();
    expect(ask('GET', '/mix')).toBeUndefined();
    expect(ask('GET', '/requestsx')).toBeUndefined();
    expect(ask('GET', '/library')).toBeUndefined();
  });
});

describe('room requests the host accepted', () => {
  it('lists them after this browser’s own, saying which room asked', async () => {
    const { request, list } = family({ room: [roomRequest('rr-1', 3), roomRequest('rr-2', 4, 'Bar')] });
    await request(2);
    const rows = await list();
    expect(rows.map((row) => row.song_id)).toEqual([2, 3, 4]);
    expect(rows[1]).toMatchObject({ browser_note: JOINS_BY_HAND, room_name: "Friday room" });
    expect(rows[2]).toMatchObject({ browser_note: NOT_ON_THIS_DEVICE, room_name: "Bar" });
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  });

  it('keeps each room request’s number across reads and reloads', async () => {
    const room = [roomRequest('rr-1', 3), roomRequest('rr-2', 5)];
    const first = await family({ room }).list();
    const again = await family({ room: [...room].reverse() }).list();
    expect(Object.fromEntries(again.map((row) => [row.song_id, row.id]))).toEqual(Object.fromEntries(first.map((row) => [row.song_id, row.id])));
  });

  it('does not ask for a song a room already asked for a second time', async () => {
    const { request } = family({ room: [roomRequest('rr-1', 3)] });
    expect(await request(3)).toHaveLength(1);
  });

  it('shows a newly accepted room request and adds it through the existing Requests UI', async () => {
    const { ask, list, state, sent, cloudCalls } = family({ mix: [1, 2] });
    expect(await list()).toEqual([]);
    state.room.push(roomRequest('room-accepted', 3, 'Tochi\'s Crib'));
    window.dispatchEvent(new CustomEvent(ROOM_REQUEST_EVENT, { detail: { action: 'pending' } }));
    const [newRequest] = await list();
    expect(newRequest).toMatchObject({ song_id: 3, title: 'Charlie', stage: 'searching' });
    expect(newRequest.room_name).toContain("Crib");
    expect(sent).toHaveLength(0); // nothing enters playback merely because the room accepted it

    await ask('POST', `/requests/${newRequest.id}/add`, { order: [1, 2], position: 0 });
    expect(state.mix).toEqual([1, 3, 2]);
    expect(cloudCalls).toContain('POST /room-requests/room-accepted/played');
    expect(await list()).toEqual([]);
  });

  it('tells the room when its request joins the mix', async () => {
    const { ask, list, cloudCalls, state } = family({ mix: [1, 2], room: [roomRequest('rr 1', 3)] });
    const [row] = await list();
    await ask('POST', `/requests/${row.id}/add`, { order: [1, 2], position: 0 });
    expect(state.mix).toEqual([1, 3, 2]);
    expect(cloudCalls).toContain('POST /room-requests/rr%201/played');
    expect(await list()).toEqual([]);
  });

  it('tells the room when the host turns its request down', async () => {
    const { ask, list, cloudCalls } = family({ room: [roomRequest('rr-1', 3)] });
    const [row] = await list();
    expect(await ask('DELETE', `/requests/${row.id}`)!).toEqual({ requests: [], cancelled: true });
    expect(cloudCalls).toContain('POST /room-requests/rr-1/dismiss');
  });

  it('asks the server again only when the event stream says a room request changed', async () => {
    const { list, cloudCalls, state } = family({ room: [roomRequest('rr-1', 3)] });
    await list();
    await list();
    expect(cloudCalls.filter((call) => call === 'GET /room-requests')).toHaveLength(1);
    state.room.push(roomRequest('rr-2', 5));
    window.dispatchEvent(new CustomEvent(ROOM_REQUEST_EVENT, { detail: { action: 'pending' } }));
    expect((await list()).map((row) => row.song_id)).toEqual([3, 5]);
    expect(cloudCalls.filter((call) => call === 'GET /room-requests')).toHaveLength(2);
  });

  it('asks again after a while even with no event, in case the stream is blocked', async () => {
    const clock = vi.spyOn(performance, 'now');
    try {
      clock.mockReturnValue(1000);
      const { list, cloudCalls } = family({ room: [roomRequest('rr-1', 3)] });
      await list();
      clock.mockReturnValue(1000 + 5_000);
      await list();
      expect(cloudCalls.filter((call) => call === 'GET /room-requests')).toHaveLength(1);
      clock.mockReturnValue(1000 + 7_000);
      await list();
      expect(cloudCalls.filter((call) => call === 'GET /room-requests')).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('shows this browser’s own requests when Rooms cannot be asked', async () => {
    const { request } = family({ roomFails: true });
    expect((await request(2)).map((row) => row.song_id)).toEqual([2]);
  });
});
