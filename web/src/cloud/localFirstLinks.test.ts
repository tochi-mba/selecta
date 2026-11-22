import { afterEach, describe, expect, it } from 'vitest';
import type { LinkList, MixData, Request } from '../api';
import { setFlags } from '../flags';
import { asLink, linksFamily, NO_PREVIEW_HERE, pairInto, type CloudLink } from './localFirstLinks';
import { localFirstRequest } from './localFirstRequest';
import type { PlayableSong } from './localFirstMixes';
import { recipeStore, WORKED_OUT_LIVE, type Recipe } from './recipeStore';

// Word connections in browser-first Cloud: links come from the Cloud API's lyric lookups, a pair
// puts two songs next to each other in the browser mix, and Undo takes back exactly that pair.

afterEach(() => {
  window.localStorage.clear();
  setFlags(null);
});

const cloudLink = (a: number, b: number, more: Partial<CloudLink> = {}): CloudLink => ({
  phrase: 'all night long', kind: 'echo', a, b, artist_a: 'Rex', title_a: `Song ${a}`, artist_b: 'Moon', title_b: `Song ${b}`,
  line_a: 'we danced all night long', line_b: 'all night long I waited', score: 0.9, moves: ['word_cut'], ...more,
});

function recipeOf(ids: number[], name: string, mix_id: string, turn: number): Recipe {
  return {
    mix_id, name, number: 1, parent: null, revision: `r${turn}`,
    songs: ids.map((id) => ({ song_id: id, id: String(id), title: `Song ${id}`, artist: 'Rex', duration: 200, sha256: null, in_library: true, available_on: 1 })),
    seams: ids.slice(1).map((_, index) => ({ into: index + 1, method: 'crossfade', bars: 0, basis: 'unanalysed', intelligent: false, reason: '' })),
  };
}

/** A fake Cloud: recipes kept by id as the server keeps them, and the lyric links route. */
function fakeCloud(links: CloudLink[] = [cloudLink(1, 2)]) {
  const kept = new Map<string, Recipe>();
  const calls: string[] = [];
  let made = 0;
  let turn = 0;
  const cloud = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    if (path.startsWith('/local-media/links')) {
      return { links, found: links.length, lyrics: { songs: 4, checked: 4, synced: 3, waiting: 0, looked_up: 4, looking_up: false } };
    }
    if (path === '/local-media/recipes' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { name: string; song_ids: number[] };
      made += 1;
      const recipe = recipeOf(body.song_ids, body.name, `mix-${made}`, turn += 1);
      kept.set(recipe.mix_id, recipe);
      return { mix: recipe };
    }
    const revised = /^\/local-media\/recipes\/([^/]+)\/revisions$/.exec(path);
    if (revised && method === 'POST') {
      const was = kept.get(revised[1])!;
      const body = JSON.parse(String(init?.body)) as { base_revision: string; song_ids?: number[] };
      if (body.base_revision !== was.revision) throw Object.assign(new Error('stale'), { status: 409 });
      const recipe = recipeOf(body.song_ids ?? was.songs.map((song) => song.song_id), was.name, was.mix_id, turn += 1);
      kept.set(recipe.mix_id, recipe);
      return { mix: recipe };
    }
    const one = /^\/local-media\/recipes\/([^/]+)$/.exec(path);
    if (one && method === 'DELETE') { kept.delete(one[1]); return {}; }
    if (one) {
      const recipe = kept.get(one[1]);
      if (!recipe) throw Object.assign(new Error('gone'), { status: 404 });
      return { mix: recipe };
    }
    throw new Error(`unexpected ${method} ${path}`);
  }) as Request;
  return { cloud, kept, calls };
}

const SONGS: PlayableSong[] = [1, 2, 3, 4].map((id) => ({ id, title: `Song ${id}`, artist: id % 2 ? 'Rex' : 'Moon', duration: 200, playable: id !== 4 }));

