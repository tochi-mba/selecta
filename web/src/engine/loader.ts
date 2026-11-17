/** Decoded-PCM loading with a hard memory cap (ADR-0457, BF-0457-04).
 *
 * Files decode through the browser codec stack. A file that cannot be decoded reports a clear
 * per-file answer ({ id, error }) and is never thrown into the graph; the engine excludes it from
 * the mix rather than substituting silence inside a seam. Decoded PCM is the memory hog, so a
 * capped least-recently-used cache holds a few songs (3 by default, like player.ts KEEP_SONGS)
 * and evicts the stalest; evictions are counted so a session that churns can be seen doing so.
 */

export type TrackId = number | string;

export type DecodeOk = { ok: true; id: TrackId; buffer: AudioBuffer };
export type DecodeFailure = { ok: false; id: TrackId; error: string };
export type DecodeResult = DecodeOk | DecodeFailure;

export type LoaderStats = { held: number; evictions: number; failures: number };

export type Loader = {
  /** Decode (or reuse) one file. Never rejects: a failure is a value, not an exception. */
  load(id: TrackId, bytes: () => Promise<ArrayBuffer>): Promise<DecodeResult>;
  /** Drop one decoded song, for example when it leaves the queue. */
  forget(id: TrackId): void;
  stats(): LoaderStats;
  clear(): void;
};

export const KEEP_DECODED = 3;

export function createLoader(
  decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>,
  options: { keep?: number } = {},
): Loader {
  const keep = Math.max(1, options.keep ?? KEEP_DECODED);
  // Insertion order is recency: a read re-inserts, so the first key is always the stalest.
  const held = new Map<TrackId, Promise<DecodeResult>>();
  let evictions = 0;
  let failures = 0;

  return {
    load(id, bytes) {
      let found = held.get(id);
      if (found) {
        held.delete(id);
        held.set(id, found);
        return found;
      }
      found = (async (): Promise<DecodeResult> => {
        try {
          const raw = await bytes();
          const buffer = await decode(raw);
          return { ok: true, id, buffer };
        } catch (error) {
          failures += 1;
          // A failed decode is not kept: a corrupt download may succeed on the next try.
          held.delete(id);
          const why = (error as Error | null)?.message;
          return { ok: false, id, error: why || 'That song’s audio could not be read.' };
        }
      })();
      held.set(id, found);
      while (held.size > keep) {
        const stalest = held.keys().next().value as TrackId;
        held.delete(stalest);
        evictions += 1;
      }
      return found;
    },
    forget(id) {
      held.delete(id);
    },
    stats() {
      return { held: held.size, evictions, failures };
    },
    clear() {
      held.clear();
    },
  };
}
