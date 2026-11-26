import { factsVersion } from '../dsp/analysis/deviceAnalysisIds';
import type { SongFacts } from '../dsp/analysis/song';
import { derivedStore, type DerivedStore } from '../media/derived';

/** Song facts measured on this device (cloud.device_analysis, ADR-0479 phase 5).
 *
 * The background profiler (tonalProfiles.ts) measures each song once, in the analysis worker,
 * and keeps the result here: in this browser's device-wide derived store (media/derived.ts),
 * kind `analysis`, keyed by the file's content hash and by `factsVersion()` (the analysis
 * implementation and the beat source together), so a new implementation or a new beat source
 * measures every song again. Nothing here is sent anywhere; a later step sends the numbers.
 *
 * Read only for hashes the caller's own song index holds and has proven, as every derived kind.
 */

export type FactsRecord =
  | { sha: string; version: string; facts: SongFacts }
  | { sha: string; version: string; unreadable: 'too_large' | 'too_long' | 'undecodable' };

export type FactsStore = {
  /** Whether these bytes have a record (facts or unreadable) at the current version. */
  has(sha: string): Promise<boolean>;
  put(record: FactsRecord): Promise<void>;
};

/** The store over the device-wide derived store. A browser that keeps nothing (private
 * browsing) keeps the record for this visit only, so a song is measured once a visit at most. */
export function deviceFactsStore(open: () => Promise<DerivedStore> = derivedStore): FactsStore {
  return {
    async has(sha) {
      return (await (await open()).get<FactsRecord>('analysis', factsVersion(), sha)) !== null;
    },
    async put(record) {
      await (await open()).put('analysis', record.version, record.sha, record);
    },
  };
}

/** One song's facts measured here, or null when it has none at the current version (never
 * measured, unreadable, or measured by an older implementation). `sha` must come from the
 * caller's own song index. */
export async function songFacts(sha: string, open: () => Promise<DerivedStore> = derivedStore): Promise<SongFacts | null> {
  const record = await (await open()).get<FactsRecord>('analysis', factsVersion(), sha);
  return record && 'facts' in record ? record.facts : null;
}