function family(links?: CloudLink[], withStore = true) {
  const fake = fakeCloud(links);
  const store = recipeStore(fake.cloud, 'ws-1');
  const made = linksFamily(fake.cloud, withStore ? store : undefined, async () => SONGS);
  const ask = <T,>(method: string, path: string, body?: unknown, order?: number[] | string) => {
    const [route, query = ''] = path.split('?');
    const headers = order === undefined ? undefined : { 'x-mix-order': typeof order === 'string' ? order : order.join(',') };
    return made.answer(method, route, new URLSearchParams(query), { method, body: body === undefined ? undefined : JSON.stringify(body), headers }) as Promise<T> | undefined;
  };
  const ids = (data: MixData) => data.mix.map((item) => item.song_id);
  return { ...fake, store, ask, ids };
}

describe('where a pair goes in the mix', () => {
  it('adds both at the end when neither is in the mix', () => {
    expect(pairInto([], 1, 2)).toEqual([1, 2]);
    expect(pairInto([7, 8], 1, 2)).toEqual([7, 8, 1, 2]);
  });

  it('puts the missing song beside the one already there, first song first', () => {
    expect(pairInto([7, 1, 8], 1, 2)).toEqual([7, 1, 2, 8]);
    expect(pairInto([7, 2, 8], 1, 2)).toEqual([7, 1, 2, 8]);
  });

  it('moves the second song up beside the first when both are there apart', () => {
    expect(pairInto([1, 7, 2], 1, 2)).toEqual([1, 2, 7]);
    expect(pairInto([2, 7, 1], 1, 2)).toEqual([7, 1, 2]);
    expect(pairInto([2, 1], 1, 2)).toEqual([1, 2]);
  });

  it('leaves a pair that is already together alone, and never changes what it was given', () => {
    const before = [7, 1, 2, 8];
    expect(pairInto(before, 1, 2)).toEqual([7, 1, 2, 8]);
    pairInto(before, 2, 8);
    expect(before).toEqual([7, 1, 2, 8]);
  });
});

describe('a Cloud link as the Links view reads it', () => {
  it('says nothing is rendered: the one move is the browser’s own, worked out live', () => {
    const link = asLink(cloudLink(1, 2));
    expect(link).toMatchObject({ phrase: 'all night long', a: 1, b: 2, title_a: 'Song 1', title_b: 'Song 2', line_b: 'all night long I waited', move: 'auto', moves: ['auto'], worked: true });
    expect(link.state).toEqual({ status: 'none', key: 'link:1:2', why: WORKED_OUT_LIVE });
    // the server's word-cut move is not offered: a browser does not cut on the shared word
    expect(link.moves).not.toContain('word_cut');
  });

  it('offers no move to choose with browser moves off', () => {
    setFlags({ 'cloud.browser_moves': false });
    expect(asLink(cloudLink(1, 2))).toMatchObject({ move: 'blend', moves: [] });
  });
});

describe('GET /links in the browser', () => {
  it('asks the Cloud lyric links route and reports nothing as prepared', async () => {
    const { ask, calls } = family([cloudLink(1, 2), cloudLink(3, 1)]);
    const list = await ask<LinkList>('GET', '/links?q=&limit=60')!;
    expect(list.prepared).toBe(0);
    expect(list.preparing).toBe(0);
    expect(list.links.map((link) => [link.a, link.b])).toEqual([[1, 2], [3, 1]]);
    expect(calls).toEqual(['GET /local-media/links?limit=60']);
  });

  it('passes the search and the song on, and keeps the limit within bounds', async () => {
    const { ask, calls } = family();
    await ask('GET', '/links?q=%20night%20&limit=9999&song=3');
    await ask('GET', '/links?limit=nonsense');
    expect(calls).toEqual(['GET /local-media/links?q=night&limit=200&song=3', 'GET /local-media/links?limit=60']);
  });
});

