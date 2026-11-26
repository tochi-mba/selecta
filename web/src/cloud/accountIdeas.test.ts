import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Request, VibeCard } from '../api';
import { setFlags } from '../flags';
import { forgetAccountMeasured } from './accountFacts';
import { accountIdeas, ideaSongs } from './accountIdeas';
import { mixFamily, type PlayableSong } from './localFirstMixes';
import { feelFor } from './mixFeel';
import { DEFAULT_STEERING, type RecipeStore } from './recipeStore';

// T-20261126-408d: the account's idea cards join the browser's own on Make a Mix, and one builds
// as the Desktop builds it: the planner picks and orders the songs.

const SONGS: PlayableSong[] = Array.from({ length: 8 }, (_, at) => ({ id: at + 1, title: `Song ${String.fromCharCode(72 - at)}`, artist: 'Rex', duration: 200, playable: at !== 7 }));
const card = (key: string): VibeCard => ({ key, name: key === 'late' ? 'Late night' : 'Pick', blurb: '', group: 'Mood', family: null, songs: 6, ready: true, needs: 0, artists: [], tempo: null, moves: 'Smooth blends', basis: [], seconds: 900 });

function account(calls: { path: string; body: unknown }[], fail = false) {
  return (async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path.startsWith('/song-facts')) return { songs: SONGS.map((song) => ({ song_id: song.id, implementation: 'web-dsp-1', source: 'device' })) };
    if (fail) throw new Error('offline');
    if (path === '/planning/ideas') return { ideas: [card('pick'), card('late')] };
    if (path === '/planning/order') return { idea: 'late', name: 'Late night', order: [7, 5, 3, 1] };
    throw new Error(path);
  }) as Request;
}

beforeEach(() => {
  forgetAccountMeasured();
  setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
});
afterEach(() => {
  setFlags(null);
  localStorage.clear();
});

describe('the account\'s idea cards', () => {
  it('are asked over the playable measured songs, by title, and the browser keeps its own pick card', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const cards = await accountIdeas(account(calls), 'ws-1').cards(SONGS, 'seamless');
    expect(cards.map((one) => one.key)).toEqual(['late']);
    const asked = calls.find((call) => call.path === '/planning/ideas');
    expect(asked?.body).toEqual({ songs: ideaSongs(SONGS, new Map(SONGS.map((song) => [song.id, {}]))), language: 'seamless' });
    // not playable here: never sent
    expect((asked?.body as { songs: number[] }).songs).not.toContain(8);
  });

  it('build a mix the planner picks and orders, named after the idea, with its feel kept', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const planned = await accountIdeas(account(calls), 'ws-1').order('late', SONGS, { start: null, end: null, steering: { ...DEFAULT_STEERING, mix_language: 'punchy' } }, 20);
    expect(planned).toEqual({ ids: [7, 5, 3, 1], name: 'Late night' });
    expect(calls.find((call) => call.path === '/planning/order')?.body).toMatchObject({ idea: 'late', count: 20, language: 'punchy' });
    expect(feelFor('ws-1', 7, 5)).toBe('punchy');
  });

  it('give nothing with planning off or the account away, and Make a Mix shows the browser card alone', async () => {
    expect(await accountIdeas(account([], true), 'ws-1').cards(SONGS)).toEqual([]);
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': false });
    const calls: { path: string; body: unknown }[] = [];
    expect(await accountIdeas(account(calls), 'ws-1').cards(SONGS)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('join the browser card on Make a Mix, and an idea builds through the planner', async () => {
    const created: { name: string; ids: number[] }[] = [];
    const store = {
      current: () => null, setCurrent: () => {}, steering: () => DEFAULT_STEERING, setSteering: () => {},
      create: async (name: string, ids: number[]) => { created.push({ name, ids }); return { mix_id: 'm1', name, revision: 'r1', number: 1, seams: [], songs: ids.map((song_id) => ({ song_id, title: 'A', artist: 'Rex', duration: 1 })) }; },
    } as unknown as RecipeStore;
    const family = mixFamily(store, async () => SONGS, undefined, undefined, undefined, undefined, undefined, accountIdeas(account([]), 'ws-1'));
    const cards = await family.answer('GET', '/vibes', new URLSearchParams()) as VibeCard[];
    expect(cards.map((one) => one.key)).toEqual(['pick', 'late']);
    await family.answer('POST', '/vibes/late/build', new URLSearchParams(), { method: 'POST' });
    expect(created).toEqual([{ name: 'Late night', ids: [7, 5, 3, 1] }]);
  });

  it('are asked over every measured song that plays here, past 60, up to the server bound', () => {
    const many = Array.from({ length: 300 }, (_, at) => ({ id: at + 1, title: `Song ${String(at + 1).padStart(3, '0')}`, playable: true }));
    const measured = new Map(many.map((song) => [song.id, {}]));
    expect(ideaSongs(many, measured)).toHaveLength(300);
    expect(ideaSongs([...many, { id: 999, title: 'Elsewhere', playable: false }], measured)).toHaveLength(300);
  });
});
