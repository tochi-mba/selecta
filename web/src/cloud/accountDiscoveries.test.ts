import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setFlags } from '../flags';
import { forgetAccountMeasured, type Request } from './accountFacts';
import { ACCOUNT_BASE, accountDiscoveries, SWEEP_GAP_MS, SWEEP_SONGS } from './accountDiscoveries';
import { discoveriesFamily, type BrowserAudition, type BrowserDiscovery, type DiscoverySong } from './localFirstDiscoveries';

// T-20261126-9a31: Harmonic matches calls the account's sweep in spare time, one call at a time,
// at most one every SWEEP_GAP_MS, never waiting on it; the account's pairs join the browser's own
// and a Yes or No goes to the account.

const ON = { 'cloud.brain': true, 'discover.harmonic': true, 'cloud.device_analysis': true };
const songs = (count: number, playable = true): DiscoverySong[] => Array.from({ length: count }, (_, at) => ({ id: at + 1, title: `Song ${at + 1}`, artist: `Artist ${at + 1}`, playable }));
const ROW = {
  id: 5, song_a: 1, song_b: 2, title_a: 'Song 1', title_b: 'Song 2', artist_a: 'A', artist_b: 'B', status: 'new', score: 0.9,
  payload: { a_at: 10, a_end: 26, b_at: 40, b_end: 56, bars: 8, transpose: 2, similarity: 0.9 },
};

function account(measured: number) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const request = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path.startsWith('/song-facts?')) return { songs: Array.from({ length: measured }, (_, at) => ({ song_id: at + 1, implementation: 'web-dsp-1', source: 'device', camelot: '8A' })) };
    if (path === '/discoveries/sweep') return { checked: 10, remaining: 0 };
    if (path.startsWith('/discoveries?')) return [ROW, { ...ROW, id: 6, song_b: 99 }];
    if (path === '/discoveries/5/review') return { id: 5, status: JSON.parse(String(init?.body)).verdict };
    return {};
  }) as Request;
  return { calls, request };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { forgetAccountMeasured(); setFlags(ON); });
afterEach(() => setFlags(null));

describe('the account sweep in spare time', () => {
  it('names at most the server bound of measured songs that play here, one call per gap', async () => {
    const { calls, request } = account(60);
    let clock = 0;
    const sweeper = accountDiscoveries(request, 'ws-1', () => clock);
    sweeper.sweepSoon(songs(70));
    sweeper.sweepSoon(songs(70));
    await settle(); await settle();
    const sweeps = calls.filter((call) => call.path === '/discoveries/sweep');
    expect(sweeps).toHaveLength(1);
    const named = (sweeps[0].body as { song_ids: number[] }).song_ids;
    expect(named.length).toBeLessThanOrEqual(SWEEP_SONGS);
    expect(named.every((id) => id <= 60)).toBe(true);
    clock += SWEEP_GAP_MS;
    sweeper.sweepSoon(songs(70));
    await settle(); await settle();
    const second = calls.filter((call) => call.path === '/discoveries/sweep')[1].body as { song_ids: number[] };
    // the next pair of blocks: the first block with the second
    expect(second.song_ids).toEqual([...Array.from({ length: 20 }, (_, at) => at + 1), ...Array.from({ length: 20 }, (_, at) => at + 21)]);
  });

  it('asks nothing with a flag off, or with fewer than two measured songs here', async () => {
    const { calls, request } = account(1);
    accountDiscoveries(request, 'ws-1').sweepSoon(songs(5));
    await settle(); await settle();
    expect(calls.some((call) => call.path === '/discoveries/sweep')).toBe(false);
    setFlags({ ...ON, 'cloud.brain': false });
    const off = account(60);
    accountDiscoveries(off.request, 'ws-1').sweepSoon(songs(5));
    await settle();
    expect(off.calls).toEqual([]);
  });
});

describe('the account pairs on Harmonic matches', () => {
  const family = (request: Request) => discoveriesFamily({
    songs: async () => songs(3),
    profiles: async () => ({ profiles: new Map(), songs: 3, unreadable: 0 }),
    reviews: async () => new Map(),
    review: async () => undefined,
    account: accountDiscoveries(request, 'ws-1'),
  });

  it('join the list when both songs play here, are heard from their stretches, and are answered to the account', async () => {
    const { calls, request } = account(3);
    const rows = await family(request).answer('GET', '/discoveries', new URLSearchParams()) as BrowserDiscovery[];
    expect(rows.map((row) => row.id)).toEqual([ACCOUNT_BASE + 5]);
    expect(rows[0].payload).toMatchObject({ method: 'chord_sequence_account', camelot_a: '8A', bars: 8, transpose: 2 });
    const plan = await family(request).answer('POST', `/discoveries/${ACCOUNT_BASE + 5}/hear`, new URLSearchParams()) as BrowserAudition;
    expect(plan).toMatchObject({ a: { song: 1, from: 10, to: 26 }, b: { song: 2, from: 40, to: 56 } });
    const said = await family(request).answer('POST', `/discoveries/${ACCOUNT_BASE + 5}/review`, new URLSearchParams(), { method: 'POST', body: JSON.stringify({ verdict: 'approved' }) });
    expect(said).toEqual({ id: ACCOUNT_BASE + 5, status: 'approved' });
    expect(calls.find((call) => call.path === '/discoveries/5/review')?.body).toEqual({ verdict: 'approved' });
  });
});
