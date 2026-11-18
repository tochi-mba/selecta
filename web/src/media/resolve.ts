import { cachedBytesKey, cacheRead, MediaStore } from './store';

// The engine's media resolver (ADR-0458 with ADR-0457).
//
// The playback engine asks for a song's bytes by catalogue id and gets either the bytes or an
// honest null, which it shows as unavailable_here. Order of truth: a file handed over this
// visit, then the stored handle (only while its permission still holds), then cached bytes.
// A revoked permission or a vanished file is null, never a crash or a silent skip; the
// re-authorisation flow is how it comes back.

/** Where a song's bytes come from: this device's own file, or the account's hosted copy. */
export type MusicSource = 'device' | 'hosted';

export type ResolvedTrack = {
  id: number;
  /** Fetches the bytes when the engine actually wants them; resolving stays cheap. */
  data: () => Promise<ArrayBuffer>;
  /** Which path answered; device when absent (the plain device resolver). */
  source?: MusicSource;
};

/** The contract injected into the engine: null means unavailable on this device right now. */
export type MediaResolver = (songId: number) => Promise<ResolvedTrack | null>;

export function makeResolver(
  store: MediaStore,
  cache: (key: string) => Promise<ArrayBuffer | null> = cacheRead,
): MediaResolver {
  return async (songId) => {
    const session = store.sessionFile(songId);
    if (session) return { id: songId, data: () => session.arrayBuffer() };
    const song = await store.get(songId);
    if (song?.ref.kind === 'handle') {
      const handle = song.ref.handle;
      try {
        const permitted = !handle.queryPermission || (await handle.queryPermission({ mode: 'read' })) === 'granted';
        if (permitted) {
          // Open the file now, so a revoked permission or a moved file turns into null here
          // instead of an error deep inside the engine's decode.
          const file = await handle.getFile();
          return { id: songId, data: () => file.arrayBuffer() };
        }
      } catch {
        // The handle lapsed: fall through to the cache, then to an honest null.
      }
    }
    const bytes = await cache(cachedBytesKey(songId));
    if (bytes) return { id: songId, data: async () => bytes };
    return null;
  };
}

/** Resolve the track at a position in a programme (the recipe's ordered song ids). Out of
 * range resolves to null, same as any other unavailable track. */
export async function resolveByIndex(resolve: MediaResolver, programme: number[], index: number): Promise<ResolvedTrack | null> {
  const songId = programme[index];
  return songId === undefined ? null : resolve(songId);
}

// Coexistence precedence (ADR-0465, BF-0465-03).
//
// A grandfathered account holds both kinds of music. Each track in a programme resolves on the
// playing device first (the device resolver above), and only where the device lacks the file
// falls back to the account's hosted copy (cloud.stored_media playback-url routes, injected as
// `hosted` so this layer never learns about the Cloud API). Every answer is written to the
// source book, so each queue item can show where it plays from, and a track neither path can
// play is recorded with its reason instead of stalling silently.

/** What the queue shows for one song: where it plays from, or why it cannot play. */
export type SourceEntry =
  | { source: MusicSource }
  | { source: 'unavailable'; reason: string };

export type SourceBook = {
  get(songId: number): SourceEntry | undefined;
  set(songId: number, entry: SourceEntry): void;
  /** Every entry, by song id. */
  all(): ReadonlyMap<number, SourceEntry>;
  subscribe(watch: () => void): () => void;
};

export function makeSourceBook(): SourceBook {
  const entries = new Map<number, SourceEntry>();
  const watchers = new Set<() => void>();
  return {
    get: (songId) => entries.get(songId),
    set(songId, entry) {
      const before = entries.get(songId);
      if (before && JSON.stringify(before) === JSON.stringify(entry)) return;
      entries.set(songId, entry);
      for (const watch of watchers) watch();
    },
    all: () => entries,
    subscribe(watch) {
      watchers.add(watch);
      return () => { watchers.delete(watch); };
    },
  };
}

export const NOT_ON_DEVICE = 'This song is not on this device, and SelectaDJ has no hosted copy to play instead.';
export const NOT_ANYWHERE = 'This song is not on this device right now.';

/** Device first, hosted fallback. Without `hosted` (an account with no hosted media, or
 * `cloud.stored_media` off) it is the device resolver with its answers recorded. */
export function makeCoexistingResolver(options: {
  device: MediaResolver;
  hosted?: MediaResolver | null;
  book?: SourceBook;
}): MediaResolver {
  const book = options.book;
  return async (songId) => {
    let deviceProblem = '';
    try {
      const found = await options.device(songId);
      if (found) {
        book?.set(songId, { source: 'device' });
        return { ...found, source: 'device' };
      }
    } catch (error) {
      deviceProblem = (error as Error | null)?.message ?? '';
    }
    if (options.hosted) {
      try {
        const found = await options.hosted(songId);
        if (found) {
          book?.set(songId, { source: 'hosted' });
          return { ...found, source: 'hosted' };
        }
      } catch {
        // a hosted copy that cannot be reached is the same honest null as a missing one
      }
      book?.set(songId, { source: 'unavailable', reason: NOT_ON_DEVICE });
      return null;
    }
    book?.set(songId, { source: 'unavailable', reason: deviceProblem || NOT_ANYWHERE });
    return null;
  };
}
