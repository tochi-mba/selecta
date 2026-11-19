/** The bounds of the browser time-stretch (ADR-0459, BF-0459-05), kept apart from the DSP so
 * the capability record can name the implementation without loading it.
 *
 * The ratio bound matches the native engine's audit limit (src/selecta/audit/checks.py
 * STRETCH_LIMIT = 0.08): a seam may move a song's tempo by at most 8 percent either way. The
 * window bound keeps stretch to the ADR's bounded ahead-of-time windows: a seam's overlap, never
 * a whole song.
 */

export const STRETCH_IMPLEMENTATION = 'wsola-stretch-v1';
/** Capability proof that the playback scheduler plays prepared WSOLA buffers: the seam provider
 * renders B's stretched entry clip and engine/scheduler.ts hands it over to native B. A module
 * self-test alone does not mean a mix can use stretch; engine/index.ts passes this token only
 * together with that self-test's evidence. */
export const STRETCH_PLAYBACK_INTEGRATION = 'seam-buffer-preprocessor-v1';

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

/** A tempo ratio held, then eased linearly back to 1: the shape of a stretched seam entry, as
 * src/selecta/styles/timing.py beat_lock eases B back to its own tempo. Seconds are output
 * seconds from the start of the stretched audio. Plain data, so it can cross to a worker. */
export interface StretchRamp {
  ratio: number;
  holdSeconds: number;
  rampSeconds: number;
}

/** The ramp's tempo ratio at `outputSeconds`. */
export function rampRatioAt(ramp: StretchRamp, outputSeconds: number): number {
  if (outputSeconds <= ramp.holdSeconds) return ramp.ratio;
  if (!(ramp.rampSeconds > 0) || outputSeconds >= ramp.holdSeconds + ramp.rampSeconds) return 1;
  return ramp.ratio + ((1 - ramp.ratio) * (outputSeconds - ramp.holdSeconds)) / ramp.rampSeconds;
}

/** Seconds of input the ramp has consumed after `outputSeconds` of output: its integral. */
export function rampSourceSeconds(ramp: StretchRamp, outputSeconds: number): number {
  const { ratio, holdSeconds, rampSeconds } = ramp;
  const t = Math.max(0, outputSeconds);
  if (t <= holdSeconds) return ratio * t;
  const ramped = Math.min(t - holdSeconds, Math.max(0, rampSeconds));
  const reached = rampSeconds > 0 ? ratio + ((1 - ratio) * ramped) / rampSeconds : 1;
  return ratio * holdSeconds + (ramped * (ratio + reached)) / 2 + Math.max(0, t - holdSeconds - ramped);
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
