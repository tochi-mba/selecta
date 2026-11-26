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

/** The version a stored measurement is keyed by: the analysis and the beat source together, so
 * a new beat source (Beat This in the browser) measures every song again. */
export function factsVersion(beatSource = BROWSER_BEATS_IMPLEMENTATION): string {
  return `${DEVICE_ANALYSIS_IMPLEMENTATION}+${beatSource}`;
}
