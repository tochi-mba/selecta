import { afterEach, describe, expect, it } from 'vitest';
import type { MixData, MixItem, Request } from '../api';
import type { RequestRow } from '../views/Requests';
import type { PlayableSong } from './deviceMusicMixes';
import { requestsFamily, type RoomRequest } from './deviceMusicRequests';

// Add next reports a guest's request as played, so the guest's page says so. Undo took the song
// back out of the mix but left the room request played: the guest was told a song played that
// never did, and it was gone from the host's Ready to add.

afterEach(() => window.localStorage.clear());

const SONGS: PlayableSong[] = [1, 2, 3].map((id) => ({ id, title: `Song ${id}`, artist: 'Rex', duration: 200, playable: true }));
const item = (song_id: number, position: number) => ({ song_id, position, title: `Song ${song_id}`, artist: 'Rex' }) as unknown as MixItem;

function family(room: RoomRequest[], { roomDown = false } = {}) {
  const state = { mix: [1, 2], waiting: [...room], played: [] as RoomRequest[], down: roomDown };
  const calls: string[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/room-requests') return { requests: state.waiting };
    const told = /^\/room-requests\/([^/]+)\/(played|waiting)$/.exec(path);
    if (!told) throw new Error(`unexpected ${path}`);
    if (told[2] === 'waiting' && state.down) throw new Error('offline');
    const from = told[2] === 'played' ? state.waiting : state.played;
    const to = told[2] === 'played' ? state.played : state.waiting;
    const found = from.find((asked) => asked.id === told[1]);
    if (found) { from.splice(from.indexOf(found), 1); to.push(found); }
    return {};
  }) as Request;
  const send = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as { song_id: number; position: number } : undefined;
    if (path === '/mix/songs' && method === 'POST') state.mix.splice(body!.position, 0, body!.song_id);
    const removed = /^\/mix\/songs\/(\d+)$/.exec(path);
    if (removed && method === 'DELETE') state.mix.splice(Number(removed[1]), 1);
    return { mix: state.mix.map(item), name: 'Mix', can_undo: false } as MixData;
  }) as Request;
  const made = requestsFamily({ cloud, workspaceId: 'ws-undo', songs: async () => SONGS, send });
  const ask = <T,>(method: string, route: string, body?: unknown, order?: string) => made.answer(method, route, new URLSearchParams(), {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: order === undefined ? undefined : { 'x-mix-order': order },
  }) as Promise<T> | undefined;
  const list = async () => (await ask<{ requests: RequestRow[] }>('GET', '/requests')!).requests;
  return { ask, list, state, calls };
}

const guestAsked: RoomRequest = { id: 'rr-1', room_id: 'room-1', room_name: 'Friday room', song_id: 3, votes: 1, handed_at: null };

describe('Undo straight after Add next, for a guest’s request', () => {
  it('takes the song out of the mix and puts the room request back to waiting', async () => {
    const { ask, list, state, calls } = family([guestAsked]);
    const [row] = await list();
    await ask('POST', `/requests/${row.id}/add`, { order: [1, 2], position: 0 });
    expect(state.mix).toEqual([1, 3, 2]);
    expect(state.played.map((asked) => asked.id)).toEqual(['rr-1']);

    await ask('POST', '/mix/undo', undefined, '1,3,2');

    expect(state.mix).toEqual([1, 2]);
    expect(calls).toContain('POST /room-requests/rr-1/waiting');
    expect(state.played).toEqual([]);
    // it is back under Ready to add, at once
    expect((await list()).map((asked) => asked.room_request_id)).toEqual(['rr-1']);
  });

  it('still takes the song out when the room cannot be told', async () => {
    const { ask, list, state } = family([guestAsked], { roomDown: true });
    const [row] = await list();
    await ask('POST', `/requests/${row.id}/add`, { order: [1, 2], position: 0 });
    await ask('POST', '/mix/undo', undefined, '1,3,2');
    expect(state.mix).toEqual([1, 2]);
  });
});
