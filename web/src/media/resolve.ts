import { bytesSha256 } from './identity';
import { cacheRead, MediaStore, readSongBytes } from './store';

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

/** Told whether a song's exact registered bytes could be read here (true) or not (false), so the
 * shell can keep the catalogue's device availability honest without a separate sweep. */
export type AvailabilityObserver = (songId: number, present: boolean, why?: 'changed' | 'permission' | 'missing') => void;

export function makeResolver(
  store: MediaStore,
  cache: (key: string) => Promise<ArrayBuffer | null> = cacheRead,
  onAvailability?: AvailabilityObserver,
  /** `cloud.content_cache` (ADR-0469): on, cached bytes are found by content hash, so the same
   * song reuses one entry whatever workspace or title registered it; off, by workspace. */
  options: { sharedCache?: boolean } = {},
): MediaResolver {
  const scope = { workspaceId: store.workspaceId, shared: options.sharedCache === true };
  return async (songId) => {
    const session = store.sessionFile(songId);
    if (session) return { id: songId, data: () => session.arrayBuffer() };
    const song = await store.get(songId);
    if (song?.ref.kind === 'handle') {
      const handle = song.ref.handle;
      try {
        // Open the file now, so a revoked permission or a moved file turns into null here
        // instead of an error deep inside the engine's decode. queryPermission is not asked
        // first: Chromium answers "prompt" for files under a granted folder that open fine.
        const file = await handle.getFile();
        const expected = song.identity.content_sha256;
        return {
          id: songId,
          data: async () => {
            // The bytes are read for decoding anyway; hashing them proves they are still the
            // song the catalogue registered, so a file edited in place never plays as it.
            const bytes = await file.arrayBuffer();
            const digest = await bytesSha256(bytes);
            if (digest !== expected) {
              await store.markChanged(songId);
              onAvailability?.(songId, false, 'changed');
              throw new Error('This song’s file has changed since it was connected, so SelectaDJ will not play it as this song.');
            }
            if (song.availabilityIssue === 'changed') await store.clearChanged(songId);
            onAvailability?.(songId, true);
            return bytes;
          },
        };
      } catch (problem) {
        // The handle lapsed or the file moved: fall through to the cache, then to an honest null.
        // A failed open is a lapse (permission, or a missing file), never a changed file: only a
        // verified byte mismatch above is 'changed'.
        onAvailability?.(songId, false, (problem as DOMException | null)?.name === 'NotAllowedError' ? 'permission' : 'missing');
      }
    }
    // The cache is keyed by the hash this device computed when it imported the file (never a
    // server-supplied one), and a hit is re-hashed before use, so shared bytes are always the
    // registered song.
    const bytes = song ? await readSongBytes(song, scope, cache) : null;
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
