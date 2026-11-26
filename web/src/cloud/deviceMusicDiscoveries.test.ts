import { describe, expect, it, vi } from 'vitest';
import type { TonalProfile } from '../dsp/analysis/tonalProfile';
import {
  AUDITION_S, camelotCompatible, COUSIN_SIMILARITY, discoveriesFamily, findMatches, HEAR_STEP_REFUSAL, MOST_PER_SONG, pairId, pairKey,
  rotations, type BrowserAudition, type BrowserDiscovery, type DiscoverySong, type ProfileProgress,
} from './deviceMusicDiscoveries';
import type { Verdict } from './tonalProfiles';

// cloud.browser_harmonic: Harmonic matches answered in the browser from whole-song key profiles.
// The matching is a port of local mode's tonal_profile_cousin; nothing compares note order.

// A major-key shaped profile with its tonic at C (Krumhansl-Schmuckler major weights).
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
/** `np.roll(values, shift)`: the same profile `shift` semitones up. */
const roll = (values: number[], shift: number) => values.map((_, index) => values[(index - shift + 12) % 12]);
const SPIKY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];

function profile(over: Partial<TonalProfile> = {}): TonalProfile {
  const chroma = over.chroma ?? MAJOR;
  return { implementation: 'tonal-profile-v1', chroma, intro: chroma, outro: chroma, key: 'C', mode: 'major', confidence: 0.8, camelot: '8B', durationS: 200, ...over };
}
const song = (id: number, artist = `Artist ${id}`, playable = true): DiscoverySong => ({ id, title: `Song ${id}`, artist, playable });

describe('comparing two profiles at every rotation', () => {
  it('scores a profile against itself as 1 untransposed', () => {
    const turns = rotations(MAJOR, MAJOR);
    expect(turns).toHaveLength(12);
    expect(turns[0]).toBeCloseTo(1, 6);
    expect(Math.max(...turns)).toBe(turns[0]);
  });

  it('finds the rotation that lines a transposed copy back up', () => {
    // a is b moved up two semitones, so rolling b by two meets it
    const turns = rotations(roll(MAJOR, 2), MAJOR);
    expect(turns.indexOf(Math.max(...turns))).toBe(2);
    expect(turns[2]).toBeCloseTo(1, 6);
  });

  it('ignores loudness, and scores silence as nothing rather than failing', () => {
    expect(rotations(MAJOR.map((value) => value * 40), MAJOR)[0]).toBeCloseTo(1, 6);
    for (const turn of rotations(Array.from({ length: 12 }, () => 0), MAJOR)) expect(turn).toBe(0);
  });
});

describe('keys that sit together on the Camelot wheel', () => {
  it('accepts the same key, the relative key and one step round the wheel', () => {
    expect(camelotCompatible('8B', '8B')).toBe(true);
    expect(camelotCompatible('8B', '8A')).toBe(true);
    expect(camelotCompatible('8B', '9B')).toBe(true);
    expect(camelotCompatible('8B', '7B')).toBe(true);
    expect(camelotCompatible('12A', '1A')).toBe(true);
    expect(camelotCompatible('1B', '12B')).toBe(true);
  });

  it('refuses two steps, a diagonal step and anything that is not a code', () => {
    expect(camelotCompatible('8B', '10B')).toBe(false);
    expect(camelotCompatible('8B', '9A')).toBe(false);
    expect(camelotCompatible('8B', '')).toBe(false);
    expect(camelotCompatible('', '')).toBe(false);
    expect(camelotCompatible('H', '8B')).toBe(false);
  });
});

describe('the id of a pair', () => {
  it('is stable, positive, within a signed 32-bit id, and depends on the order', () => {
    expect(pairId(3, 9)).toBe(pairId(3, 9));
    expect(pairId(3, 9)).not.toBe(pairId(9, 3));
    for (const [a, b] of [[1, 2], [3, 9], [40_000, 7], [2147483646, 2147483645]]) {
      const id = pairId(a, b);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThan(2147483647);
    }
    expect(pairKey(3, 9)).toBe('3>9');
  });
});

