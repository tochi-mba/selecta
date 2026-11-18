import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixData, Request, SongRow, Status, VibeCard } from '../api';
import { BROWSER_MIX_NEEDS, chooseSongs, mixFamily, pickCard, type PlayableSong } from './localFirstMixes';
import { localFirstRequest } from './localFirstRequest';
import { asMixData, DEFAULT_STEERING, recipeStore, WORKED_OUT_LIVE, type Recipe } from './recipeStore';

// BF-0462-05: Make a Mix, MixSetup and My Mixes in local-first Cloud, against the recipe store.
// Recipes live on the server (portable across devices); this browser keeps only which recipe is
// its current mix and the shaping choices, per workspace, in localStorage.

afterEach(() => window.localStorage.clear());

const playable = (id: number, title: string, plays = true): PlayableSong => ({ id, title, artist: 'Rex', duration: 200, playable: plays });

function recipeOf(ids: number[], name = 'Mix', mix_id = 'm1'): Recipe {
  return {
    mix_id, name, number: 1, parent: null, revision: `r-${ids.join('-')}`,
    songs: ids.map((id) => ({ song_id: id, id: String(id), title: `Song ${id}`, artist: 'Rex', duration: 200, sha256: null, in_library: true, available_on: 1 })),
    seams: ids.slice(1).map((_, index) => ({ into: index + 1, method: 'crossfade', bars: 0, basis: 'unanalysed', intelligent: false, reason: '' })),
  };
}

/** A fake Cloud that keeps recipes the way the server does: by id, with a list. */
function fakeCloud() {
  const kept = new Map<string, Recipe>();
  let made = 0;
  const calls: string[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/local-media/recipes' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string; song_ids: number[] };
      made += 1;
      const recipe = recipeOf(body.song_ids, body.name, `mix-${made}`);
      kept.set(recipe.mix_id, recipe);
      return { mix: recipe };
    }
    const one = /^\/local-media\/recipes\/([^/]+)$/.exec(path);
    if (one) {
      const recipe = kept.get(decodeURIComponent(one[1]));
      if (!recipe) throw Object.assign(new Error('gone'), { status: 404 });
      return { mix: recipe };
    }
    if (path.startsWith('/local-media/songs')) {
      return { songs: [
        { id: 1, title: 'Alpha', artist: 'Rex', duration_s: 100, available_on: 1 },
        { id: 2, title: 'Bravo', artist: 'Rex', duration_s: 120, available_on: 1 },
        { id: 3, title: 'Charlie', artist: 'Rex', duration_s: 140, available_on: 1 },
      ] };
    }
    throw new Error(`unexpected ${path}`);
  }) as Request;
  return { cloud, kept, calls };
}

describe('the browser mix choice', () => {
  it('plays only what this device can play, start first and the chosen ending last', () => {
    const songs = [playable(1, 'Charlie'), playable(2, 'Alpha'), playable(3, 'Bravo'), playable(4, 'Delta', false)];
    expect(chooseSongs(songs, 10)).toEqual([2, 3, 1]);
    expect(chooseSongs(songs, 10, { start: 1 })).toEqual([1, 2, 3]);
    expect(chooseSongs(songs, 10, { start: 2, end: 3 })).toEqual([2, 1, 3]);
    expect(chooseSongs(songs, 2)).toEqual([2, 3]);
    // a song that cannot play here is never chosen, even when asked for
    expect(chooseSongs(songs, 10, { start: 4 })).toEqual([2, 3, 1]);
  });

  it('offers one honest idea that says how its transitions are made', () => {
    const card = pickCard([playable(1, 'A'), playable(2, 'B', false)]);
    expect(card).toMatchObject({ key: 'pick', songs: 1, ready: false, needs: BROWSER_MIX_NEEDS - 1 });
    expect(card.blurb).toContain(WORKED_OUT_LIVE);
    expect(pickCard([playable(1, 'A'), playable(2, 'B')]).ready).toBe(true);
  });
});

describe('the recipe store', () => {
  it('turns a recipe into the views’ current mix without claiming tempo or key', () => {
    const data = asMixData(recipeOf([4, 5, 6], 'Friday'));
    expect(data.name).toBe('Friday');
    expect(data.mix.map((item) => item.song_id)).toEqual([4, 5, 6]);
    expect(data.mix.every((item) => item.bpm === null && item.key === null)).toBe(true);
    expect(data.mix[0].seam).toBeNull();
    expect(data.mix[1].seam?.state.why).toBe(WORKED_OUT_LIVE);
  });

  it('keeps the current mix and the shaping per workspace, and survives storage refusing', () => {
    const { cloud } = fakeCloud();
    const one = recipeStore(cloud, 'ws-1');
    const other = recipeStore(cloud, 'ws-2');
    one.setCurrent('mix-9');
    one.setSteering({ ...DEFAULT_STEERING, target: '3' });
    expect(one.current()).toBe('mix-9');
    expect(other.current()).toBeNull();
    expect(other.steering()).toEqual(DEFAULT_STEERING);
    const refuse = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      expect(one.current()).toBeNull();
      expect(one.steering()).toEqual(DEFAULT_STEERING);
    } finally { refuse.mockRestore(); }
  });
});

