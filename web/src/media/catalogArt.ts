import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { clientFor, request as localRequest, type Request } from '../api';
import { useFlag } from '../flags';
import { useRequest } from '../requestContext';
import { hasArt, songKeyFor } from './artStore';

// Covers and song details from SelectaDJ's own catalogue in Cloud (ADR-0478, FL-0478-04, flag
// `library.art_lookup`). The second rung of the cover ladder: only for a song whose file has no
// picture of its own. Every cover on a page asks through one batched read (`POST /catalog/art`),
// and the answer is kept per song for the visit, so the person's "Wrong cover?" choice, once
// saved, shows on every cover of that song at once. Images are only ever served from our own API
// origin, never hot-linked from a third party, and nothing here talks to MusicBrainz or the
// Cover Art Archive: the server does that, and only for accounts that allow it.

export type CatalogImage = { id: string; url: string | null; sizes: Record<string, string>; hue: number | null; source: string };
export type CatalogDetails = {
  recording_id: string | null; release_id: string | null; title: string | null; artist: string | null;
  album: string | null; year: number | null; isrc: string | null;
};
/** none: never looked up; pending: being looked up; matched: a confident match (with or without a
 * stored cover); generated: the person chose the generated tile. */
export type CatalogSong = {
  song_id: number;
  state: 'none' | 'pending' | 'matched' | 'generated';
  chosen?: boolean;
  art: CatalogImage | null;
  confidence: number | null;
  method: string | null;
  details: CatalogDetails | null;
};
export type CatalogRelease = {
  release_id: string; title: string; artist: string | null; date: string | null; year: number | null;
  status: string | null; type: string | null; cover: 'unknown' | 'present' | 'absent';
  art: CatalogImage | null; current: boolean;
};
export type CatalogCandidates = { song_id: number; choice: 'auto' | 'release' | 'generated'; outcome: string | null; releases: CatalogRelease[] };
export type CoverChoice = { choice: 'auto' } | { choice: 'generated' } | { choice: 'release'; release_id: string };

/** The server takes at most this many songs per read (catalog/service.py MAX_SONGS_PER_ASK). */
const MAX_PER_ASK = 200;
/** Covers asked for within this long go in one read, so a Library page is one request, not fifty. */
const GATHER_MS = 120;
/** A song still being looked up is asked about again after this, a few times at most. */
const PENDING_AGAIN_MS = 20_000;
const PENDING_TRIES = 3;

const apiOrigin = (import.meta.env.VITE_SELECTA_API_ORIGIN ?? '').replace(/\/$/, '');

/** A path from the server made absolute on our own API origin, which is where Cloud's API lives. */
export function catalogImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('/') ? `${apiOrigin}${path}` : null;
}

type Book = {
  request: Request;
  songs: Map<number, CatalogSong>;
  /** asked, or decided not to ask (the file has its own picture, or the read was refused) */
  asked: Set<number>;
  waiting: Set<number>;
  tries: Map<number, number>;
  timer: ReturnType<typeof setTimeout> | undefined;
  listeners: Map<number, Set<() => void>>;
};

/** One book per request, so two accounts or workspaces in one page never share an answer. */
const books = new WeakMap<Request, Book>();

function bookFor(request: Request): Book {
  let book = books.get(request);
  if (!book) {
    book = { request, songs: new Map(), asked: new Set(), waiting: new Set(), tries: new Map(), timer: undefined, listeners: new Map() };
    books.set(request, book);
  }
  return book;
}

function tell(book: Book, songId: number): void {
  for (const listener of book.listeners.get(songId) ?? []) {
    try { listener(); } catch { /* one cover never stops the others */ }
  }
}

function keep(book: Book, song: CatalogSong): void {
  if (!song || typeof song.song_id !== 'number') return;
  book.songs.set(song.song_id, song);
  tell(book, song.song_id);
  if (song.state !== 'pending') return;
  const tries = (book.tries.get(song.song_id) ?? 0) + 1;
  book.tries.set(song.song_id, tries);
  if (tries >= PENDING_TRIES) return;
  // a lookup takes a moment on the server; one more read later picks up its answer
  setTimeout(() => {
    book.asked.delete(song.song_id);
    if (book.listeners.get(song.song_id)?.size) gather(book, song.song_id);
  }, PENDING_AGAIN_MS * tries);
}

