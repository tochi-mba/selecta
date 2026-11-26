import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { clientFor, request as localRequest, type Request } from '../api';
import { flagOn, useFlag } from '../flags';
import { useRequest } from '../requestContext';
import { hasArt, songKeyFor } from './artStore';

// Covers and song details from SelectaDJ's own catalogue in Cloud (ADR-0478, FL-0478-04, flag
// `library.art_lookup`). The second rung of the cover ladder: only for a song whose file has no
// picture of its own. Every cover on a page asks through one batched read (`POST /catalog/art`),
// and the answer is kept per song, so the person's "Wrong cover?" choice, once saved, shows on
// every cover of that song at once. Images are only ever served from our own API origin, never
// hot-linked from a third party, and nothing here talks to MusicBrainz or the Cover Art Archive:
// the server does that, and only for accounts that allow it.
//
// Answers do not last the whole visit (T-20261125-7375). A cover staff hide must leave a venue
// display or a tab left open for days, so each answer is read again after `ANSWER_TTL_MS` (under
// the image's own hour of browser cache). An image that will not load (404 once hidden) drops its
// song back to the generated tile at once and is asked about again later, waiting longer each time
// it fails. A read that failed (offline, a deploy) is retried with growing waits, sooner when the
// browser comes back online, and never more than two reads at once for a page.

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
/** An answer is read again after this: half the hour the server lets a browser keep an image. */
const ANSWER_TTL_MS = 30 * 60_000;
/** A failed read is tried again after this, doubling each time up to `RETRY_MAX_MS`. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 10 * 60_000;
/** An image that failed to load is not shown again for this long, doubling up to `BROKEN_MAX_MS`. */
const BROKEN_BASE_MS = 60_000;
const BROKEN_MAX_MS = 60 * 60_000;
/** Reads in flight at once for one page: a slow network must not pile requests on the API. */
const READS_AT_ONCE = 2;

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
  /** when each song's answer was read, so it is read again once it is old */
  readAt: Map<number, number>;
  refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** reads in flight now */
  reading: number;
  /** songs whose last read failed, waiting for the retry */
  failed: Set<number>;
  failures: number;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** image addresses that failed to load: how often, and until when they are not shown */
  broken: Map<string, { strikes: number; until: number }>;
};

/** One book per request, so two accounts or workspaces in one page never share an answer. */
const books = new WeakMap<Request, Book>();
/** Books with a retry waiting, so coming back online can run it at once. */
const retrying = new Set<Book>();

function bookFor(request: Request): Book {
  let book = books.get(request);
  if (!book) {
    book = {
      request, songs: new Map(), asked: new Set(), waiting: new Set(), tries: new Map(), timer: undefined, listeners: new Map(),
      readAt: new Map(), refreshTimer: undefined, reading: 0, failed: new Set(), failures: 0, retryTimer: undefined, broken: new Map(),
    };
    books.set(request, book);
  }
  return book;
}

const listening = (book: Book, songId: number) => (book.listeners.get(songId)?.size ?? 0) > 0;

/** Read the answers that are older than `ANSWER_TTL_MS` again: at once for songs on screen (one
 * batched read), and on their next showing for the rest. The timer runs only while answers are
 * kept, for the earliest one due. */
function scheduleRefresh(book: Book): void {
  if (book.refreshTimer !== undefined || !book.readAt.size) return;
  const oldest = Math.min(...book.readAt.values());
  const wait = Math.max(1_000, oldest + ANSWER_TTL_MS - Date.now());
  book.refreshTimer = setTimeout(() => {
    book.refreshTimer = undefined;
    const now = Date.now();
    for (const [songId, at] of [...book.readAt]) {
      if (now - at < ANSWER_TTL_MS) continue;
      book.readAt.delete(songId);
      book.asked.delete(songId);
      if (listening(book, songId)) gather(book, songId);
    }
    scheduleRefresh(book);
  }, wait);
}

/** Try the songs whose read failed again, after a wait that doubles with each failure in a row and
 * is spread a little, so many tabs do not come back in step. */
function scheduleRetry(book: Book): void {
  if (book.retryTimer !== undefined) return;
  const wait = Math.min(RETRY_BASE_MS * 2 ** book.failures, RETRY_MAX_MS) * (0.75 + Math.random() * 0.5);
  book.failures += 1;
  retrying.add(book);
  book.retryTimer = setTimeout(() => retryNow(book), wait);
}