describe('finding harmonic matches', () => {
  it('offers two songs by different artists whose profiles line up, with honest details', () => {
    const profiles = new Map([[1, profile({ durationS: 200 })], [2, profile({ durationS: 12 })]]);
    const [match, ...rest] = findMatches([song(1), song(2)], profiles);
    expect(rest).toEqual([]);
    expect(match.status).toBe('new');
    expect([match.song_a, match.song_b].sort()).toEqual([1, 2]);
    expect(match.id).toBe(pairId(match.song_a, match.song_b));
    expect(match.payload.method).toBe('whole_song_chroma_browser');
    expect(match.payload.transpose).toBe(0);
    // nothing is read bar by bar here
    expect(match.payload.bars).toBe(0);
    expect(match.payload.similarity).toBeGreaterThan(COUSIN_SIMILARITY);
    expect(match.payload.key_a).toBe('C major');
    expect(match.payload.camelot_b).toBe('8B');
    expect(match.score).toBeCloseTo((match.payload.similarity + match.payload.edge_similarity) / 2, 9);
  });

  it('auditions the end of the first song and the start of the second, inside each song', () => {
    const profiles = new Map([
      [1, profile({ durationS: 200, outro: MAJOR, intro: SPIKY })],
      [2, profile({ durationS: 12, intro: MAJOR, outro: SPIKY })],
    ]);
    const [match] = findMatches([song(1), song(2)], profiles);
    // the ending of song 1 leads into the opening of song 2 far better than the other way round
    expect([match.song_a, match.song_b]).toEqual([1, 2]);
    expect(match.payload.a_at).toBe(200 - AUDITION_S);
    expect(match.payload.a_end).toBe(200);
    expect(match.payload.b_at).toBe(0);
    // a song shorter than the audition is played whole, never past its end
    expect(match.payload.b_end).toBe(12);
  });

  it('puts the songs the other way round when that ending leads in better', () => {
    const profiles = new Map([
      [1, profile({ intro: MAJOR, outro: SPIKY })],
      [2, profile({ intro: SPIKY, outro: MAJOR })],
    ]);
    const [match] = findMatches([song(1), song(2)], profiles);
    expect([match.song_a, match.song_b]).toEqual([2, 1]);
    expect(match.title_a).toBe('Song 2');
    expect(match.artist_b).toBe('Artist 1');
  });

  it('offers nothing when the profiles do not resemble each other', () => {
    const profiles = new Map([[1, profile({ chroma: SPIKY })], [2, profile({ chroma: [0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0] })]]);
    expect(findMatches([song(1), song(2)], profiles)).toEqual([]);
  });

  it('offers a transposed resemblance only when the keys as recorded sit together', () => {
    const inC = profile();
    // the same shape a fifth up: G major, one step round the wheel from C major
    const inG = profile({ chroma: roll(MAJOR, 7), key: 'G', camelot: '9B' });
    const [near] = findMatches([song(1), song(2)], new Map([[1, inC], [2, inG]]));
    expect(near).toBeDefined();
    expect(Math.abs(near.payload.transpose)).toBe(5);
    // the same shape two semitones up: D major, two steps away, clashes as recorded
    const inD = profile({ chroma: roll(MAJOR, 2), key: 'D', camelot: '10B' });
    expect(findMatches([song(1), song(2)], new Map([[1, inC], [2, inD]]))).toEqual([]);
  });

  it('never pairs two songs by the same artist, however the name is typed', () => {
    const profiles = new Map([[1, profile()], [2, profile()]]);
    expect(findMatches([song(1, 'Rex'), song(2, '  rex ')], profiles)).toEqual([]);
  });

  it('leaves out songs this device cannot play and songs not measured yet', () => {
    const profiles = new Map([[1, profile()], [2, profile()], [3, profile()]]);
    const found = findMatches([song(1), song(2, 'Artist 2', false), song(3), song(4)], profiles);
    expect(found).toHaveLength(1);
    expect([found[0].song_a, found[0].song_b].sort()).toEqual([1, 3]);
  });

  it('gives no song more than a few matches, and lists the best first', () => {
    const songs = Array.from({ length: 12 }, (_, index) => song(index + 1));
    const profiles = new Map(songs.map((one) => [one.id, profile()]));
    const found = findMatches(songs, profiles);
    expect(found.length).toBeGreaterThan(0);
    const each = new Map<number, number>();
    for (const row of found) for (const id of [row.song_a, row.song_b]) each.set(id, (each.get(id) ?? 0) + 1);
    expect(Math.max(...each.values())).toBeLessThanOrEqual(MOST_PER_SONG);
    for (let index = 1; index < found.length; index += 1) expect(found[index - 1].score).toBeGreaterThanOrEqual(found[index].score);
    expect(new Set(found.map((row) => row.id)).size).toBe(found.length);
  });

  it('compares the same pairs on every pass over the same library', () => {
    const songs = Array.from({ length: 30 }, (_, index) => song(index + 1));
    const profiles = new Map(songs.map((one) => [one.id, one.id % 2 ? profile() : profile({ chroma: roll(MAJOR, 7), key: 'G', camelot: '9B' })]));
    const found = findMatches(songs, profiles);
    expect(found.length).toBeGreaterThan(0);
    expect(findMatches([...songs].reverse(), profiles)).toEqual(found);
  });
});