function gather(book: Book, songId: number): void {
  if (book.asked.has(songId)) return;
  book.asked.add(songId);
  book.waiting.add(songId);
  if (book.timer === undefined) book.timer = setTimeout(() => { book.timer = undefined; readWaiting(book); }, GATHER_MS);
}

/** Read the waiting songs, in batches the server accepts. A refused read (the flag off for this
 * account, the server away) leaves those songs with their generated tile for this visit. */
function readWaiting(book: Book): void {
  const ids = [...book.waiting];
  book.waiting.clear();
  for (let start = 0; start < ids.length; start += MAX_PER_ASK) {
    const batch = ids.slice(start, start + MAX_PER_ASK);
    clientFor(book.request).post<{ songs?: CatalogSong[] }>('/catalog/art', { songs: batch.map((id) => ({ id })) }).then(
      (answer) => { for (const song of answer?.songs ?? []) keep(book, song); },
      () => { /* the tile stays, as it was before this rung existed */ },
    );
  }
}

/** Ask for a song's catalogue entry, unless its file has a picture of its own: the file always
 * wins, and a song with its own cover is never looked up on its account. */
async function ask(book: Book, songId: number): Promise<void> {
  if (book.asked.has(songId)) return;
  try {
    const sha = await songKeyFor(songId);
    if (sha && (await hasArt(sha))) { book.asked.add(songId); return; }
  } catch { /* no index here: ask the catalogue */ }
  gather(book, songId);
}

/** A song's catalogue entry for this visit, or null: while the flag is off, before the answer,
 * and for a song whose file has its own picture. */
export function useCatalogSong(songId: number | null | undefined): CatalogSong | null {
  const on = useFlag('library.art_lookup');
  const request = useRequest();
  // The catalogue is Cloud's (the flag's modes): the local app's own server has none, and it is
  // the page that never provides a request of its own, so there nothing is asked at all.
  const id = on && request !== localRequest && typeof songId === 'number' && Number.isInteger(songId) && songId > 0 ? songId : null;
  const book = id === null ? null : bookFor(request);
  const subscribe = useCallback((listener: () => void) => {
    if (!book || id === null) return () => undefined;
    const set = book.listeners.get(id) ?? new Set<() => void>();
    set.add(listener);
    book.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) book.listeners.delete(id);
    };
  }, [book, id]);
  const read = () => (book && id !== null ? book.songs.get(id) ?? null : null);
  const song = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    if (book && id !== null) void ask(book, id);
  }, [book, id]);
  return song;
}

/** The catalogue's cover for a song, for the cover ladder: only a confident match with a stored,
 * visible image, and never once the person chose the generated tile. */
export function useCatalogArt(songId: number | null | undefined): { url: string; hue: number | null } | null {
  const song = useCatalogSong(songId);
  const url = song?.state === 'matched' ? catalogImageUrl(song.art?.url) : null;
  return url ? { url, hue: song?.art?.hue ?? null } : null;
}

/** The releases a person may pick in "Wrong cover?". */
export function readCandidates(request: Request, songId: number): Promise<CatalogCandidates> {
  return clientFor(request).get<CatalogCandidates>(`/catalog/songs/${songId}/candidates`);
}

/** Keep the person's choice and show it on every cover of the song at once. Resolves with
 * whether the chosen release's cover is still being fetched by the server. */
export async function chooseCover(request: Request, songId: number, choice: CoverChoice): Promise<{ pending: boolean }> {
  const answer = await request<{ song: CatalogSong; cover_pending: boolean }>(`/catalog/songs/${songId}/choice`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ choice: choice.choice, release_id: choice.choice === 'release' ? choice.release_id : null }),
  });
  const book = bookFor(request);
  book.tries.delete(songId);
  if (answer?.song) keep(book, answer.song);
  if (answer?.cover_pending) {
    // the cover of a release nobody had picked before is fetched now; read the song again shortly
    setTimeout(() => {
      book.asked.delete(songId);
      gather(book, songId);
    }, PENDING_AGAIN_MS);
  }
  return { pending: answer?.cover_pending === true };
}

/** Test seam: forget every answer kept for a request. */
export function forgetCatalogArt(request: Request): void {
  const book = books.get(request);
  if (book?.timer !== undefined) clearTimeout(book.timer);
  books.delete(request);
}
