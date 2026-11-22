import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixData, Request, SongRow, Status, VibeCard } from '../api';
import { BROWSER_MIX_NEEDS, chooseSongs, mixFamily, mixNameFor, pickCard, PICK_NAME, type PlayableSong } from './localFirstMixes';
import { localFirstRequest } from './localFirstRequest';
import { setFlags } from '../flags';
import { asMixData, DEFAULT_STEERING, PICKED_LIVE, recipeStore, WORKED_OUT_LIVE, type Recipe } from './recipeStore';

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
    const revised = /^\/local-media\/recipes\/([^/]+)\/revisions$/.exec(path);
    if (revised && init?.method === 'POST') {
      const was = kept.get(decodeURIComponent(revised[1]))!;
      const body = JSON.parse(String(init.body)) as { base_revision: string; song_ids?: number[]; seam_moves?: Record<string, string | null> };
      if (body.base_revision !== was.revision) throw Object.assign(new Error('stale'), { status: 409 });
      const recipe = { ...recipeOf(body.song_ids ?? was.songs.map((song) => song.song_id), was.name, was.mix_id) };
      // as the server keeps them: by seam, with no move meaning SelectaDJ picks
      for (const [into, move] of Object.entries(body.seam_moves ?? {})) {
        const at = recipe.seams.findIndex((seam) => seam.into === Number(into));
        recipe.seams[at] = { ...recipe.seams[at], ...(move ? { settings: { move } } : {}) };
        recipe.revision += `:${into}=${move}`;
      }
      kept.set(recipe.mix_id, recipe);
      return { mix: recipe };
    }
    const copied = /^\/local-media\/recipes\/([^/]+)\/duplicate$/.exec(path);
    if (copied && init?.method === 'POST') {
      const was = kept.get(decodeURIComponent(copied[1]))!;
      const body = JSON.parse(String(init.body)) as { name?: string };
      made += 1;
      const recipe = recipeOf(was.songs.map((song) => song.song_id), body.name ?? `${was.name} copy`, `mix-${made}`);
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

describe('a saved browser mix's name', () => {
  const song = (id: number, title: string): PlayableSong => ({ id, title, artist: 'A', duration: 200, playable: true });
  const songs = [song(1, 'Ocean'), song(2, 'Obvious'), song(3, 'Counting the Days')];

  it('names a mix after its first and last songs, so different mixes read differently', () => {
    expect(mixNameFor(songs, [1, 2, 3])).toBe('Ocean to Counting the Days');
    expect(mixNameFor(songs, [3, 1])).toBe('Counting the Days to Ocean');
  });

  it('keeps the general name only when it cannot name the songs, and stays short', () => {
    expect(mixNameFor(songs, [])).toBe(PICK_NAME);
    expect(mixNameFor(songs, [9, 1])).toBe(PICK_NAME);
    const long = [song(4, 'x'.repeat(60)), song(5, 'y'.repeat(60))];
    expect(mixNameFor(long, [4, 5]).length).toBeLessThanOrEqual(80);
  });
});

