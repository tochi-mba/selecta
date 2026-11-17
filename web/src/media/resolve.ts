import { cachedBytesKey, cacheRead, MediaStore } from './store';

// The engine's media resolver (ADR-0458 with ADR-0457).
//
// The playback engine asks for a song's bytes by catalogue id and gets either the bytes or an
// honest null, which it shows as unavailable_here. Order of truth: a file handed over this
// visit, then the stored handle (only while its permission still holds), then cached bytes.
// A revoked permission or a vanished file is null, never a crash or a silent skip; the
// re-authorisation flow is how it comes back.

export type ResolvedTrack = {
  id: number;
  /** Fetches the bytes when the engine actually wants them; resolving stays cheap. */
  data: () => Promise<ArrayBuffer>;
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
