import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MixData, MixItem, Request } from '../api';
import { setFlags } from '../flags';
import type { RequestRow } from '../views/Requests';
import type { PlayableSong } from './localFirstMixes';
import { requestsFamily } from './localFirstRequests';

// The member's own requests kept with the account (cloud.brain with cloud.account_mixes): asked,
// listed and let go through the account's request routes, the same on every device; when the
// account can't take them, this browser keeps them as before.

const SONGS: PlayableSong[] = [
  { id: 1, title: 'Alpha', artist: 'Rex', duration: 200, playable: true },
  { id: 2, title: 'Bravo', artist: 'Rex', duration: 200, playable: true },
  { id: 3, title: 'Charlie', artist: 'Moon', duration: 200, playable: true },
];
const item = (song_id: number, position: number) => ({ song_id, position, title: `Song ${song_id}`, artist: 'Rex' }) as unknown as MixItem;

beforeEach(() => setFlags({ 'cloud.brain': true, 'cloud.account_mixes': true }));
afterEach(() => { setFlags(null); window.localStorage.clear(); });

function family({ down = false, mix = [1] as number[] } = {}) {
  const state = { waiting: [] as { id: number; song_id: number }[], next: 40, mix: [...mix] };
  const calls: string[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    if (path === '/room-requests') return { requests: [] };
    if (down) throw Object.assign(new Error('offline'), { status: 0 });
    if (path === '/requests' && method === 'GET') return { requests: state.waiting.map((one) => ({ ...one, available: 1 })) };
    if (path === '/requests' && method === 'POST') {
      const { song_id } = JSON.parse(String(init?.body)) as { song_id: number };
      if (!state.waiting.some((one) => one.song_id === song_id)) state.waiting.push({ id: state.next++, song_id });
      return {};
    }
    const one = /^\/requests\/(\d+)$/.exec(path);
    if (one && method === 'DELETE') { state.waiting = state.waiting.filter((asked) => asked.id !== Number(one[1])); return {}; }
    throw new Error(`unexpected ${method} ${path}`);
  }) as Request;
  const send = (async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as { song_id: number; position: number } : undefined;
    if (path === '/mix/songs' && init?.method === 'POST') state.mix.splice(body!.position, 0, body!.song_id);
    return { mix: state.mix.map(item), name: 'Mix', can_undo: false } as MixData;
  }) as Request;
  const made = requestsFamily({ cloud, workspaceId: 'ws-1', songs: async () => SONGS, send });
  const ask = <T,>(method: string, route: string, body?: unknown) =>
    made.answer(method, route, new URLSearchParams(), { method, body: body === undefined ? undefined : JSON.stringify(body) }) as Promise<T>;
  const list = async () => (await ask<{ requests: RequestRow[] }>('GET', '/requests')).requests;
  return { ask, list, state, calls };
}

describe('requests kept with the account', () => {
  it('are asked for and listed by the account, so every device sees the same list', async () => {
    const { ask, list, state, calls } = family();
    await ask('POST', '/requests', { song_id: 2 });
    await ask('POST', '/requests', { song_id: 2 });
    expect(state.waiting).toEqual([{ id: 40, song_id: 2 }]);
    const [row] = await list();
    expect(row).toMatchObject({ song_id: 2, title: 'Bravo', status: 'waiting' });
    expect(calls).toContain('POST /requests');
    expect(window.localStorage.getItem('selecta-requests:ws-1')).not.toContain('"local":[{');
  });

  it('are let go on the account when dismissed or added next', async () => {
    const { ask, list, state, calls } = family();
    await ask('POST', '/requests', { song_id: 2 });
    await ask('POST', '/requests', { song_id: 3 });
    const [first, second] = await list();
    await ask('DELETE', `/requests/${first.id}`);
    expect(calls).toContain('DELETE /requests/40');
    const joined = await ask<MixData>('POST', `/requests/${second.id}/add`, { order: [1], position: 0 });
    expect(joined.mix.map((one) => one.song_id)).toEqual([1, 3]);
    expect(state.waiting).toEqual([]);
    expect(await list()).toEqual([]);
  });

  it('stay in this browser when the account cannot be reached', async () => {
    const { ask, list, state } = family({ down: true });
    await ask('POST', '/requests', { song_id: 2 });
    expect(state.waiting).toEqual([]);
    const [row] = await list();
    expect(row).toMatchObject({ song_id: 2, title: 'Bravo' });
  });

  it('ask nothing of the account while cloud.account_mixes is off', async () => {
    setFlags({ 'cloud.brain': true });
    const { ask, calls } = family();
    await ask('POST', '/requests', { song_id: 2 });
    expect(calls.filter((call) => call.includes('/requests') && !call.includes('room'))).toEqual([]);
  });
});
