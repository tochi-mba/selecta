import { describe, expect, it, vi } from 'vitest';
import type { Request } from '../api';
import { chooseSongs, pickCard, type PlayableSong } from './localFirstMixes';
import { asLibrarySong, localFirstRequest, ONLY_IN_THE_APP, type CatalogueSong } from './localFirstRequest';

// "Never play" in browser-first Cloud (ADR-0475): the Library's row toggle and batch actions keep
// it for the account through /api/local-media/songs/never, rows show it, and a mix SelectaDJ
// builds leaves those songs out. Before, the browser refused with "can't do that in your browser
// yet" because it had nowhere to keep it.

const song = (id: number, title: string, never = false): CatalogueSong => ({
  id, title, artist: 'Artist', available_on: 1, content_sha256: `${id}`.padStart(64, '0'), never,
});

/** A fake Cloud client: the catalogue as given, and every call recorded. */
function cloudWith(songs: CatalogueSong[]) {
  const calls: { path: string; body: unknown }[] = [];
  const cloud = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path.startsWith('/local-media/songs?')) return { songs };
    return {};
  }) as unknown as Request;
  return { cloud, calls };
}

describe('Never play on a Library row', () => {
  it('shows what the account keeps', () => {
    expect(asLibrarySong(song(1, 'A', true)).never).toBe(true);
    expect(asLibrarySong(song(2, 'B')).never).toBe(false);
  });

  it('the row toggle sets it from what the catalogue says now', async () => {
    const { cloud, calls } = cloudWith([song(7, 'Seven'), song(8, 'Eight', true)]);
    const request = localFirstRequest(cloud, {});
    await request('/songs/7/never', { method: 'POST' });
    await request('/songs/8/never', { method: 'POST' });
    const writes = calls.filter((call) => call.path === '/local-media/songs/never');
    expect(writes.map((call) => call.body)).toEqual([
      { never: true, entries: [{ id: 7, expected: false }] },
      { never: false, entries: [{ id: 8, expected: true }] },
    ]);
  });
});

describe('the Library batch actions', () => {
  it('Never play and Allow in mixes go to the account, with what the page was showing', async () => {
    const { cloud, calls } = cloudWith([song(1, 'One'), song(2, 'Two')]);
    const request = localFirstRequest(cloud, {});
    const batch = (action: string, entries: unknown) => request('/library/batch', { method: 'POST', body: JSON.stringify({ action, entries }) });
    await batch('never', [{ id: 1, expected: false }, { id: 2, expected: false }]);
    await batch('allow', [{ id: 1, expected: true }]);
    expect(calls.filter((call) => call.path === '/local-media/songs/never').map((call) => call.body)).toEqual([
      { never: true, entries: [{ id: 1, expected: false }, { id: 2, expected: false }] },
      { never: false, entries: [{ id: 1, expected: true }] },
    ]);
  });

  it('analysis priority is still not offered here, since nothing is analysed in the browser', async () => {
    const { cloud } = cloudWith([song(1, 'One')]);
    const request = localFirstRequest(cloud, {});
    await expect(request('/library/batch', { method: 'POST', body: JSON.stringify({ action: 'prioritize', entries: [] }) }))
      .rejects.toThrow(ONLY_IN_THE_APP);
  });

  it('reads the catalogue again after a change, so the rows show it at once', async () => {
    const { cloud, calls } = cloudWith([song(1, 'One')]);
    const request = localFirstRequest(cloud, {});
    await request('/library?state=all');
    await request('/library/batch', { method: 'POST', body: JSON.stringify({ action: 'never', entries: [{ id: 1, expected: false }] }) });
    await request('/library?state=all');
    expect(calls.filter((call) => call.path.startsWith('/local-media/songs?')).length).toBe(2);
  });
});

describe('a mix SelectaDJ builds', () => {
  const playable = (id: number, title: string, never = false): PlayableSong => ({ id, title, artist: 'Rex', duration: 200, playable: true, never });

  it('leaves Never play songs out of the songs it picks', () => {
    const songs = [playable(1, 'A'), playable(2, 'B', true), playable(3, 'C'), playable(4, 'D')];
    expect(chooseSongs(songs, 3)).toEqual([1, 3, 4]);
    expect(pickCard(songs).songs).toBe(3);
  });

  it('still plays a Never play song the person chose as the start or ending', () => {
    const songs = [playable(1, 'A'), playable(2, 'B', true), playable(3, 'C'), playable(4, 'D', true)];
    expect(chooseSongs(songs, 4, { start: 2, end: 4 })).toEqual([2, 1, 3, 4]);
  });
});
