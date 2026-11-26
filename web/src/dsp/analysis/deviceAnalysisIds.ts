/** The ids that say who measured a song's facts on this device, kept apart from the measuring
 * code so the page can name a version without loading the analysis (which runs in the worker).
 * docs/engineering/device-analysis.md lists them. */

/** The whole-song analysis port (song.ts). The account keeps an allowlist of these
 * (src/selecta/engine_store/facts.py); bump it when any measurement changes what it returns. */
export const DEVICE_ANALYSIS_IMPLEMENTATION = 'web-dsp-1';

/** The Desktop recipe the port follows (`selecta.config.ANALYSIS_VERSION`). */
export const PYTHON_ANALYSIS_VERSION = 3;

/** The interim beat source (beatSource.ts): whole-song autocorrelation tempo and a comb phase. */
export const BROWSER_BEATS_IMPLEMENTATION = 'web-onset-comb-beats-1';

/** The Desktop's neural tracker in the browser (beatThis/source.ts). */
export const NEURAL_BEATS_IMPLEMENTATION = 'web-beatthis-small0-1';

/** The version a stored measurement is keyed by, and the implementation the account is told:
 * the analysis and the beat source together, so a new beat source measures every song again
 * and the account can tell the sources apart. */
export function factsVersion(beatSource = BROWSER_BEATS_IMPLEMENTATION): string {
  return `${DEVICE_ANALYSIS_IMPLEMENTATION}+${beatSource}`;
}

/** Device implementations, lowest first, as the account ranks them (engine_store/facts.py
 * `RANK`). Plain `web-dsp-1` is what clients sent before the beat source was named. */
export const DEVICE_RANK: readonly string[] = [
  DEVICE_ANALYSIS_IMPLEMENTATION,
  factsVersion(BROWSER_BEATS_IMPLEMENTATION),
  factsVersion(NEURAL_BEATS_IMPLEMENTATION),
];

/** Where an implementation stands among this device's; -1 when it is none of them. */
export function deviceRank(implementation: string): number {
  return DEVICE_RANK.indexOf(implementation);
}
