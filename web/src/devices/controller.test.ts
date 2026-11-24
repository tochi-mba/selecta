import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixData, Request } from '../api';
import type { PlayableSong } from '../cloud/localFirstMixes';
import { requestsFamily, type RoomRequest } from '../cloud/localFirstRequests';
import { mixFamily } from '../cloud/localFirstMixes';
import type { RecipeStore } from '../cloud/recipeStore';
import type { RequestRow } from '../views/Requests';
import { addedOnReturn, bestHolder, comingUp, musicHolder, notOnSpeaker, playsOn, programmeTurn, programmeWithNext, speakerHolds, type ControllerLink, type DeviceHolding } from './controller';

// ADR-0475, every device a controller: a device that is not the speaker adds requests to the
// speaker's programme, is judged by what the speaker can play, and searches the whole account.

afterEach(() => window.localStorage.clear());

const link = (over: Partial<ControllerLink> = {}): ControllerLink => ({
  speakerName: 'Laptop', online: true, programme: [1, 2, 3], songIndex: 1, holds: new Set([1, 2, 3, 5]), send: vi.fn(async () => true), ...over,
});

describe('the rules for changing another device’s programme', () => {
  it('puts a song right after the one that is playing and keeps the music where it is', () => {
    expect(programmeWithNext(link(), 5)).toEqual({ songs: [1, 2, 5, 3], song_index: 1, keep_position: true });
    expect(programmeWithNext(link({ songIndex: 9 }), 5)).toEqual({ songs: [1, 2, 3, 5], song_index: 2, keep_position: true });
  });

  it('knows what is still to come, and treats a speaker that has not reported as able to answer for itself', () => {
    expect(comingUp(link(), 3)).toBe(true);
    expect(comingUp(link(), 1)).toBe(false);
    expect(speakerHolds(link(), 4)).toBe(false);
    expect(speakerHolds(link({ holds: null }), 4)).toBe(true);
  });

  it('a speaker sends its own mix when that changed, and takes the session’s when only the session changed', () => {
    expect(programmeTurn([1, 2], [1, 2], null)).toBe('agree');
    expect(programmeTurn([1, 2], [], null)).toBe('publish');
    expect(programmeTurn([1, 2, 9], [1, 2], '1,2')).toBe('publish');
    expect(programmeTurn([1, 2], [1, 5, 2], '1,2')).toBe('adopt');
  });

  it('suggests the online device holding the most songs, never an offline or empty one', () => {
    const device = (id: string, songs: number, online: boolean, seen = 1): DeviceHolding => ({ device_id: id, name: id, last_seen_at: seen, online, songs, reported_at: songs ? 1 : null });
    expect(bestHolder([device('phone', 3, true), device('laptop', 12, true), device('tablet', 40, false)])?.device_id).toBe('laptop');
    expect(bestHolder([device('laptop', 12, true)], 'laptop')).toBeNull();
    expect(bestHolder([device('a', 5, true, 1), device('b', 5, true, 9)])?.device_id).toBe('b');
    expect(bestHolder([device('phone', 0, true)])).toBeNull();
  });
});

describe('which device to name as where the music is (R6)', () => {
  const device = (id: string, songs: number, online: boolean, seen = 1): DeviceHolding => ({ device_id: id, name: id, last_seen_at: seen, online, songs, reported_at: songs ? 1 : null });

  it('is the speaker when one is playing, else the open device with the most songs, else the one with the most that is away', () => {
    const all = [device('phone', 3, true), device('laptop', 2864, true), device('tablet', 5000, false)];
    expect(musicHolder(all, 'phone', 'tablet')?.device_id).toBe('tablet');
    expect(musicHolder(all, 'phone', null)?.device_id).toBe('laptop');
    expect(musicHolder([device('tablet', 5000, false), device('old', 10, false)], 'phone', null)?.device_id).toBe('tablet');
  });

  it('is never this device, and nobody when no other device holds music', () => {
    expect(musicHolder([device('phone', 3, true)], 'phone', null)).toBeNull();
    expect(musicHolder([device('phone', 3, true), device('laptop', 0, true)], 'phone', null)).toBeNull();
  });
});

const SONGS: PlayableSong[] = [
  { id: 1, title: 'Alpha', artist: 'Rex', duration: 200, playable: false },
  { id: 2, title: 'Bravo', artist: 'Rex', duration: 200, playable: false },
  { id: 3, title: 'Charlie', artist: 'Moon', duration: 200, playable: false },
  { id: 4, title: 'Delta', artist: 'Moon', duration: 200, playable: false },
  { id: 5, title: 'Echo', artist: 'Sun', duration: 200, playable: true },
];
const roomRequest = (id: string, song_id: number): RoomRequest => ({ id, room_id: 'room-1', room_name: 'Friday room', song_id, votes: 1, handed_at: null });

