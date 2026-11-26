import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixData, Request } from '../api';
import { setFlags } from '../flags';
import type { RequestRow } from '../views/Requests';
import type { PlayableSong } from './localFirstMixes';
import { ACCOUNT_OFFER, accountPlacements, placingOn } from './accountPlacements';
import { bridgeWords, making, NO_BRIDGES, requestsFamily } from './localFirstRequests';
import { browserFlags } from './browserFlags';

// T-20261126-a246: the account plans where a request joins; this device makes the transitions it
// needs and, once the account calls it ready here, the request joins through /requests/insert.

const prepared = vi.hoisted(() => ({ calls: [] as { workspaceId: string; pairs: { a: number; b: number }[] }[] }));
vi.mock('./studioWiring', () => ({
  prepareRequestSeams: async (workspaceId: string, pairs: { a: number; b: number }[]) => {
    prepared.calls.push({ workspaceId, pairs });
    return pairs.length;
  },
}));

const ON = { 'cloud.brain': true, 'cloud.account_mixes': true, 'cloud.device_render': true, 'cloud.device_analysis': true, 'requests.bridges': true };
const SONGS: PlayableSong[] = [1, 2, 3, 9].map((id) => ({ id, title: `Song ${id}`, artist: 'Rex', duration: 200, playable: true }));
const PLAYBACK = { order: [1, 2, 3], position: 0, phase: 'playing', seconds_left: 90 };
const OFFER = 'b'.repeat(64);

beforeEach(() => {
  prepared.calls = [];
  setFlags(ON);
  localStorage.setItem('selecta.device.ws-1', 'dev-1');
});
afterEach(() => {
  setFlags(null);
  localStorage.clear();
});

function rig(placement: Record<string, unknown>) {
  const calls: { path: string; body: unknown }[] = [];
  const mix: MixData = { mix: [], name: 'Mix', can_undo: true };
  const cloud = (async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === '/room-requests') return { requests: [] };
    if (path === '/requests' && !init?.method) return { requests: [{ id: 41, song_id: 9, available: 1 }] };
    if (path.startsWith('/requests/consider')) return { requests: [{ id: 41, song_id: 9, ...placement }], settled: [] };
    if (path.startsWith('/requests/insert')) return mix;
    if (/^\/requests\/41\/bridge$/.test(path)) return { requests: [{ id: 41, song_id: 9, available: 1 }] };
    if (path === '/requests/41/bridges') return { options: [{ songs: [{ id: 3 }, { id: 9 }], song_ids: [3, 9], transitions: [{ from: 'Song 1', to: 'Song 3', a: 1, b: 3, status: 'none' }] }], looked_at: 4, direct: false, capped: false };
    throw new Error(`unexpected ${path}`);
  }) as Request;
  const send = (async () => mix) as Request;
  const family = requestsFamily({ cloud, workspaceId: 'ws-1', songs: async () => SONGS, send });
  const consider = async () => (await family.answer('POST', '/requests/consider', new URLSearchParams(), { method: 'POST', body: JSON.stringify(PLAYBACK) }) as { requests: RequestRow[] }).requests;
  return { calls, family, consider, mix };
}

