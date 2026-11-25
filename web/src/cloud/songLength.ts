import type { CatalogueSong } from './localFirstRequest';

// T-20261125-8ab8: a song whose length the import could not probe (some video rips) has none in
// the catalogue, so it showed 0:00 and could not be seeked. Once the browser engine has decoded it
// for playback, that length is known for certain. It is saved through the catalogue's own
// registration, an upsert by content hash (src/selecta/local_media/store.py register_songs), sent
// with every field the row already has, so only the missing length changes.

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Row = CatalogueSong & { sample_rate?: number | null };

/** Each song is tried once a visit: a refusal is not worth repeating on every render. */
const tried = new Set<string>();

/** The registration that leaves `row` as it is and adds its length. */
export function registrationOf(row: Row, seconds: number): Record<string, unknown> {
  return {
    content_sha256: row.content_sha256,
    title: row.title,
    artist: row.artist,
    ...(row.album ? { album: row.album } : {}),
    duration_s: seconds,
    ...(row.codec ? { codec: row.codec } : {}),
    ...(row.sample_rate && row.sample_rate > 0 ? { sample_rate: row.sample_rate } : {}),
  };
}

/** Save a decoded length for a song the catalogue has none for. Resolves true when it was sent.
 * It reads the row fresh first, so a length saved meanwhile (or edited tags) is never overwritten
 * with an older copy, and it never throws: playback must not notice. */
export async function saveSongLength(request: Request, songId: number, seconds: number, scope = ''): Promise<boolean> {
  if (!Number.isFinite(seconds) || !(seconds > 0)) return false;
  const key = `${scope}:${songId}`;
  if (tried.has(key)) return false;
  tried.add(key);
  try {
    const row = await request<Row>(`/local-media/songs/${songId}`);
    if (!row?.content_sha256 || !row.title || !row.artist || (row.duration_s ?? 0) > 0) return false;
    await request('/local-media/songs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ songs: [registrationOf(row, Math.round(seconds * 1000) / 1000)] }),
    });
    return true;
  } catch {
    return false;
  }
}

/** For tests: forget which songs were tried. */
export function resetSavedLengths(): void {
  tried.clear();
}
