import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixData, MixItem, Request } from '../api';
import { setFlags } from '../flags';
import { accountOrderPlanner } from './accountOrder';
import { DEFAULT_STEERING } from './recipeStore';
import { feelFor, FEEL_PAIRS_KEPT, rememberFeel } from './mixFeel';
import { withMeasured } from './deviceMusicRequest';
import { planningCalls } from './studioWiring';

// T-20261126-6f97: a mix ordered in a transition feel has its transitions made in that feel, and
// a mix already made keeps its own. T-20261126-bfec: the mix rows carry the account's energy.

afterEach(() => {
  localStorage.clear();
  setFlags(null);
});

describe('the transition feel a mix was made with', () => {
  it('is kept for each of its pairs, and forgotten for those pairs when a mix is made with none', () => {
    rememberFeel('ws-1', [1, 2, 3], 'punchy');
    expect(feelFor('ws-1', 1, 2)).toBe('punchy');
    expect(feelFor('ws-1', 2, 3)).toBe('punchy');
    expect(feelFor('ws-1', 3, 1)).toBeNull();
    expect(feelFor('ws-2', 1, 2)).toBeNull();
    rememberFeel('ws-1', [2, 3], 'any');
    expect(feelFor('ws-1', 2, 3)).toBeNull();
    expect(feelFor('ws-1', 1, 2)).toBe('punchy');
  });

  it('keeps at most so many pairs, the newest', () => {
    const order = Array.from({ length: FEEL_PAIRS_KEPT + 11 }, (_, at) => at + 1);
    rememberFeel('ws-1', order, 'seamless');
    expect(feelFor('ws-1', 1, 2)).toBeNull();
    expect(feelFor('ws-1', order.length - 1, order.length)).toBe('seamless');
  });

  it('is remembered when the account orders a mix in it', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
    const ids = [1, 2, 3, 4, 5, 6];
    const request = (async (path: string) => {
      if (path.startsWith('/song-facts')) return { songs: ids.map((song_id) => ({ song_id, implementation: 'web-dsp-1', source: 'device' })) };
      if (path === '/planning/order') return { order: [6, 5, 4, 3, 2, 1] };
      throw new Error(path);
    }) as Request;
    const order = await accountOrderPlanner(request, 'ws-1')(ids, { start: null, end: null, steering: { ...DEFAULT_STEERING, mix_language: 'seamless' } });
    expect(order).toEqual([6, 5, 4, 3, 2, 1]);
    expect(feelFor('ws-1', 6, 5)).toBe('seamless');
  });

  it('is asked with for a pair\'s options and for one more script, and not for a pair without one', async () => {
    rememberFeel('ws-1', [1, 2], 'punchy');
    const bodies: unknown[] = [];
    const request = (async (_path: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return {};
    }) as Request;
    const calls = planningCalls(request, 'ws-1');
    await calls.candidates(1, 2);
    await calls.script(1, 2, 9, 'f'.repeat(64));
    await calls.candidates(2, 3);
    expect(bodies[0]).toMatchObject({ a: 1, b: 2, language: 'punchy' });
    expect(bodies[1]).toMatchObject({ a: 1, b: 2, option: 9, language: 'punchy' });
    expect(bodies[2]).not.toHaveProperty('language');
  });
});

describe('the mix rows the energy horizon draws', () => {
  const row = (song_id: number, energy: number | null = null): MixItem => ({ position: 0, song_id, artist: 'Rex', title: 'A', duration: 100, bpm: null, key: null, energy, locked: false, seam: null });

  it('carry each song\'s measured energy, tempo and key from the account, the member\'s own first', () => {
    const mix: MixData = { mix: [row(1), row(2), row(3, 0.9)], name: 'Mix', can_undo: false };
    const measured = new Map([
      [1, { implementation: 'web-dsp-1', source: 'device', bpm: 120, camelot: '8A', energy: 0.4, override_bpm: 121 }],
      [3, { implementation: 'web-dsp-1', source: 'device', energy: 0.2 }],
    ]);
    const shown = withMeasured(mix, measured);
    expect(shown.mix[0]).toMatchObject({ bpm: 121, key: '8A', energy: 0.4 });
    // a song the account has not measured keeps nothing; a row's own value stands
    expect(shown.mix[1]).toMatchObject({ bpm: null, key: null, energy: null });
    expect(shown.mix[2].energy).toBe(0.9);
    expect(withMeasured(mix, undefined)).toBe(mix);
  });
});

vi.mock('./songFacts', () => ({ songFacts: async () => null }));