describe('Make a Mix, MixSetup and My Mixes through the adapted request', () => {
  const adapted = () => {
    const fake = fakeCloud();
    const store = recipeStore(fake.cloud, 'ws-1');
    const request = localFirstRequest(fake.cloud, { here: async () => new Map([[1, 'here'], [2, 'here'], [3, 'here']]), recipes: store });
    return { ...fake, store, request };
  };

  it('builds a recipe on the server, makes it the current mix, and reads it back after a reload', async () => {
    const { request, kept, calls } = adapted();
    const cards = await request<VibeCard[]>('/vibes');
    expect(cards.map((card) => card.key)).toEqual(['pick']);
    expect(cards[0].ready).toBe(true);
    const made = await request<MixData>('/vibes/pick/build?count=20', { method: 'POST', body: '{}' });
    expect(made.mix.map((item) => item.title)).toEqual(['Song 1', 'Song 2', 'Song 3']);
    expect(kept.size).toBe(1);
    expect(calls).toContain('POST /local-media/recipes');

    // a new page (a reload, another tab) with the same storage finds the same mix
    const again = localFirstRequest(fakeCloudWith(kept), { recipes: recipeStore(fakeCloudWith(kept), 'ws-1') });
    const current = await again<MixData>('/mix');
    expect(current.mix.map((item) => item.song_id)).toEqual([1, 2, 3]);
  });

  it('starts from the song the Library asked for, and ends where MixSetup chose', async () => {
    const { request } = adapted();
    const ends = await request<SongRow[]>('/songs?q=alp&state=ready&limit=20');
    expect(ends.map((song) => song.title)).toEqual(['Alpha']);
    const steering = await request<Status['steering']>('/steer', { method: 'POST', body: JSON.stringify({ action: 'take_me_to', value: '1' }) });
    expect(steering.target).toBe('1');
    expect((await request<Status>('/status')).steering.target_label).toBe('Alpha by Rex');
    const made = await request<MixData>('/vibes/pick/build?count=20&start=3', { method: 'POST', body: '{}' });
    expect(made.mix.map((item) => item.song_id)).toEqual([3, 2, 1]);
  });

  it('counts the songs that play here as ready, and refuses what it cannot keep', async () => {
    const { request } = adapted();
    expect((await request<Status>('/status')).counts.ready).toBe(3);
    await expect(request('/vibes/pick/build?count=20&as_draft=true', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'flag_off' });
    await expect(request('/mix?draft=4')).rejects.toMatchObject({ code: 'flag_off' });
  });

  it('a current mix whose recipe is gone is let go of, not shown as broken', async () => {
    const { request, store } = adapted();
    store.setCurrent('mix-gone');
    await expect(request('/mix')).rejects.toBeTruthy();
    expect(store.current()).toBeNull();
    expect((await request<MixData>('/mix')).mix).toEqual([]);
  });

  it('needs two songs it can play before it makes a mix', async () => {
    const fake = fakeCloud();
    const request = localFirstRequest(fake.cloud, { here: async () => new Map([[1, 'here']]), recipes: recipeStore(fake.cloud, 'ws-1') });
    await expect(request('/vibes/pick/build?count=20', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'not_enough_songs' });
    expect(fake.kept.size).toBe(0);
  });
});

function fakeCloudWith(kept: Map<string, Recipe>): Request {
  return (async (path: string) => {
    const one = /^\/local-media\/recipes\/([^/]+)$/.exec(path);
    if (one && kept.has(one[1])) return { mix: kept.get(one[1]) };
    if (path.startsWith('/local-media/songs')) return { songs: [] };
    throw new Error(`unexpected ${path}`);
  }) as Request;
}

// keep the shape check honest: a family that does not own a route says so
it('a route the mix family does not own falls through to the rest of the adapter', () => {
  const family = mixFamily(recipeStore(fakeCloud().cloud, 'ws'), async () => []);
  expect(family.answer('GET', '/library', new URLSearchParams())).toBeUndefined();
});
