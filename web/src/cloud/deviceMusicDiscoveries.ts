import { ApiError } from '../api';
import type { TonalProfile } from '../dsp/analysis/tonalProfile';
import type { Verdict } from './tonalProfiles';
import type { AccountDiscoveries } from './accountDiscoveries';

/** Harmonic matches in a browser library (cloud.browser_harmonic, ADR-0462 "one adapter per
 * route family"): `/discoveries` answered in the shape Make a Mix's Harmonic matches reads,
 * from whole-song key profiles measured on this device (tonalProfiles.ts).
 *
 * The matching is local mode's `tonal_profile_cousin` (src/selecta/discovery/search.py): each
 * song's average pitch-class profile is compared with another's at all twelve rotations, and a
 * pair is offered when the best rotation is very close. Because a browser audition plays both
 * songs as recorded (nothing is transposed), a pair is only offered when the keys as recorded
 * also sit together on the Camelot wheel, or the profiles already line up untransposed. Note
 * order is never compared, so this is a tonal resemblance to check by ear, not local mode's
 * bar-by-bar chord sequence search, and the page says so.
 */

export const COMPARED_PER_SONG = 80;
export const MOST_PER_SONG = 3;
/** The cousin threshold `audio_search` uses. */
export const COUSIN_SIMILARITY = 0.93;
/** How much of each song the audition plays: the end of the first, the start of the second. */
export const AUDITION_S = 20;
const LIMIT = 40;

export type DiscoverySong = { id: number; title: string; artist: string; playable: boolean };

export type BrowserDiscovery = {
  id: number; song_a: number; song_b: number; title_a: string; title_b: string;
  artist_a: string; artist_b: string; status: Verdict;
  payload: {
    a_at: number; b_at: number; a_end: number; b_end: number; bars: number; transpose: number;
    // the account's: the Desktop's chord-sequence sweep over stored facts (accountDiscoveries.ts)
    method: 'whole_song_chroma_browser' | 'chord_sequence_account'; similarity: number; edge_similarity: number;
    key_a: string; key_b: string; camelot_a: string; camelot_b: string;
  };
  score: number;
};

/** How far the browser has got measuring this device's songs. */
export type ProfileProgress = { songs: number; measured: number; unreadable: number };

/** What the browser's audition is: two stretches of the files on this device, as recorded. */
export type BrowserAudition = {
  chords: string[]; bar_starts: number[]; seconds: number; semitones: number;
  kind: 'browser_edges';
  a: { song: number; from: number; to: number };
  b: { song: number; from: number; to: number };
};

export const HEAR_STEP_REFUSAL = 'In your browser SelectaDJ plays the end of one song into the start of the other, from the files on this device. It can’t play the chords it heard, because it doesn’t read chords bar by bar here.';

function refuse(message: string, code: string, status = 400): ApiError {
  return new ApiError(message, status, code, 'device-music:/discoveries');
}

function unit(values: readonly number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) + 1e-9;
  return values.map((value) => value / norm);
}

/** `np.dot(pa, np.roll(pb, shift))` for every shift. */
export function rotations(a: readonly number[], b: readonly number[]): number[] {
  const pa = unit(a);
  const pb = unit(b);
  return Array.from({ length: 12 }, (_, shift) => {
    let dot = 0;
    for (let index = 0; index < 12; index += 1) dot += pa[index] * pb[(index - shift + 12) % 12];
    return dot;
  });
}

/** Same key, a step either way round the wheel, or the relative major or minor. */
export function camelotCompatible(one: string, other: string): boolean {
  const parse = (code: string) => { const match = /^(\d{1,2})([AB])$/.exec(code); return match ? { n: Number(match[1]), letter: match[2] } : null; };
  const a = parse(one);
  const b = parse(other);
  if (!a || !b) return false;
  if (a.n === b.n) return true;
  const step = Math.min((a.n - b.n + 12) % 12, (b.n - a.n + 12) % 12);
  return a.letter === b.letter && step === 1;
}

