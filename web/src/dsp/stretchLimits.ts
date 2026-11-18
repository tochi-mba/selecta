/** The bounds of the browser time-stretch (ADR-0459, BF-0459-05), kept apart from the DSP so
 * the capability record can name the implementation without loading it.
 *
 * The ratio bound matches the native engine's audit limit (src/selecta/audit/checks.py
 * STRETCH_LIMIT = 0.08): a seam may move a song's tempo by at most 8 percent either way. The
 * window bound keeps stretch to the ADR's bounded ahead-of-time windows: a seam's overlap, never
 * a whole song.
 */

export const STRETCH_IMPLEMENTATION = 'wsola-stretch-v1';

/** Tempo ratio = new tempo / old tempo. 1.05 plays 5 percent faster (shorter), same pitch. */
export const STRETCH_MIN_TEMPO_RATIO = 0.92;
export const STRETCH_MAX_TEMPO_RATIO = 1.08;
/** The longest input one call will stretch. */
export const STRETCH_MAX_WINDOW_SECONDS = 60;

export interface StretchUnsupported {
  status: 'unsupported_here';
  reason: string;
  implementation: string;
}

/** Why a request falls outside the bounds, or null when it is inside them. */
export function stretchRefusal(tempoRatio: number, inputSeconds: number): string | null {
  if (!Number.isFinite(tempoRatio) || tempoRatio < STRETCH_MIN_TEMPO_RATIO || tempoRatio > STRETCH_MAX_TEMPO_RATIO) {
    return `a tempo change of ${Number.isFinite(tempoRatio) ? ((tempoRatio - 1) * 100).toFixed(1) : '?'} percent is outside the 8 percent stretch limit`;
  }
  if (!Number.isFinite(inputSeconds) || inputSeconds > STRETCH_MAX_WINDOW_SECONDS) {
    return `stretch works on windows of up to ${STRETCH_MAX_WINDOW_SECONDS} seconds, not whole songs`;
  }
  return null;
}