describe('pairing two songs into the browser mix', () => {
  it('starts a mix from the pair when there is none, named from its songs', async () => {
    const { ask, ids, store, kept } = family();
    const data = await ask<MixData>('POST', '/mix/pair', { a: 1, b: 2 })!;
    expect(ids(data)).toEqual([1, 2]);
    expect(data.can_undo).toBe(true);
    expect(store.current()).toBe('mix-1');
    expect(kept.get('mix-1')?.name).toBeTruthy();
  });

  it('adds the pair to the current mix, beside a song that is already in it', async () => {
    const { ask, ids, store } = family();
    store.setCurrent((await store.create('Friday', [3, 1])).mix_id);
    const data = await ask<MixData>('POST', '/mix/pair', { a: 1, b: 2 }, [3, 1])!;
    expect(ids(data)).toEqual([3, 1, 2]);
    expect(data.can_undo).toBe(true);
    expect(data.name).toBe('Friday');
  });

  it('changes nothing when the pair is already together', async () => {
    const { ask, ids, store, calls } = family();
    store.setCurrent((await store.create('Friday', [1, 2, 3])).mix_id);
    const data = await ask<MixData>('POST', '/mix/pair', { a: 1, b: 2 }, [1, 2, 3])!;
    expect(ids(data)).toEqual([1, 2, 3]);
    expect(calls.some((call) => call.endsWith('/revisions'))).toBe(false);
    // nothing was changed, so there is nothing of this family's to undo
    expect(ask('POST', '/mix/undo')).toBeUndefined();
  });

  it('refuses a pair that is not two different songs', async () => {
    const { ask } = family();
    await expect(ask('POST', '/mix/pair', { a: 1, b: 1 })).rejects.toMatchObject({ code: 'bad_pair', status: 400 });
    await expect(ask('POST', '/mix/pair', { a: 1 })).rejects.toMatchObject({ code: 'bad_pair' });
  });

  it('refuses a song this device cannot play, and makes no mix', async () => {
    const { ask, kept } = family();
    await expect(ask('POST', '/mix/pair', { a: 1, b: 4 })).rejects.toMatchObject({ code: 'not_playable', message: expect.stringMatching(/need to play on this device/) });
    await expect(ask('POST', '/mix/pair', { a: 99, b: 1 })).rejects.toMatchObject({ code: 'not_playable' });
    expect(kept.size).toBe(0);
  });

  it('refuses a press made against a mix that has changed since', async () => {
    const { ask, store, kept } = family();
    // the card was drawn against a mix, but there is none now
    await expect(ask('POST', '/mix/pair', { a: 1, b: 2 }, [3])).rejects.toMatchObject({ code: 'mix_changed', status: 409 });
    store.setCurrent((await store.create('Friday', [3, 1])).mix_id);
    await expect(ask('POST', '/mix/pair', { a: 1, b: 2 }, [1, 3])).rejects.toMatchObject({ code: 'mix_changed', status: 409 });
    expect(kept.get('mix-1')?.songs.map((song) => song.song_id)).toEqual([3, 1]);
  });

  it('says there is nowhere to keep a mix when the shell has no recipe store', async () => {
    const { ask } = family(undefined, false);
    await expect(ask('POST', '/mix/pair', { a: 1, b: 2 })).rejects.toMatchObject({ code: 'flag_off', status: 404 });
  });

  it('leaves a pair meant for a draft to the rest of the adapter', () => {
    const { ask } = family();
    expect(ask('POST', '/mix/pair?draft=7', { a: 1, b: 2 })).toBeUndefined();
  });
});