describe('the /discoveries routes in the browser', () => {
  function family(songs: DiscoverySong[], profiles: Map<number, TonalProfile>, unreadable = 0) {
    const verdicts = new Map<string, Verdict>();
    const sources = {
      songs: vi.fn(async () => songs),
      profiles: vi.fn(async () => ({ profiles, songs: songs.length, unreadable })),
      reviews: vi.fn(async () => verdicts),
      review: vi.fn(async (pair: string, verdict: Verdict) => { verdicts.set(pair, verdict); }),
    };
    const made = discoveriesFamily(sources);
    const ask = <T,>(method: string, path: string, body?: unknown) => {
      const [route, query = ''] = path.split('?');
      return made.answer(method, route, new URLSearchParams(query), body === undefined ? undefined : { method, body: JSON.stringify(body) }) as Promise<T> | undefined;
    };
    return { ask, sources, verdicts };
  }
  const two = () => family([song(1), song(2)], new Map([[1, profile()], [2, profile({ durationS: 90 })]]));

  it('lists the pairs waiting to be heard', async () => {
    const { ask } = two();
    const rows = await ask<BrowserDiscovery[]>('GET', '/discoveries')!;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('new');
  });

  it('says how far measuring has got', async () => {
    const { ask } = family([song(1), song(2), song(3), song(4)], new Map([[1, profile()], [2, profile()]]), 1);
    expect(await ask<ProfileProgress>('GET', '/discoveries/progress')!).toEqual({ songs: 4, measured: 2, unreadable: 1 });
  });

  it('plans an audition from the two files as recorded: no chords, nothing transposed', async () => {
    const { ask } = two();
    const [row] = await ask<BrowserDiscovery[]>('GET', '/discoveries')!;
    const plan = await ask<BrowserAudition>('POST', `/discoveries/${row.id}/hear`)!;
    expect(plan.kind).toBe('browser_edges');
    expect(plan.chords).toEqual([]);
    expect(plan.bar_starts).toEqual([]);
    expect(plan.semitones).toBe(0);
    expect(plan.a).toEqual({ song: row.song_a, from: row.payload.a_at, to: row.payload.a_end });
    expect(plan.b).toEqual({ song: row.song_b, from: 0, to: row.payload.b_end });
    expect(plan.seconds).toBe(2 * AUDITION_S);
  });

  it('refuses the chord steps local mode plays, with the reason', async () => {
    const { ask } = two();
    const [row] = await ask<BrowserDiscovery[]>('GET', '/discoveries')!;
    await expect(ask('GET', `/discoveries/${row.id}/hear/chords`)).rejects.toMatchObject({ message: HEAR_STEP_REFUSAL, status: 404, code: 'flag_off' });
  });

  it('keeps a Yes or No in this browser and moves the pair out of the waiting list', async () => {
    const { ask, sources, verdicts } = two();
    const [row] = await ask<BrowserDiscovery[]>('GET', '/discoveries')!;
    expect(await ask('POST', `/discoveries/${row.id}/review`, { verdict: 'approved' })!).toEqual({ id: row.id, status: 'approved' });
    expect(sources.review).toHaveBeenCalledWith(pairKey(row.song_a, row.song_b), 'approved');
    expect(verdicts.get(pairKey(row.song_a, row.song_b))).toBe('approved');
    const after = await ask<BrowserDiscovery[]>('GET', '/discoveries')!;
    expect(after.map((item) => item.status)).toEqual(['approved']);
    // taking the answer back puts it in the waiting list again
    await ask('POST', `/discoveries/${row.id}/review`, { verdict: 'new' });
    expect((await ask<BrowserDiscovery[]>('GET', '/discoveries')!)[0].status).toBe('new');
  });

  it('refuses a verdict it does not know, and a pair it no longer offers', async () => {
    const { ask, sources } = two();
    const [row] = await ask<BrowserDiscovery[]>('GET', '/discoveries')!;
    await expect(ask('POST', `/discoveries/${row.id}/review`, { verdict: 'maybe' })).rejects.toMatchObject({ code: 'bad_verdict', status: 400 });
    await expect(ask('POST', '/discoveries/999999/review', { verdict: 'approved' })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(ask('POST', '/discoveries/999999/hear')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(sources.review).not.toHaveBeenCalled();
  });

  it('shows a new song and artist on each row first, and honours the limit', async () => {
    const songs = Array.from({ length: 10 }, (_, index) => song(index + 1));
    const { ask } = family(songs, new Map(songs.map((one) => [one.id, profile()])));
    const all = await ask<BrowserDiscovery[]>('GET', '/discoveries')!;
    expect(all.length).toBeGreaterThan(5);
    // no song or artist is seen twice until the rows that can do that have run out
    const seen = new Set<number>();
    let fresh = 0;
    for (const row of all) {
      if (seen.has(row.song_a) || seen.has(row.song_b)) break;
      seen.add(row.song_a).add(row.song_b);
      fresh += 1;
    }
    expect(fresh).toBeGreaterThanOrEqual(3);
    expect(await ask<BrowserDiscovery[]>('GET', '/discoveries?limit=2')!).toHaveLength(2);
  });

  it('works the pairs out again when another song has been measured', async () => {
    const profiles = new Map([[1, profile()], [2, profile()]]);
    const { ask } = family([song(1), song(2), song(3)], profiles);
    expect(await ask<BrowserDiscovery[]>('GET', '/discoveries')!).toHaveLength(1);
    profiles.set(3, profile());
    expect((await ask<BrowserDiscovery[]>('GET', '/discoveries')!).length).toBeGreaterThan(1);
  });

  it('leaves every other route to the rest of the adapter', () => {
    const { ask } = two();
    expect(ask('GET', '/links')).toBeUndefined();
    expect(ask('DELETE', '/discoveries/1')).toBeUndefined();
    expect(ask('GET', '/discoveries/1/hear')).toBeUndefined();
  });
});
