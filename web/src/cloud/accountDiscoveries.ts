import { flagListed } from '../flags';
import { accountMeasured, type Measured, type Request } from './accountFacts';
import type { BrowserDiscovery, DiscoverySong } from './deviceMusicDiscoveries';

/** Harmonic matches the account finds (T-20261126-9a31; docs/engineering/engine-store-discovery.md).
 *
 * The account's harmonic discovery is the Desktop's chord-sequence sweep over the facts this
 * device measured (`POST /api/discoveries/sweep`). Here it is called in spare time while Harmonic
 * matches is open: one call at a time, at most one every `SWEEP_GAP_MS` (the server allows 6 a
 * minute), each naming at most `SWEEP_SONGS` measured songs that play here, so the page never
 * waits on it. The songs go in blocks of half that, every pair of blocks in turn, so every pair is
 * compared in the end; the server skips a pair it compared already, so a reload picks up where it
 * was. What it found (`GET /api/discoveries`) joins the browser's own pairs, and a Yes or No goes
 * to the account (`POST /api/discoveries/{id}/review`). Sent: catalogue song ids and a verdict. */

/** The server's own bound on songs a sweep call names (`discovery_routes.MOST_SONGS`). */
export const SWEEP_SONGS = 40;
/** Pairs one sweep call compares at most (`discovery_routes.MOST_PAIRS`). */
export const SWEEP_PAIRS = 200;
/** At most one sweep call this often: under the server's 6 a minute. */
export const SWEEP_GAP_MS = 15_000;
/** Account pair ids are moved past the browser's own (32-bit) ones, so the two never meet. */
export const ACCOUNT_BASE = 2 ** 32;

export const accountDiscoveriesOn = (): boolean =>
  flagListed('cloud.brain') && flagListed('discover.harmonic') && flagListed('cloud.device_analysis');

type AccountRow = {
  id: number; song_a: number; song_b: number; title_a: string; title_b: string; artist_a: string; artist_b: string;
  status: string; score: number; payload: { a_at?: number; a_end?: number; b_at?: number; b_end?: number; bars?: number; transpose?: number; similarity?: number };
};

export type AccountDiscoveries = {
  /** The account's pairs whose songs both play here, in the browser's shape. */
  list: (songs: readonly DiscoverySong[]) => Promise<BrowserDiscovery[]>;
  /** A Yes, No or Not yet for one of them. */
  review: (id: number, verdict: string) => Promise<{ id: number; status: string }>;
  /** Ask for one more sweep call if one is due; never waits for it. */
  sweepSoon: (songs: readonly DiscoverySong[]) => void;
  /** Whether an id is one of the account's. */
  owns: (id: number) => boolean;
};

const keyOf = (measured: Measured | undefined) => measured?.override_camelot ?? measured?.camelot ?? '';

export function accountDiscoveries(request: Request, workspaceId: string, now: () => number = Date.now): AccountDiscoveries {
  let busy = false;
  let lastAt = -Infinity;
  // which pair of blocks the next call compares, and the song list it was made for
  let cursor = { block: 0, other: 0, signature: '' };
  const sweepSoon = (songs: readonly DiscoverySong[]) => {
    if (busy || now() - lastAt < SWEEP_GAP_MS || !accountDiscoveriesOn()) return;
    busy = true;
    lastAt = now();
    void (async () => {
      try {
        const measured = await accountMeasured(request, workspaceId);
        const ids = songs.filter((song) => song.playable && measured.has(song.id)).map((song) => song.id).sort((a, b) => a - b);
        if (ids.length < 2) return;
        const size = SWEEP_SONGS / 2;
        const blocks = Math.ceil(ids.length / size);
        const signature = ids.join(',');
        if (cursor.signature !== signature) cursor = { block: 0, other: 0, signature };
        const named = [...new Set([...ids.slice(cursor.block * size, (cursor.block + 1) * size), ...ids.slice(cursor.other * size, (cursor.other + 1) * size)])];
        if (named.length < 2) {
          cursor = next(cursor, blocks);
          return;
        }
        const answer = await request<{ remaining?: number }>('/discoveries/sweep', { method: 'POST', body: JSON.stringify({ song_ids: named, pair_limit: SWEEP_PAIRS }) });
        // this pair of blocks is done once nothing is left in it; then the next, round again
        if (!answer?.remaining) cursor = next(cursor, blocks);
      } catch {
        // offline, refused or busy: the next turn asks again
      } finally {
        busy = false;
      }
    })();
  };
  return {
    sweepSoon,
    owns: (id) => id > ACCOUNT_BASE,
    list: async (songs) => {
      if (!accountDiscoveriesOn()) return [];
      const [rows, measured] = await Promise.all([request<AccountRow[]>('/discoveries?limit=40'), accountMeasured(request, workspaceId).catch(() => new Map<number, Measured>())]);
      const here = new Set(songs.filter((song) => song.playable).map((song) => song.id));
      return (Array.isArray(rows) ? rows : [])
        // heard from the files on this device, so both must play here
        .filter((row) => here.has(row.song_a) && here.has(row.song_b) && row.payload && typeof row.payload.a_at === 'number')
        .map((row): BrowserDiscovery => ({
          id: ACCOUNT_BASE + row.id, song_a: row.song_a, song_b: row.song_b, title_a: row.title_a, title_b: row.title_b,
          artist_a: row.artist_a, artist_b: row.artist_b, score: row.score,
          status: row.status === 'approved' || row.status === 'rejected' ? row.status : 'new',
          payload: {
            a_at: row.payload.a_at ?? 0, a_end: row.payload.a_end ?? 0, b_at: row.payload.b_at ?? 0, b_end: row.payload.b_end ?? 0,
            bars: row.payload.bars ?? 0, transpose: row.payload.transpose ?? 0, method: 'chord_sequence_account',
            similarity: row.payload.similarity ?? row.score, edge_similarity: 0,
            key_a: '', key_b: '', camelot_a: keyOf(measured.get(row.song_a)), camelot_b: keyOf(measured.get(row.song_b)),
          },
        }));
    },
    review: async (id, verdict) => {
      const answer = await request<{ id: number; status: string }>(`/discoveries/${id - ACCOUNT_BASE}/review`, { method: 'POST', body: JSON.stringify({ verdict }) });
      return { id, status: answer?.status ?? verdict };
    },
  };
}

/** The next pair of blocks: each block with itself and every later one, then round again. */
function next(cursor: { block: number; other: number; signature: string }, blocks: number) {
  if (cursor.other + 1 < blocks) return { ...cursor, other: cursor.other + 1 };
  const block = cursor.block + 1 < blocks ? cursor.block + 1 : 0;
  return { ...cursor, block, other: block };
}
