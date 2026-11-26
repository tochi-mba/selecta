import { BROWSER_BEATS_IMPLEMENTATION, factsVersion, NEURAL_BEATS_IMPLEMENTATION } from '../dsp/analysis/deviceAnalysisIds';
import type { SongFacts } from '../dsp/analysis/song';
import { derivedStore, type DerivedStore } from '../media/derived';

/** Song facts measured on this device (cloud.device_analysis, ADR-0479 phase 5).
 *
 * The background profiler (tonalProfiles.ts) measures each song once, in the analysis worker,
 * and keeps the result here: in this browser's device-wide derived store (media/derived.ts),
 * kind `analysis`, keyed by the file's content hash and by `factsVersion()` (the analysis
 * implementation and the beat source together), so a new implementation or a new beat source
 * measures every song again. Nothing here is sent anywhere; factsUploader.ts sends the numbers.
 *
 * A song measured with the interim beat source keeps that record until the neural tracker
 * (dsp/analysis/beatThis/) measures it again; reads prefer the neural record.
 *
 * Read only for hashes the caller's own song index holds and has proven, as every derived kind.
 */

export type FactsRecord =
  | { sha: string; version: string; facts: SongFacts }
  | { sha: string; version: string; unreadable: 'too_large' | 'too_long' | 'undecodable' };

export type FactsStore = {
  /** Whether these bytes have a record (facts or unreadable) at `version`: the version of the
   * beat source this device measures with now (the interim one when not given). */
  has(sha: string, version?: string): Promise<boolean>;
  put(record: FactsRecord): Promise<void>;
};

/** The store over the device-wide derived store. A browser that keeps nothing (private
 * browsing) keeps the record for this visit only, so a song is measured once a visit at most. */
export function deviceFactsStore(open: () => Promise<DerivedStore> = derivedStore): FactsStore {
  return {
    async has(sha, version = factsVersion()) {
      return (await (await open()).get<FactsRecord>('analysis', version, sha)) !== null;
    },
    async put(record) {
      await (await open()).put('analysis', record.version, record.sha, record);
    },
  };
}

/** The versions a song's facts are read at, best first. */
export const FACTS_READ_ORDER = [factsVersion(NEURAL_BEATS_IMPLEMENTATION), factsVersion(BROWSER_BEATS_IMPLEMENTATION)] as const;

/** One song's best facts measured here (the neural tracker's before the interim source's), or
 * null when it has none at either version (never measured, unreadable, or measured by an older
 * implementation). `sha` must come from the caller's own song index. */
export async function songFacts(sha: string, open: () => Promise<DerivedStore> = derivedStore): Promise<SongFacts | null> {
  const store = await open();
  for (const version of FACTS_READ_ORDER) {
    const record = await store.get<FactsRecord>('analysis', version, sha);
    if (record && 'facts' in record) return record.facts;
  }
  return null;
}