describe('a request the account found a place for', () => {
  it('asks this device to make the transitions it needs, and says so on the row', async () => {
    const { consider, calls } = rig({ stage: 'preparing', ready: false, offer: OFFER, after: 'Song 1', seams_needed: [{ a: 1, b: 9, settings: {} }, { a: 9, b: 2, settings: {} }] });
    const [row] = await consider();
    expect(calls[0]).toEqual({ path: '/requests/consider?device_id=dev-1', body: PLAYBACK });
    expect(prepared.calls).toEqual([{ workspaceId: 'ws-1', pairs: [{ a: 1, b: 9 }, { a: 9, b: 2 }] }]);
    expect(row).toMatchObject({ song_id: 9, where_note: making('Song 1') });
    expect(row.ready).toBeFalsy();
  });

  it('offers a ready placement, and joins it through the account with the device named', async () => {
    const { consider, family, calls, mix } = rig({ stage: 'ready', ready: true, offer: OFFER, after: 'Song 1', seams_needed: [] });
    const [row] = await consider();
    expect(row).toMatchObject({ ready: true, offer: `${ACCOUNT_OFFER}${OFFER}` });
    const joined = await family.answer('POST', '/requests/insert', new URLSearchParams(), { method: 'POST', body: JSON.stringify({ ...PLAYBACK, offer: row.offer }) });
    expect(joined).toBe(mix);
    expect(calls.at(-1)).toEqual({ path: '/requests/insert?device_id=dev-1', body: { ...PLAYBACK, offer: OFFER } });
  });

  it('leaves a placement that needs an extra song to the member', async () => {
    const { consider } = rig({ stage: 'approve', ready: false, offer: OFFER, needs_approval: true, seams_needed: [] });
    const [row] = await consider();
    expect(row.ready).toBeFalsy();
    expect(row.where_note).toBeUndefined();
  });

  it('asks nothing of the account without the transitions flag or a registered device', async () => {
    setFlags({ ...ON, 'cloud.device_render': false });
    expect(placingOn()).toBe(false);
    const { consider, calls } = rig({ stage: 'ready', ready: true, offer: OFFER });
    const [row] = await consider();
    expect(row.ready).toBeFalsy();
    expect(calls.some((call) => call.path.startsWith('/requests/consider'))).toBe(false);
    setFlags(ON);
    localStorage.removeItem('selecta.device.ws-1');
    expect(await accountPlacements((async () => ({})) as Request, 'ws-1').look(PLAYBACK)).toBeNull();
  });

  it('never sends a look the account would refuse: a stopped mix asks nothing', async () => {
    const cloud = vi.fn(async () => ({})) as unknown as Request;
    expect(await accountPlacements(cloud, 'ws-1').look({ ...PLAYBACK, phase: 'stopped' })).toBeNull();
    expect(cloud).not.toHaveBeenCalled();
  });
});

describe('a bridge the account found for a request (T-20261126-ae4f)', () => {
  const ROUTE = [{ id: 3, title: 'Song 3', artist: 'Rex' }, { id: 9, title: 'Song 9', artist: 'Rex' }];

  it('is offered to agree to when every song of it plays here, and the answer goes to the account', async () => {
    const { consider, family, calls } = rig({ stage: 'approve', ready: false, offer: OFFER, needs_approval: true, after: 'Song 1', route: ROUTE, seams_needed: [] });
    const [row] = await consider();
    expect(row).toMatchObject({ needs_approval: true, route: ROUTE, where_note: bridgeWords(ROUTE, 'Song 1') });
    // nothing is made ahead before the member agrees
    expect(prepared.calls).toEqual([{ workspaceId: 'ws-1', pairs: [] }]);
    const answer = await family.answer('POST', `/requests/${row.id}/bridge`, new URLSearchParams(), { method: 'POST', body: JSON.stringify({ allow: true, songs: [3, 9] }) }) as { requests: RequestRow[] };
    expect(calls.at(-2)).toEqual({ path: '/requests/41/bridge', body: { allow: true, songs: [3, 9] } });
    // the list comes back in this browser's numbering
    expect(answer.requests[0].id).toBe(row.id);
  });

  it('is not offered when a bridge song does not play on this device', async () => {
    const { consider } = rig({ stage: 'approve', needs_approval: true, route: [{ id: 7, title: 'Song 7' }, { id: 9, title: 'Song 9' }], seams_needed: [] });
    const [row] = await consider();
    expect(row.needs_approval).toBeFalsy();
  });

  it('searching every song for one asks the account over the songs that play here', async () => {
    const { consider, family, calls } = rig({ stage: 'searching' });
    const [row] = await consider();
    const found = await family.answer('POST', `/requests/${row.id}/bridges`, new URLSearchParams(), { method: 'POST', body: JSON.stringify({ order: [1, 2, 3], position: 0 }) }) as { options: { transitions: unknown[] }[]; looked_at: number };
    expect(calls.at(-1)).toEqual({ path: '/requests/41/bridges', body: { order: [1, 2, 3], position: 0, songs: [1, 2, 3, 9] } });
    // its transitions are made on this device once one is chosen, so none is offered to hear first
    expect(found.options[0].transitions).toEqual([]);
    expect(found.looked_at).toBe(4);
    await expect(family.answer('POST', '/requests/77/bridges', new URLSearchParams(), { method: 'POST' })).rejects.toMatchObject({ message: NO_BRIDGES });
    expect(browserFlags(false)['requests.bridges']).toBe(false);
    expect(browserFlags(false, false, { placing: true })['requests.bridges']).toBeUndefined();
  });
});
