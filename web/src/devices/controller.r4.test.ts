import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixData, Request } from '../api';
import type { PlayableSong } from '../cloud/localFirstMixes';
import { requestsFamily, type RoomRequest } from '../cloud/localFirstRequests';
import type { RequestRow } from '../views/Requests';
import { addable, waitingCount } from '../rooms/useRoomSession';
import { needsFolderAgain, notHereWords, NOWHERE_NOW, onlyOn, whereHeldFrom, type ControllerLink, type DeviceHolding, type WhereHeld } from './controller';

// ADR-0475 R4, the rows that need every device's holdings: a song only another device has, a
// song only a device that is not open has, and a song no device has; and the counts that follow.

afterEach(() => window.localStorage.clear());

const device = (device_id: string, name: string, online: boolean, songs = 10): DeviceHolding => ({ device_id, name, online, songs, last_seen_at: 100, reported_at: 50 });
const DEVICES = [device('laptop', 'Laptop', true), device('tablet', 'Tablet', true, 3), device('old', 'Old phone', false), device('quiet', 'Quiet', true)];
const IDS = new Map<string, ReadonlySet<number>>([['laptop', new Set([1, 2, 3])], ['tablet', new Set([5])], ['old', new Set([6])]]);

describe('which other device holds a song', () => {
  const where = whereHeldFrom(DEVICES, IDS, ['laptop', null]);
  it('names open holders and holders that are away apart, leaving out this device and the speaker', () => {
    expect(where(5)).toEqual({ online: ['Tablet'], before: [] });
    expect(where(6)).toEqual({ online: [], before: ['Old phone'] });
    expect(where(1)).toEqual({ online: [], before: [] });
  });
  it('words each R4 row, and offers Connect music here only when no device has the file', () => {
    expect(notHereWords(where(5), 'Laptop')).toEqual({ note: onlyOn('Tablet', 'Laptop'), connectHere: false });
    expect(notHereWords(where(6), 'Laptop')).toEqual({ note: needsFolderAgain('Old phone'), connectHere: false });
    expect(notHereWords(where(7), 'Laptop')).toEqual({ note: NOWHERE_NOW, connectHere: true });
  });
});

const SONGS: PlayableSong[] = [1, 2, 3, 5, 6, 7].map((id) => ({ id, title: `Song ${id}`, artist: 'Rex', duration: 200, playable: false }));
const link = (): ControllerLink => ({ speakerName: 'Laptop', online: true, programme: [1, 2, 3], songIndex: 0, holds: new Set([1, 2, 3]), send: vi.fn(async () => true) });

function family(controller: ControllerLink | null, holders: WhereHeld | null, room: RoomRequest[] = []) {
  const cloud = (async (path: string) => {
    if (path === '/room-requests') return { requests: room };
    throw new Error(`unexpected ${path}`);
  }) as Request;
  const send = (async () => ({ mix: [], name: 'Mix', can_undo: false }) as MixData) as Request;
  const made = requestsFamily({ cloud, workspaceId: 'ws-r4', songs: async () => SONGS, send, controller: () => controller, holders: () => holders });
  const ask = <T,>(method: string, route: string, body?: unknown) => made.answer(method, route, new URLSearchParams(), { method, body: body === undefined ? undefined : JSON.stringify(body) }) as Promise<T>;
  const list = async () => (await ask<{ requests: RequestRow[] }>('GET', '/requests')).requests;
  return { ask, list };
}

describe('request rows judged by every device (R4)', () => {
  const where = whereHeldFrom(DEVICES, IDS, ['phone', 'laptop']);
  it('with the laptop playing: only on the tablet, needs its folder again, and on no device', async () => {
    const { ask, list } = family(link(), where);
    for (const song_id of [5, 6, 7]) await ask('POST', '/requests', { song_id });
    const rows = await list();
    expect(rows.map((row) => row.browser_note)).toEqual([onlyOn('Tablet', 'Laptop'), needsFolderAgain('Old phone'), NOWHERE_NOW]);
    expect(rows.map((row) => row.stage)).toEqual(['waiting', 'waiting', 'waiting']);
    expect(rows.map((row) => row.connect_here)).toEqual([false, false, true]);
  });

  it('with nothing playing and no music here: says where the song is and that the music starts there', async () => {
    const { ask, list } = family(null, whereHeldFrom(DEVICES, IDS, ['phone', null]));
    await ask('POST', '/requests', { song_id: 1 });
    const [row] = await list();
    expect(row.browser_note).toBe('Only on Laptop. Start the music there to add it.');
    expect(row.connect_here).toBe(false);
  });

  it('counts only rows that can be added from here; the rest wait on a device', async () => {
    const room = [{ id: 'r1', room_id: 'room', room_name: 'Room', song_id: 2, votes: 1, handed_at: null }, { id: 'r2', room_id: 'room', room_name: 'Room', song_id: 5, votes: 1, handed_at: null }];
    const { list } = family(link(), where, room);
    const rows = await list();
    const coming = [{ request_id: 'r1' }, { request_id: 'r2' }, { request_id: 'r3' }];
    expect(addable(coming, rows)).toEqual({ ready: 1, onTheWay: 1, onDevice: 1 });
    expect(waitingCount({ inbox: [], coming } as never, rows)).toBe(2);
  });
});

describe('R5: search results placed by the device that would play them', () => {
  it('puts songs the speaker can play first, then songs on another device, then none, and says where', async () => {
    const { mixFamily } = await import('../cloud/localFirstMixes');
    const store = { current: () => null, steering: () => ({}) } as never;
    const rank: Record<number, { rank: number; where: string | null }> = { 1: { rank: 2, where: 'On no device right now' }, 2: { rank: 1, where: 'Only on Tablet' }, 3: { rank: 0, where: 'Plays on Laptop' } };
    const family = mixFamily(store, async () => SONGS, () => true, (id) => rank[id] ?? { rank: 2, where: null });
    const found = await family.answer('GET', '/songs', new URLSearchParams({ q: 'song' })) as { id: number; where?: string }[];
    expect(found.slice(0, 3).map((song) => [song.id, song.where])).toEqual([[3, 'Plays on Laptop'], [2, 'Only on Tablet'], [1, 'On no device right now']]);
  });
});
