import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryPage, Request } from '../api';
import { setFlags } from '../flags';
import { forgetAccountMeasured } from './accountFacts';
import { browserFlags, NOT_IN_THE_BROWSER } from './browserFlags';
import { localFirstRequest, ONLY_IN_THE_APP, type CatalogueSong } from './localFirstRequest';

// A device-music Cloud account's Library shows the tempo and key its devices measured and saved
// to the account, and Song details' corrections are kept there (cloud.brain with
// cloud.device_analysis). With either off, or on a server that never named them, rows claim no
// tempo or key and corrections are not offered, as before.

const song = (id: number): CatalogueSong => ({ id, title: `Song ${id}`, artist: 'Artist', available_on: 1, content_sha256: `${id}`.padStart(64, '0') });

function cloudWith(measured: Record<string, unknown>[], fail = false) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const cloud = vi.fn(async (path: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path.startsWith('/local-media/songs?')) return { songs: [song(1), song(2)] };
    if (path.startsWith('/song-facts?')) {
      if (fail) throw new Error('offline');
      return { songs: measured };
    }
    return {};
  }) as unknown as Request;
  return { cloud, calls };
}

const one = { song_id: 1, implementation: 'web-dsp-1', source: 'device', bpm: 123.6, camelot: '8A', energy: 0.4, override_bpm: null, override_camelot: null };

beforeEach(() => forgetAccountMeasured());
afterEach(() => setFlags(null));

describe('the Library from the account\'s measurements', () => {
  it('shows tempo, key and energy for a measured song and claims nothing for the rest', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
    const { cloud } = cloudWith([one]);
    const page = await localFirstRequest(cloud, { workspaceId: 'w1' })<LibraryPage>('/library?state=all');
    const [first, second] = page.songs;
    expect(first).toMatchObject({ bpm: 123.6, camelot: '8A', detected_bpm: 123.6, detected_camelot: '8A', energy: 0.4, override_bpm: null });
    expect(second).toMatchObject({ bpm: null, camelot: null, energy: null });
  });

  it('shows the member\'s correction as the tempo in use, with the measured one kept', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
    const { cloud } = cloudWith([{ ...one, override_bpm: 124, override_camelot: '9A' }]);
    const page = await localFirstRequest(cloud, { workspaceId: 'w1' })<LibraryPage>('/library?state=all');
    expect(page.songs[0]).toMatchObject({ bpm: 124, camelot: '9A', detected_bpm: 123.6, detected_camelot: '8A', override_bpm: 124, override_camelot: '9A' });
  });

  it('asks nothing and shows nothing when a flag is off or unnamed', async () => {
    setFlags({ 'cloud.brain': true });
    const { cloud, calls } = cloudWith([one]);
    const page = await localFirstRequest(cloud, { workspaceId: 'w1' })<LibraryPage>('/library?state=all');
    expect(page.songs[0].bpm).toBeNull();
    expect(calls.some((call) => call.path.startsWith('/song-facts'))).toBe(false);
  });

  it('a failed read leaves the Library as it was', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
    const { cloud } = cloudWith([one], true);
    const page = await localFirstRequest(cloud, { workspaceId: 'w1' })<LibraryPage>('/library?state=all');
    expect(page.songs.map((row) => row.bpm)).toEqual([null, null]);
  });
});

describe('corrections from Song details', () => {
  it('a tempo and key go to the account, and the Library reads them back', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
    const { cloud, calls } = cloudWith([one]);
    const request = localFirstRequest(cloud, { workspaceId: 'w1' });
    await request('/library?state=all');
    expect(await request('/songs/1/correct', { method: 'POST', body: JSON.stringify({ bpm: 124, camelot: '9A', clear: [] }) })).toEqual({ redone: 0 });
    expect(calls.filter((call) => call.path === '/song-facts/1/correction')).toEqual([{ method: 'PUT', path: '/song-facts/1/correction', body: { bpm: 124, camelot: '9A' } }]);
    const page = await request<LibraryPage>('/library?state=all');
    expect(page.songs[0]).toMatchObject({ bpm: 124, camelot: '9A', detected_bpm: 123.6 });
  });

  it('putting both back asks the account to forget the correction', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
    const { cloud, calls } = cloudWith([{ ...one, override_bpm: 124 }]);
    await localFirstRequest(cloud, { workspaceId: 'w1' })('/songs/1/correct', { method: 'POST', body: JSON.stringify({ clear: ['bpm', 'camelot'] }) });
    expect(calls.filter((call) => call.path === '/song-facts/1/correction').map((call) => call.method)).toEqual(['DELETE']);
  });

  it('"is it music?" and a correction with the flags off are the app\'s, said plainly', async () => {
    setFlags({ 'cloud.brain': true, 'cloud.device_analysis': true });
    const { cloud } = cloudWith([one]);
    await expect(localFirstRequest(cloud, { workspaceId: 'w1' })('/songs/1/correct', { method: 'POST', body: JSON.stringify({ is_music: false }) })).rejects.toThrow(ONLY_IN_THE_APP);
    setFlags({ 'cloud.brain': true });
    await expect(localFirstRequest(cloud, { workspaceId: 'w1' })('/songs/1/correct', { method: 'POST', body: JSON.stringify({ bpm: 120 }) })).rejects.toThrow(ONLY_IN_THE_APP);
  });
});

describe('what the browser shell switches off', () => {
  it('turns corrections, the energy shape and locks on only with the account behind them', () => {
    expect(browserFlags(true)).toMatchObject({ 'library.corrections': false, 'mixes.shaping.energy_arc': false, 'editor.locks': false });
    const measured = browserFlags(true, false, { measured: true });
    expect(measured['library.corrections']).toBeUndefined();
    expect(measured['mixes.shaping.energy_arc']).toBeUndefined();
    expect(measured['editor.locks']).toBe(false);
    expect(browserFlags(true, false, { accountMixes: true })['editor.locks']).toBeUndefined();
  });

  it('keeps every other decision whatever the account has', () => {
    const all = browserFlags(true, true, { measured: true, accountMixes: true });
    for (const id of ['requests.bridges', 'editor.energy_horizon', 'seam_inspector', 'app.activity', 'export', 'lyrics.lookup', 'mixes.shaping.feel', 'mixes.shaping.stem_moves']) {
      expect(all[id], id).toBe(false);
    }
    expect(Object.keys(NOT_IN_THE_BROWSER)).toHaveLength(12);
  });
});
