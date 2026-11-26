import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Request } from '../api';
import { setFlags } from '../flags';
import { forgetAccountMeasured } from './accountFacts';
import { accountOrderPlanner, mergeOrder, ORDER_NEEDS, orderBody, type OrderPlanner } from './accountOrder';
import { CloudError } from './api';
import { mixFamily, type PlayableSong } from './deviceMusicMixes';
import { DEFAULT_STEERING, recipeStore } from './recipeStore';

// docs/engineering/device-to-account.md, "A mix's order": the account's answer orders the measured
// songs; unmeasured ones play after the planned run in today's order, the chosen start first and
// ending last; any failure or a slow answer keeps today's order.

type Call = { method: string; path: string; body?: Record<string, unknown> };

function fakeAccount(measured: number[], answer: (body: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ method, path, body });
    if (method === 'GET' && path.startsWith('/song-facts?')) return { songs: measured.map((song_id) => ({ song_id, implementation: 'web-dsp-1', source: 'device' })) } as T;
    if (method === 'POST' && path === '/planning/order') {
      const made = answer(body!);
      if (made instanceof Error) throw made;
      return made as T;
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { request, calls, orders: () => calls.filter((call) => call.path === '/planning/order') };
}

const steering = { ...DEFAULT_STEERING, mix_language: 'seamless', stems: 'never', energy_arc: [20, 80, 40] };

beforeEach(() => {
  forgetAccountMeasured();
  setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
});
afterEach(() => {
  setFlags(null);
  window.localStorage.clear();
});

describe('placing the planned run among the chosen songs', () => {
  it('keeps the chosen start first and the ending last, the planned run next, the rest in today\'s order', () => {
    // today's order: 1 (start), 2..9, 10 (ending); 3 and 8 aren't measured
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const planned = [1, 9, 4, 2, 7, 6, 5, 10];
    expect(mergeOrder(ids, planned, { start: 1, end: 10 })).toEqual([1, 9, 4, 2, 7, 6, 5, 3, 8, 10]);
  });

  it('never drops, repeats or invents a song', () => {
    const ids = [5, 6, 7, 8];
    expect(mergeOrder(ids, [8, 8, 99, 6], { start: null, end: null })).toEqual([8, 6, 5, 7]);
  });

  it('asks with the measured songs and the member\'s choices the planner understands', () => {
    expect(orderBody([1, 2, 3, 4, 5, 6], { start: 1, end: 9, steering })).toEqual({
      songs: [1, 2, 3, 4, 5, 6], idea: 'pick', count: 6, start: 1, language: 'seamless', stems: 'never', energy_arc: [20, 80, 40],
    });
    // the browser's own "any" and "auto" mean the planner's defaults, so they aren't sent
    expect(orderBody([1, 2], { start: null, end: null, steering: DEFAULT_STEERING })).toEqual({ songs: [1, 2], idea: 'pick', count: 2 });
  });
});

describe('the order from the account', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];

  it('uses the account\'s answer, placing unmeasured songs by today\'s rule', async () => {
    const account = fakeAccount([1, 2, 4, 5, 6, 7, 8], () => ({ order: [1, 7, 5, 2, 6, 4, 8] }));
    const order = await accountOrderPlanner(account.request, 'ws-1')(ids, { start: 1, end: 8, steering });
    expect(order).toEqual([1, 7, 5, 2, 6, 4, 3, 8]);
    expect(account.orders()[0].body).toMatchObject({ songs: [1, 2, 4, 5, 6, 7, 8], start: 1, end: 8 });
  });

  it('leaves a Never play start out of the request, and keeps it first', async () => {
    const account = fakeAccount(ids, () => ({ order: [8, 7, 6, 5, 4, 3, 2] }));
    const order = await accountOrderPlanner(account.request, 'ws-1')(ids, { start: 1, end: null, steering, never: new Set([1]) });
    expect(account.orders()[0].body).not.toHaveProperty('start');
    expect((account.orders()[0].body as { songs: number[] }).songs).not.toContain(1);
    expect(order).toEqual([1, 8, 7, 6, 5, 4, 3, 2]);
  });

  it(`keeps today's order with fewer than ${ORDER_NEEDS} measured songs, without asking to plan`, async () => {
    const account = fakeAccount([1, 2, 3], () => ({ order: [3, 2, 1] }));
    expect(await accountOrderPlanner(account.request, 'ws-1')(ids, { start: null, end: null, steering })).toBeNull();
    expect(account.orders()).toEqual([]);
  });

  it('keeps today\'s order when the account refuses', async () => {
    const account = fakeAccount(ids, () => new CloudError('too few', 409, 'too_few_measured'));
    expect(await accountOrderPlanner(account.request, 'ws-1')(ids, { start: null, end: null, steering })).toBeNull();
  });

  it('keeps today\'s order when the answer is slower than the bound', async () => {
    const slow = (async <T,>(path: string): Promise<T> => {
      if (path.startsWith('/song-facts?')) return { songs: ids.map((song_id) => ({ song_id, implementation: 'web-dsp-1', source: 'device' })) } as T;
      return new Promise<T>(() => undefined);
    });
    const began = Date.now();
    expect(await accountOrderPlanner(slow, 'ws-1', 60)(ids, { start: null, end: null, steering })).toBeNull();
    expect(Date.now() - began).toBeLessThan(2_000);
  });

  it('asks nothing unless the server names both flags on', async () => {
    for (const flags of [{ 'cloud.brain': false, 'cloud.device_analysis': true }, { 'cloud.brain': true }, {}] as Record<string, boolean>[]) {
      setFlags(flags);
      const account = fakeAccount(ids, () => ({ order: ids }));
      expect(await accountOrderPlanner(account.request, 'ws-1')(ids, { start: null, end: null, steering })).toBeNull();
      expect(account.calls).toEqual([]);
    }
  });
});

describe('Make a Mix with the account\'s planner', () => {
  const songs: PlayableSong[] = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((title, index) => ({ id: index + 1, title, artist: 'Rex', duration: 200, playable: true }));

  function recipes() {
    const made: number[][] = [];
    const cloud = (async (path: string, init?: RequestInit) => {
      if (path === '/local-media/recipes' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { name: string; song_ids: number[] };
        made.push(body.song_ids);
        return { mix: { mix_id: 'm1', name: body.name, number: 1, parent: null, revision: 'r1', songs: body.song_ids.map((id) => ({ song_id: id, id: String(id), title: `Song ${id}`, artist: 'Rex', duration: 200, sha256: null, in_library: true, available_on: 1 })), seams: [] } };
      }
      throw new Error(`unexpected ${path}`);
    }) as Request;
    return { store: recipeStore(cloud, 'ws-mix'), made };
  }

  it('builds the mix in the planner\'s order, and in today\'s when the planner has none', async () => {
    const planned: OrderPlanner = async (ids) => [...ids].reverse();
    const one = recipes();
    await mixFamily(one.store, async () => songs, undefined, undefined, undefined, planned).answer('POST', '/vibes/pick/build', new URLSearchParams())!;
    expect(one.made[0]).toEqual([4, 3, 2, 1]);
    const two = recipes();
    await mixFamily(two.store, async () => songs, undefined, undefined, undefined, async () => null).answer('POST', '/vibes/pick/build', new URLSearchParams())!;
    expect(two.made[0]).toEqual([1, 2, 3, 4]);
    const three = recipes();
    await mixFamily(three.store, async () => songs, undefined, undefined, undefined, async () => { throw new Error('offline'); }).answer('POST', '/vibes/pick/build', new URLSearchParams())!;
    expect(three.made[0]).toEqual([1, 2, 3, 4]);
  });
});