/** A stable positive id for an ordered pair (FNV-1a over "a>b"), so answers survive reloads. */
export function pairId(a: number, b: number): number {
  let hash = 0x811c9dc5;
  for (const char of `${a}>${b}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

export const pairKey = (a: number, b: number) => `${a}>${b}`;

/** A seeded generator, so the same library compares the same pairs on every poll. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

const artistKey = (artist: string) => artist.trim().toLocaleLowerCase();

/** One pair, ordered so the first song's ending leads best into the second's opening. */
function compare(one: DiscoverySong, two: DiscoverySong, p1: TonalProfile, p2: TonalProfile): BrowserDiscovery | null {
  const turns = rotations(p1.chroma, p2.chroma);
  const similarity = Math.max(...turns);
  if (!(similarity > COUSIN_SIMILARITY)) return null;
  const shift = turns.indexOf(similarity);
  const transpose = shift > 6 ? shift - 12 : shift;
  // a browser audition plays both as recorded, so the pair must fit as recorded
  if (transpose !== 0 && !camelotCompatible(p1.camelot, p2.camelot)) return null;
  const forward = rotations(p1.outro, p2.intro)[0];
  const backward = rotations(p2.outro, p1.intro)[0];
  const [a, b, pa, pb] = forward >= backward ? [one, two, p1, p2] : [two, one, p2, p1];
  const edge = Math.max(forward, backward);
  return {
    id: pairId(a.id, b.id), song_a: a.id, song_b: b.id, title_a: a.title, title_b: b.title,
    artist_a: a.artist, artist_b: b.artist, status: 'new',
    payload: {
      a_at: Math.max(0, pa.durationS - AUDITION_S), a_end: pa.durationS,
      b_at: 0, b_end: Math.min(AUDITION_S, pb.durationS),
      bars: 0, transpose: forward >= backward ? transpose : -transpose,
      method: 'whole_song_chroma_browser', similarity, edge_similarity: edge,
      key_a: `${pa.key} ${pa.mode}`, key_b: `${pb.key} ${pb.mode}`, camelot_a: pa.camelot, camelot_b: pb.camelot,
    },
    score: (similarity + edge) / 2,
  };
}

/** `spread_out`: best first, but a new song and artist on every row while there are any. */
function spreadOut(rows: BrowserDiscovery[], limit: number): BrowserDiscovery[] {
  const chosen: BrowserDiscovery[] = [];
  let left = [...rows];
  const seenSongs = new Set<number>();
  const seenArtists = new Set<string>();
  for (const strict of [true, false]) {
    const later: BrowserDiscovery[] = [];
    for (const row of left) {
      if (chosen.length >= limit) break;
      const artists = [artistKey(row.artist_a), artistKey(row.artist_b)];
      const repeat = seenSongs.has(row.song_a) || seenSongs.has(row.song_b) || (strict && artists.some((name) => seenArtists.has(name)));
      if (repeat) { later.push(row); continue; }
      chosen.push(row);
      seenSongs.add(row.song_a).add(row.song_b);
      artists.forEach((name) => seenArtists.add(name));
    }
    left = later;
  }
  return [...chosen, ...left].slice(0, limit);
}

/** `audio_search`'s cousin pass over the profiled songs this device can play. */
export function findMatches(songs: readonly DiscoverySong[], profiles: ReadonlyMap<number, TonalProfile>, seed = 1): BrowserDiscovery[] {
  const usable = songs.filter((song) => song.playable && profiles.has(song.id)).sort((one, other) => one.id - other.id);
  const random = seeded(seed);
  const order = shuffled(usable.map((_, index) => index), random);
  // up to COMPARED_PER_SONG others each, drawn at random without building every pair
  const draw = (index: number): number[] => {
    if (usable.length - 1 <= COMPARED_PER_SONG * 2) {
      return shuffled(usable.map((_, other) => other).filter((other) => other !== index), random).slice(0, COMPARED_PER_SONG);
    }
    const picked = new Set<number>();
    while (picked.size < COMPARED_PER_SONG) {
      const other = Math.floor(random() * usable.length);
      if (other !== index) picked.add(other);
    }
    return [...picked];
  };
  const partners = new Map(order.map((index) => [index, draw(index)]));
  const compared = new Set<string>();
  const matches = new Map<number, number>();
  const found: BrowserDiscovery[] = [];
  for (let turn = 0; turn < COMPARED_PER_SONG; turn += 1) {
    for (const index of order) {
      const other = partners.get(index)?.[turn];
      if (other === undefined) continue;
      const [low, high] = index < other ? [index, other] : [other, index];
      const key = `${low}:${high}`;
      if (compared.has(key)) continue;
      compared.add(key);
      const one = usable[low];
      const two = usable[high];
      if (artistKey(one.artist) === artistKey(two.artist)) continue;
      if (Math.max(matches.get(one.id) ?? 0, matches.get(two.id) ?? 0) >= MOST_PER_SONG) continue;
      const pair = compare(one, two, profiles.get(one.id)!, profiles.get(two.id)!);
      if (!pair) continue;
      found.push(pair);
      matches.set(one.id, (matches.get(one.id) ?? 0) + 1);
      matches.set(two.id, (matches.get(two.id) ?? 0) + 1);
    }
  }
  return found.sort((one, other) => other.score - one.score || one.id - other.id);
}

export type DiscoveriesSources = {
  songs: () => Promise<DiscoverySong[]>;
  profiles: () => Promise<{ profiles: ReadonlyMap<number, TonalProfile>; songs: number; unreadable: number }>;
  reviews: () => Promise<ReadonlyMap<string, Verdict>>;
  review: (pair: string, verdict: Verdict) => Promise<void>;
  /** The account's own sweep and its pairs (cloud.brain with discover.harmonic), when wired. */
  account?: AccountDiscoveries;
};

export type DiscoveriesFamily = {
  /** The family's answer, or undefined when the request is not one of its routes. */
  answer: (method: string, route: string, query: URLSearchParams, init?: RequestInit) => Promise<unknown> | undefined;
};

export function discoveriesFamily(sources: DiscoveriesSources): DiscoveriesFamily {
  // one pass per change in what is measured: polls in between reuse it
  let cached: { signature: string; rows: BrowserDiscovery[] } | null = null;
  // the last song list read: offline, pairs already found stay on screen
  let lastSongs: DiscoverySong[] | null = null;
  const knownSongs = async (): Promise<DiscoverySong[]> => {
    try {
      lastSongs = await sources.songs();
    } catch (problem) {
      if (!lastSongs) throw problem;
    }
    return lastSongs;
  };
  const candidates = async (): Promise<BrowserDiscovery[]> => {
    const [songs, measured] = await Promise.all([knownSongs(), sources.profiles()]);
    const signature = `${songs.filter((song) => song.playable).map((song) => song.id).join(',')}|${[...measured.profiles.keys()].sort((a, b) => a - b).join(',')}`;
    if (cached?.signature !== signature) cached = { signature, rows: findMatches(songs, measured.profiles) };
    return cached.rows;
  };
  const withVerdicts = async (): Promise<BrowserDiscovery[]> => {
    const verdicts = await sources.reviews();
    return (await candidates()).map((row) => ({ ...row, status: verdicts.get(pairKey(row.song_a, row.song_b)) ?? 'new' }));
  };
  // the account's pairs, when on; a failure shows the browser's own alone
  const accountRows = async (): Promise<BrowserDiscovery[]> => {
    if (!sources.account) return [];
    const songs = await knownSongs();
    sources.account.sweepSoon(songs);
    return sources.account.list(songs).catch(() => []);
  };
  const find = async (id: number): Promise<BrowserDiscovery> => {
    const rows = sources.account?.owns(id) ? await accountRows() : await withVerdicts();
    const row = rows.find((item) => item.id === id);
    if (!row) throw refuse('That pair isn’t one SelectaDJ can offer on this device any more.', 'not_found', 404);
    return row;
  };

  return {
    answer: (method, route, query, init) => {
      if (method === 'GET' && route === '/discoveries') {
        return Promise.all([withVerdicts(), accountRows()]).then(([own, accounts]) => {
          const rows = [...accounts, ...own];
          const wanted = Math.max(0, Math.min(Number(query.get('limit') ?? LIMIT) || LIMIT, 200));
          return [...spreadOut(rows.filter((row) => row.status === 'new'), wanted), ...rows.filter((row) => row.status !== 'new')];
        });
      }
      if (method === 'GET' && route === '/discoveries/progress') {
        return sources.profiles().then((measured): ProfileProgress => ({ songs: measured.songs, measured: measured.profiles.size, unreadable: measured.unreadable }));
      }
      const hear = /^\/discoveries\/(\d+)\/hear$/.exec(route);
      if (method === 'POST' && hear) {
        return find(Number(hear[1])).then((row): BrowserAudition => ({
          chords: [], bar_starts: [], semitones: 0, kind: 'browser_edges',
          seconds: (row.payload.a_end - row.payload.a_at) + (row.payload.b_end - row.payload.b_at),
          a: { song: row.song_a, from: row.payload.a_at, to: row.payload.a_end },
          b: { song: row.song_b, from: row.payload.b_at, to: row.payload.b_end },
        }));
      }
      if (method === 'GET' && /^\/discoveries\/\d+\/hear\/[^/]+$/.test(route)) {
        return Promise.reject(refuse(HEAR_STEP_REFUSAL, 'flag_off', 404));
      }
      const review = /^\/discoveries\/(\d+)\/review$/.exec(route);
      if (method === 'POST' && review) {
        return (async () => {
          let verdict: unknown;
          try { verdict = (JSON.parse(String(init?.body ?? '{}')) as { verdict?: unknown }).verdict; } catch { verdict = undefined; }
          if (verdict !== 'new' && verdict !== 'approved' && verdict !== 'rejected') throw refuse('Choose approved, rejected, or new', 'bad_verdict');
          if (sources.account?.owns(Number(review[1]))) return sources.account.review(Number(review[1]), verdict);
          const row = await find(Number(review[1]));
          // the answer stays in this browser: it teaches nothing to a server and adds nothing to a mix
          await sources.review(pairKey(row.song_a, row.song_b), verdict);
          return { id: row.id, status: verdict };
        })();
      }
      return undefined;
    },
  };
}
