import { afterEach, describe, expect, it } from 'vitest';
import type { LibrarySong } from '../api';
import { libraryFamily, songsAnswer } from './localFirstLibrary';
import { firstAsked, measureInTurn, measuringPaused, nextOf, setMeasuringPaused, setWaiting } from './measuringControl';

const row = (id: number, more: Partial<LibrarySong> = {}): LibrarySong => ({
  id, artist: `Artist ${id}`, title: `Song ${id}`, genre: null, duration: 200, bpm: null, camelot: null,
  detected_bpm: null, detected_camelot: null, override_bpm: null, override_camelot: null, music_override: null,
  energy: null, grid_confidence: null, lyric_status: null, never: false, priority: false,
  readiness: { status: 'mix_ready', reason: '' }, availability: 'here', ...more,
});

const rows = [row(1), row(2, { detected_bpm: 120, bpm: 120 }), row(3, { availability: 'elsewhere' }), row(4, { readiness: { status: 'set_aside', reason: '' } })];
const family = (measuring = true) => libraryFamily({ rows: async () => rows, measuring: () => measuring });
const post = (init: unknown = {}) => ({ method: 'POST', body: JSON.stringify(init) });

afterEach(() => {
  for (const id of [...firstAsked()]) measureInTurn(id);
  setMeasuringPaused(false);
});

describe('the Desktop song search in a browser', () => {
  it('answers in the Desktop shape, leaving set-aside songs out unless asked', () => {
    const all = songsAnswer(rows, new URLSearchParams(''));
    expect(all.map((song) => song.id)).toEqual([1, 2, 3]);
    expect(all[0]).toMatchObject({ is_music: 1, processing_priority: 0, never: false });
    expect(songsAnswer(rows, new URLSearchParams('state=ready')).map((song) => song.id)).toEqual([1, 2, 4].filter((id) => id !== 4));
    expect(songsAnswer(rows, new URLSearchParams('state=not_yet')).map((song) => song.id)).toEqual([1, 3]);
    expect(songsAnswer(rows, new URLSearchParams('state=set_aside')).map((song) => song.id)).toEqual([4]);
    expect(songsAnswer(rows, new URLSearchParams('order=recent&limit=2')).map((song) => song.id)).toEqual([3, 2]);
    expect(songsAnswer(rows, new URLSearchParams('q=song 2')).map((song) => song.id)).toEqual([2]);
  });
});

describe('measuring first and pausing on this device', () => {
  it('puts an asked song next, and a priority batch can be undone', async () => {
    const answer = await family().answer('POST', '/songs/3/analyse', new URLSearchParams(''), post());
    expect(answer).toMatchObject({ song_id: 3 });
    expect(nextOf([{ id: 1 }, { id: 3 }])?.id).toBe(3);
    const batch = await family().answer('POST', '/library/batch', new URLSearchParams(''), post({ action: 'prioritize', entries: [{ id: 1, expected: false }] })) as { previous: { id: number; priority: number }[] };
    expect(batch.previous).toEqual([{ id: 1, priority: 0 }]);
    expect(firstAsked()).toEqual([1, 3]);
    await family().answer('POST', '/library/batch', new URLSearchParams(''), post({ action: 'restore_priority', entries: [{ id: 1, expected: true, priority: 0 }] }));
    expect(firstAsked()).toEqual([3]);
    // measured, it leaves the list
    setWaiting([1], 3);
    expect(firstAsked()).toEqual([]);
  });

  it('a measured song needs nothing, and a song not in the library is refused', async () => {
    expect(await family().answer('POST', '/songs/2/analyse', new URLSearchParams(''), post())).toMatchObject({ ahead: 0 });
    expect(firstAsked()).toEqual([]);
    await expect(family().answer('POST', '/songs/99/priority', new URLSearchParams('priority=100'), post())).rejects.toMatchObject({ status: 404 });
    await expect(family().answer('POST', '/songs/1/priority', new URLSearchParams('priority=7'), post())).rejects.toMatchObject({ status: 400 });
  });

  it('stop and start pause and carry on measuring', async () => {
    expect(await family().answer('POST', '/analysis/stop', new URLSearchParams(''), post())).toEqual({ running: false });
    expect(measuringPaused()).toBe(true);
    expect(await family().answer('POST', '/analysis/start', new URLSearchParams(''), post())).toEqual({ running: true });
    expect(measuringPaused()).toBe(false);
  });

  it('refuses measuring routes where this device does not measure, and leaves never batches alone', async () => {
    await expect(family(false).answer('POST', '/analysis/stop', new URLSearchParams(''), post())).rejects.toMatchObject({ code: 'flag_off' });
    expect(family().answer('POST', '/library/batch', new URLSearchParams(''), post({ action: 'never', entries: [] }))).toBeUndefined();
    expect(await family(false).answer('GET', '/library/interrupted', new URLSearchParams(''))).toMatchObject({ lyrics: false, scan: null });
  });
});