function controllerFamily(now: () => ControllerLink | null, room: RoomRequest[] = []) {
  const state = { room: [...room] };
  const cloudCalls: string[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    cloudCalls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/room-requests') return { requests: state.room };
    throw new Error(`unexpected ${path}`);
  }) as Request;
  const mixCalls: string[] = [];
  const send = (async (path: string) => { mixCalls.push(path); return { mix: [], name: 'Mix', can_undo: false } as MixData; }) as Request;
  const made = requestsFamily({ cloud, workspaceId: 'ws-1', songs: async () => SONGS, send, controller: now });
  const ask = <T,>(method: string, route: string, body?: unknown, order?: string) => made.answer(method, route, new URLSearchParams(), {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: order === undefined ? undefined : { 'x-mix-order': order },
  }) as Promise<T>;
  const list = async () => (await ask<{ requests: RequestRow[] }>('GET', '/requests')).requests;
  return { ask, list, cloudCalls, mixCalls };
}

describe('requests on a device that is not the speaker (R4)', () => {
  it('a song the speaker holds can be added from here, and says where it plays', async () => {
    const { ask, list } = controllerFamily(() => link());
    await ask('POST', '/requests', { song_id: 3 });
    const [row] = await list();
    expect(row).toMatchObject({ song_id: 3, stage: 'searching', plays_on: 'Laptop', where_note: playsOn('Laptop') });
  });

  it('a song the speaker does not hold is not offered, with the reason, even when this device holds it', async () => {
    const { ask, list } = controllerFamily(() => link({ holds: new Set([1, 2, 3]) }));
    await ask('POST', '/requests', { song_id: 5 });
    const [row] = await list();
    expect(row.stage).toBe('waiting');
    expect(row.browser_note).toBe(notOnSpeaker('Laptop'));
    expect(row.where_note).toBeUndefined();
    await expect(ask('POST', `/requests/${row.id}/add`)).rejects.toMatchObject({ code: 'not_on_speaker' });
  });

  it('says a request will be added on its return while the speaker is away', async () => {
    const { ask, list } = controllerFamily(() => link({ online: false }));
    await ask('POST', '/requests', { song_id: 5 });
    expect((await list())[0].where_note).toBe(addedOnReturn('Laptop'));
  });

  it('adding sends the speaker its programme with the song next, changes no mix here, and forgets this device’s own request', async () => {
    const sent = vi.fn(async () => true);
    const { ask, list, mixCalls } = controllerFamily(() => link({ send: sent }));
    await ask('POST', '/requests', { song_id: 5 });
    const [row] = await list();
    const answer = await ask<MixData>('POST', `/requests/${row.id}/add`);
    expect(sent).toHaveBeenCalledWith('set_programme', { songs: [1, 2, 5, 3], song_index: 1, keep_position: true });
    expect(answer.mix.map((item) => item.song_id)).toEqual([1, 2, 5, 3]);
    expect(mixCalls).toEqual([]);
    expect(await list()).toEqual([]);
  });

  it('a room request sent to the speaker is not marked added here: the speaker settles it, and it leaves this list meanwhile', async () => {
    const sent = vi.fn(async () => true);
    const { ask, list, cloudCalls } = controllerFamily(() => link({ send: sent }), [roomRequest('ask-1', 5)]);
    const [row] = await list();
    expect(row).toMatchObject({ song_id: 5, room_name: 'Friday room', where_note: playsOn('Laptop') });
    await ask('POST', `/requests/${row.id}/add`);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(cloudCalls.filter((call) => call.startsWith('POST /room-requests'))).toEqual([]);
    expect(await list()).toEqual([]);
    // a look while the speaker plays does not settle the room's request from this device either
    await ask('POST', '/requests/consider', { order: [1, 2, 5, 3], position: 1 });
    expect(cloudCalls.filter((call) => call.startsWith('POST /room-requests'))).toEqual([]);
  });

  it('keeps the request when the speaker does not take the change', async () => {
    const { ask, list } = controllerFamily(() => link({ send: vi.fn(async () => false) }));
    await ask('POST', '/requests', { song_id: 5 });
    const [row] = await list();
    await expect(ask('POST', `/requests/${row.id}/add`)).rejects.toMatchObject({ code: 'speaker_refused' });
    expect(await list()).toHaveLength(1);
  });

  it('Undo puts the speaker’s programme back without moving the music', async () => {
    const sent = vi.fn(async () => true);
    const { ask, list } = controllerFamily(() => link({ send: sent }));
    await ask('POST', '/requests', { song_id: 5 });
    await ask('POST', `/requests/${(await list())[0].id}/add`);
    await ask('POST', '/mix/undo', undefined, '1,2,5,3');
    expect(sent).toHaveBeenLastCalledWith('set_programme', { songs: [1, 2, 3], song_index: 1, keep_position: true });
  });
});

describe('search on a device that is not the speaker (R5)', () => {
  const store = { current: () => null, steering: () => ({}) } as unknown as RecipeStore;
  const search = async (everySong: boolean, q: string) => (await mixFamily(store, async () => SONGS, () => everySong)
    .answer('GET', '/songs', new URLSearchParams({ q }))) as { id: number }[];

  it('looks through the whole account library, this device’s own songs first', async () => {
    expect((await search(true, 'e'))[0].id).toBe(5);
    expect((await search(true, 'moon')).map((song) => song.id)).toEqual([3, 4]);
    expect((await search(true, 'alpha')).map((song) => song.id)).toEqual([1]);
  });

  it('with no other device playing it stays what this device can play, as before', async () => {
    expect((await search(false, 'alpha')).map((song) => song.id)).toEqual([]);
    expect((await search(false, 'echo')).map((song) => song.id)).toEqual([5]);
  });
});