describe('undoing a pair', () => {
  it('answers only after a pair was made here', () => {
    const { ask } = family();
    expect(ask('POST', '/mix/undo')).toBeUndefined();
  });

  it('puts the mix back as it was before the pair, once', async () => {
    const { ask, ids, store } = family();
    store.setCurrent((await store.create('Friday', [3, 1])).mix_id);
    await ask('POST', '/mix/pair', { a: 1, b: 2 }, [3, 1]);
    const back = await ask<MixData>('POST', '/mix/undo', undefined, [3, 1, 2])!;
    expect(ids(back)).toEqual([3, 1]);
    expect(ask('POST', '/mix/undo')).toBeUndefined();
  });

  it('lets go of the mix the pair itself made, and only that', async () => {
    const { ask, store, kept } = family();
    await ask('POST', '/mix/pair', { a: 1, b: 2 });
    const back = await ask<MixData>('POST', '/mix/undo')!;
    expect(back).toEqual({ mix: [], name: 'Current mix', can_undo: false });
    expect(store.current()).toBeNull();
    expect(kept.size).toBe(0);
  });

  it('refuses when the mix has changed since, rather than take back more than the pair', async () => {
    const { ask, store, kept } = family();
    store.setCurrent((await store.create('Friday', [3, 1])).mix_id);
    await ask('POST', '/mix/pair', { a: 1, b: 2 }, [3, 1]);
    const now = kept.get('mix-1')!;
    await store.edit('mix-1', now.revision, { songIds: [3, 1, 2, 3] });
    await expect(ask('POST', '/mix/undo')).rejects.toMatchObject({ code: 'mix_changed', status: 409 });
    expect(kept.get('mix-1')?.songs.map((song) => song.song_id)).toEqual([3, 1, 2, 3]);
    // that refusal ends it: the next undo is somebody else's to answer
    expect(ask('POST', '/mix/undo')).toBeUndefined();
  });

  it('refuses an Undo pressed against an older drawing of the mix', async () => {
    const { ask, store } = family();
    store.setCurrent((await store.create('Friday', [3, 1])).mix_id);
    await ask('POST', '/mix/pair', { a: 1, b: 2 }, [3, 1]);
    await expect(ask('POST', '/mix/undo', undefined, [3, 1])).rejects.toMatchObject({ code: 'mix_changed' });
  });

  it('does not answer for a pair made in a different mix', async () => {
    const { ask, store } = family();
    await ask('POST', '/mix/pair', { a: 1, b: 2 });
    store.setCurrent((await store.create('Other', [3, 1])).mix_id);
    await expect(ask('POST', '/mix/undo')).rejects.toMatchObject({ code: 'nothing_to_undo', status: 409 });
  });
});

describe('what the links family refuses or leaves alone', () => {
  it('refuses transition previews with the reason', async () => {
    const { ask } = family();
    await expect(ask('POST', '/seams')).rejects.toMatchObject({ message: NO_PREVIEW_HERE, status: 404, code: 'flag_off' });
    await expect(ask('GET', '/seams/link:1:2/preview')).rejects.toMatchObject({ message: NO_PREVIEW_HERE });
  });

  it('answers nothing at all while discover.word_links is off', () => {
    setFlags({ 'discover.word_links': false });
    const { ask, calls } = family();
    for (const [method, path] of [['GET', '/links'], ['POST', '/mix/pair'], ['POST', '/mix/undo'], ['POST', '/seams']]) expect(ask(method, path, { a: 1, b: 2 })).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('leaves other routes to the rest of the adapter', () => {
    const { ask } = family();
    expect(ask('GET', '/mix')).toBeUndefined();
    expect(ask('GET', '/library')).toBeUndefined();
  });
});

describe('Word connections through the whole adapter', () => {
  it('lists links, pairs into the browser mix and takes the pair back', async () => {
    const fake = fakeCloud([cloudLink(1, 2)]);
    const cloud = (async (path: string, init?: RequestInit) => {
      if (path.startsWith('/local-media/songs')) return { songs: [1, 2, 3].map((id) => ({ id, title: `Song ${id}`, artist: 'Rex', duration_s: 100, available_on: 1 })) };
      return fake.cloud(path, init);
    }) as Request;
    const store = recipeStore(cloud, 'ws-1');
    const request = localFirstRequest(cloud, { recipes: store, here: async () => new Map([[1, 'here' as const], [2, 'here' as const], [3, 'here' as const]]) });
    expect((await request<LinkList>('/links?q=&limit=60')).links).toHaveLength(1);
    const paired = await request<MixData>('/mix/pair', { method: 'POST', body: JSON.stringify({ a: 1, b: 2 }) });
    expect(paired.mix.map((item) => item.song_id)).toEqual([1, 2]);
    expect((await request<MixData>('/mix')).mix).toHaveLength(2);
    const back = await request<MixData>('/mix/undo', { method: 'POST', headers: { 'x-mix-order': '1,2' } });
    expect(back.mix).toEqual([]);
    expect((await request<MixData>('/mix')).mix).toEqual([]);
  });
});