function retryNow(book: Book): void {
  if (book.retryTimer !== undefined) clearTimeout(book.retryTimer);
  book.retryTimer = undefined;
  retrying.delete(book);
  const songs = [...book.failed];
  book.failed.clear();
  for (const songId of songs) {
    book.asked.delete(songId);
    if (listening(book, songId)) gather(book, songId);
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // back online: the waiting retries run now rather than at the end of their wait (once each)
  window.addEventListener('online', () => { for (const book of [...retrying]) retryNow(book); });
}

/** The song as it may be shown: an image still in its failed-to-load wait is left out. */
function withoutBroken(book: Book, song: CatalogSong): CatalogSong {
  const url = song.art?.url;
  const broken = url ? book.broken.get(url) : undefined;
  return broken && broken.until > Date.now() ? { ...song, art: null } : song;
}

function tell(book: Book, songId: number): void {
  for (const listener of book.listeners.get(songId) ?? []) {
    try { listener(); } catch { /* one cover never stops the others */ }
  }
}

function keep(book: Book, song: CatalogSong): void {
  if (!song || typeof song.song_id !== 'number') return;
  book.songs.set(song.song_id, withoutBroken(book, song));
  book.readAt.set(song.song_id, Date.now());
  scheduleRefresh(book);
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

/** Read the waiting songs, in batches the server accepts, at most `READS_AT_ONCE` at a time; the
 * rest wait for a read to finish. A failed read (the server away, a deploy, offline) leaves those
 * songs with their tile, or their last answer, and asks again later (`scheduleRetry`). */
function readWaiting(book: Book): void {
  while (book.waiting.size && book.reading < READS_AT_ONCE) {
    const batch = [...book.waiting].slice(0, MAX_PER_ASK);
    for (const id of batch) book.waiting.delete(id);
    book.reading += 1;
    clientFor(book.request).post<{ songs?: CatalogSong[] }>('/catalog/art', { songs: batch.map((id) => ({ id })) }).then(
      (answer) => {
        book.failures = 0;
        for (const song of answer?.songs ?? []) keep(book, song);
      },
      () => {
        // they stay "asked" until the retry, so covers mounting meanwhile do not each read again
        for (const id of batch) book.failed.add(id);
        scheduleRetry(book);
      },
    ).finally(() => {
      book.reading -= 1;
      if (book.waiting.size && book.timer === undefined) readWaiting(book);
    });
  }
}

/** An image of the catalogue's would not load (hidden by staff since it was read, or storage
 * trouble): every cover showing it drops to the generated tile at once, and the songs are read
 * again once the wait is over, so a hidden image stays gone and a passing fault heals. */
function imageFailed(book: Book, url: string): void {
  const before = book.broken.get(url);
  if (before && before.until > Date.now()) return;
  const strikes = (before?.strikes ?? 0) + 1;
  const wait = Math.min(BROKEN_BASE_MS * 2 ** (strikes - 1), BROKEN_MAX_MS);
  book.broken.set(url, { strikes, until: Date.now() + wait });
  const songs = [...book.songs.values()].filter((song) => song.art?.url === url);
  for (const song of songs) {
    book.songs.set(song.song_id, { ...song, art: null });
    tell(book, song.song_id);
  }
  setTimeout(() => {
    for (const song of songs) {
      book.asked.delete(song.song_id);
      if (listening(book, song.song_id)) gather(book, song.song_id);
    }
  }, wait);
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
    if (book && id !== null) {
      lastBook = book;
      void ask(book, id);
    }
  }, [book, id]);
  return song;
}

/** The book the page's covers last asked through, so the lock screen and the ambient colour (which
 * live outside React) read the same answers and add no request of their own beyond one song. */
let lastBook: Book | null = null;

const matchedCover = (song: CatalogSong | undefined): { url: string; hue: number | null } | null => {
  const url = song?.state === 'matched' ? catalogImageUrl(song.art?.url) : null;
  return url ? { url, hue: song?.art?.hue ?? null } : null;
};

/** The catalogue's cover for a song outside React, by the same rule as useCatalogArt. It resolves
 * once the answer is known, or with what is known after `waitMs`; null while the flag is off, in
 * the local app (whose pages never ask the catalogue, so no book exists) and for a song whose file
 * has its own picture. */
export function catalogCoverFor(songId: number, waitMs = 8000): Promise<{ url: string; hue: number | null } | null> {
  const book = lastBook;
  if (!book || !flagOn('library.art_lookup') || !Number.isInteger(songId) || songId < 1) return Promise.resolve(null);
  const known = book.songs.get(songId);
  const readAt = book.readAt.get(songId);
  // an answer past its time is read again before it is handed to the lock screen
  const fresh = readAt !== undefined && Date.now() - readAt < ANSWER_TTL_MS;
  if (known && known.state !== 'pending' && fresh) return Promise.resolve(matchedCover(known));
  if (!fresh) book.asked.delete(songId);
  return new Promise((resolve) => {
    const set = book.listeners.get(songId) ?? new Set<() => void>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      set.delete(listener);
      if (!set.size) book.listeners.delete(songId);
      if (timer !== undefined) clearTimeout(timer);
      resolve(matchedCover(book.songs.get(songId)));
    };
    const listener = () => {
      const song = book.songs.get(songId);
      if (song && song.state !== 'pending' && book.readAt.get(songId) !== readAt) finish();
    };
    set.add(listener);
    book.listeners.set(songId, set);
    // a bound on the wait, not a display: nothing on screen follows this timer
    timer = setTimeout(finish, waitMs);
    void ask(book, songId);
  });
}

/** The catalogue's cover for a song, for the cover ladder: only a confident match with a stored,
 * visible image, and never once the person chose the generated tile. `failed` is for the image
 * that will not load: it drops the song (and every other cover showing that image) to the tile. */
export function useCatalogArt(songId: number | null | undefined): { url: string; hue: number | null; failed: () => void } | null {
  const song = useCatalogSong(songId);
  const request = useRequest();
  const path = song?.state === 'matched' ? song.art?.url ?? null : null;
  const url = catalogImageUrl(path);
  const failed = useCallback(() => {
    const book = books.get(request);
    if (book && path) imageFailed(book, path);
  }, [request, path]);
  return url ? { url, hue: song?.art?.hue ?? null, failed } : null;
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
  if (book?.refreshTimer !== undefined) clearTimeout(book.refreshTimer);
  if (book?.retryTimer !== undefined) clearTimeout(book.retryTimer);
  if (book) retrying.delete(book);
  if (lastBook === book) lastBook = null;
  books.delete(request);
}