describe('the recipe store', () => {
  it('turns a recipe into the views’ current mix without claiming tempo or key', () => {
    const data = asMixData(recipeOf([4, 5, 6], 'Friday'));
    expect(data.name).toBe('Friday');
    expect(data.mix.map((item) => item.song_id)).toEqual([4, 5, 6]);
    expect(data.mix.every((item) => item.bpm === null && item.key === null)).toBe(true);
    expect(data.mix[0].seam).toBeNull();
    // SelectaDJ picks each move as it plays (cloud.browser_moves), and says so before it has
    expect(data.mix[1].seam).toMatchObject({ settings: { move: 'auto' }, state: { status: 'none', label: 'Picked as it plays', why: PICKED_LIVE } });
  });

  it('keeps a chosen move on its seam, and every seam a plain browser blend with the flag off', () => {
    const recipe = recipeOf([4, 5, 6]);
    recipe.seams[1] = { ...recipe.seams[1], settings: { move: 'echo_out' } };
    expect(asMixData(recipe).mix[2].seam).toMatchObject({ settings: { move: 'echo_out' }, state: { label: 'Echo out' } });
    setFlags({ 'cloud.browser_moves': false });
    try {
      const off = asMixData(recipe);
      expect(off.mix.slice(1).map((item) => item.seam?.settings.move)).toEqual(['blend', 'blend']);
      expect(off.mix[2].seam?.state).toMatchObject({ label: 'Browser blend', why: WORKED_OUT_LIVE });
    } finally {
      setFlags(null);
    }
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
    await expect(request('/mix?draft=4')).rejects.toMatchObject({ code: 'flag_off' });
  });

  it('saves a draft to My Mixes without touching the current mix, as local mode does', async () => {
    const { request, store, kept } = adapted();
    const made = await request<{ name: string; count: number }>('/vibes/pick/build?count=20&as_draft=true', { method: 'POST', body: '{}' });
    expect(made).toMatchObject({ count: 3 });
    expect(kept.size).toBe(1);
    expect(store.current()).toBeNull();
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

describe('the Edit page on a browser mix (editor parity with local mode)', () => {
  const editing = async () => {
    const fake = fakeCloud();
    const store = recipeStore(fake.cloud, 'ws-1');
    const request = localFirstRequest(fake.cloud, { here: async () => new Map([[1, 'here'], [2, 'here'], [3, 'here']]), recipes: store });
    await request<MixData>('/vibes/pick/build?count=20', { method: 'POST', body: '{}' });
    const order = (data: MixData) => data.mix.map((item) => item.song_id);
    const guard = (ids: number[]) => ({ 'x-mix-order': ids.join(',') });
    return { ...fake, store, request, order, guard };
  };

  it('reorders, removes and adds songs as new revisions of the same recipe', async () => {
    const { request, order, guard, kept, store } = await editing();
    const moved = await request<MixData>('/mix/move', { method: 'POST', body: JSON.stringify({ source: 0, target: 2 }), headers: guard([1, 2, 3]) });
    expect(order(moved)).toEqual([2, 3, 1]);
    const removed = await request<MixData>('/mix/songs/1', { method: 'DELETE', headers: guard([2, 3, 1]) });
    expect(order(removed)).toEqual([2, 1]);
    const added = await request<MixData>('/mix/songs', { method: 'POST', body: JSON.stringify({ song_id: 3, position: 0 }), headers: guard([2, 1]) });
    expect(order(added)).toEqual([3, 2, 1]);
    expect(kept.size).toBe(1);
    expect(store.current()).toBe('mix-1');
    // every transition still says how it is made, and nothing claims an undo the browser lacks
    expect(added.can_undo).toBe(false);
    expect(added.mix[1].seam?.state).toMatchObject({ status: 'none', why: PICKED_LIVE });
  });

  it('refuses a press made against a mix that has since changed, and keeps two songs at least', async () => {
    const { request, guard } = await editing();
    await expect(request('/mix/move', { method: 'POST', body: JSON.stringify({ source: 0, target: 1 }), headers: guard([3, 2, 1]) })).rejects.toMatchObject({ code: 'mix_changed' });
    await request('/mix/songs/0', { method: 'DELETE', headers: guard([1, 2, 3]) });
    await expect(request('/mix/songs/0', { method: 'DELETE', headers: guard([2, 3]) })).rejects.toMatchObject({ code: 'too_few_songs' });
  });

  it('suggests only songs that play here and are not already in the mix', async () => {
    const { request, guard } = await editing();
    await request('/mix/songs/1', { method: 'DELETE', headers: guard([1, 2, 3]) });
    const { songs } = await request<{ songs: { song_id: number; analysed: boolean; bpm: number | null }[] }>('/mix/suggest?position=1&q=&limit=8');
    expect(songs).toEqual([expect.objectContaining({ song_id: 2, analysed: true, bpm: null })]);
  });

  it('chooses the move into a song, and lets SelectaDJ pick again', async () => {
    const { request, guard } = await editing();
    const chosen = await request<MixData>('/mix/2/seam', { method: 'POST', body: JSON.stringify({ move: 'reverb_wash' }), headers: guard([1, 2, 3]) });
    expect(chosen.mix[2].seam).toMatchObject({ settings: { move: 'reverb_wash' }, state: { label: 'Reverb wash' } });
    expect(chosen.mix[1].seam?.settings.move).toBe('auto');
    const again = await request<MixData>('/mix/2/seam', { method: 'POST', body: JSON.stringify({ move: 'auto' }), headers: guard([1, 2, 3]) });
    expect(again.mix[2].seam?.settings.move).toBe('auto');
    // a move the browser can't play, or one whose flag is off, is refused rather than guessed at
    await expect(request('/mix/2/seam', { method: 'POST', body: JSON.stringify({ move: 'word_cut' }), headers: guard([1, 2, 3]) })).rejects.toMatchObject({ code: 'move_unavailable' });
    setFlags({ 'move.echo_out': false });
    try {
      await expect(request('/mix/1/seam', { method: 'POST', body: JSON.stringify({ move: 'echo_out' }), headers: guard([1, 2, 3]) })).rejects.toMatchObject({ code: 'move_unavailable' });
    } finally {
      setFlags(null);
    }
    await expect(request('/mix/0/seam', { method: 'POST', body: JSON.stringify({ move: 'cut_on_one' }), headers: guard([1, 2, 3]) })).rejects.toMatchObject({ code: 'mix_changed' });
  });

  it('clears the current mix but keeps its recipe, and saves a named copy', async () => {
    const { request, guard, kept, store } = await editing();
    expect(await request('/drafts', { method: 'POST', body: JSON.stringify({ name: 'Friday', copy_current: true }) })).toEqual({ name: 'Friday' });
    expect([...kept.values()].map((recipe) => recipe.name)).toContain('Friday');
    expect(store.current()).toBe('mix-1');
    const empty = await request<MixData>('/mix/clear', { method: 'POST', headers: guard([1, 2, 3]) });
    expect(empty.mix).toEqual([]);
    expect(store.current()).toBeNull();
    expect(kept.has('mix-1')).toBe(true);
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
