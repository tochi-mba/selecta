/** Tempo from onset-flux autocorrelation, with honest half/double-time handling
 * (ADR-0459 Tier 2, BF-0459-03).
 *
 * The flux envelope is autocorrelated over lags covering 50 to 210 BPM. Candidates are scored
 * by autocorrelation times a log-normal tempo prior centred on 120 BPM (one octave sigma),
 * and the winner's lag is refined by parabolic interpolation. A confident-looking estimate
 * that is exactly double or half the truth is the known failure of lightweight tempo, so when
 * the half-time or double-time candidate scores within 15 percent of the winner the result is
 * flagged `ambiguous: true` and its confidence is capped low; the seam scripter treats that as
 * low confidence and falls back to a fade rather than cutting badly.
 *
 * Pure and deterministic. This is the lightweight estimate, never the neural engine.
 */

import type { OnsetResult } from './onsets';

export const TEMPO_IMPLEMENTATION = 'onset-autocorrelation-tempo-v1';

export const MIN_BPM = 50;
export const MAX_BPM = 210;
/** Octave candidates within this score ratio of the winner make the estimate ambiguous. */
export const OCTAVE_AMBIGUITY_RATIO = 0.85;
/** The ceiling an ambiguous estimate's confidence is capped to. */
export const AMBIGUOUS_CONFIDENCE_CAP = 0.35;
const PRIOR_CENTRE_BPM = 120;
const PRIOR_SIGMA_OCTAVES = 1;

export interface TempoEstimate {
  implementation: string;
  bpm: number;
  /** In [0, 1]. Capped at AMBIGUOUS_CONFIDENCE_CAP when ambiguous. */
  confidence: number;
  /** True when half- or double-time scored within 15 percent of the winner. */
  ambiguous: boolean;
}

function prior(bpm: number): number {
  const octaves = Math.log2(bpm / PRIOR_CENTRE_BPM) / PRIOR_SIGMA_OCTAVES;
  return Math.exp(-0.5 * octaves * octaves);
}

function autocorrelate(flux: Float32Array, maxLag: number): Float64Array {
  const acf = new Float64Array(maxLag + 1);
  const length = flux.length;
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index + lag < length; index += 1) {
      sum += flux[index] * flux[index + lag];
    }
    acf[lag] = sum;
  }
  return acf;
}

/** The strongest local autocorrelation value within +-2 lags of `around`. */
function localPeak(acf: Float64Array, around: number): number {
  let best = 0;
  const from = Math.max(1, around - 2);
  const to = Math.min(acf.length - 1, around + 2);
  for (let lag = from; lag <= to; lag += 1) {
    if (acf[lag] > best) {
      best = acf[lag];
    }
  }
  return best;
}

/** Estimate tempo from a spectral-flux onset envelope. */
export function estimateTempo(onsets: Pick<OnsetResult, 'flux' | 'hopSeconds'>): TempoEstimate {
  const { flux, hopSeconds } = onsets;
  const minLag = Math.max(2, Math.round(60 / MAX_BPM / hopSeconds));
  const maxLag = Math.min(flux.length - 2, Math.round(60 / MIN_BPM / hopSeconds));
  if (maxLag <= minLag + 2 || flux.length < 4) {
    return { implementation: TEMPO_IMPLEMENTATION, bpm: 0, confidence: 0, ambiguous: false };
  }
  const acf = autocorrelate(flux, Math.min(flux.length - 1, maxLag * 2 + 2));
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (acf[lag] < acf[lag - 1] || acf[lag] <= acf[lag + 1]) {
      continue; // candidates are local maxima of the autocorrelation
    }
    const score = acf[lag] * prior(60 / (lag * hopSeconds));
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (!Number.isFinite(bestScore) || acf[0] <= 0) {
    return { implementation: TEMPO_IMPLEMENTATION, bpm: 0, confidence: 0, ambiguous: false };
  }
  // Parabolic refinement of the winning lag for sub-hop tempo precision.
  let refinedLag = bestLag;
  if (bestLag > 1 && bestLag < acf.length - 1) {
    const left = acf[bestLag - 1];
    const mid = acf[bestLag];
    const right = acf[bestLag + 1];
    const curve = left - 2 * mid + right;
    if (Math.abs(curve) > 1e-12) {
      refinedLag = bestLag + (0.5 * (left - right)) / curve;
    }
  }
  const bpm = 60 / (refinedLag * hopSeconds);

  // Explicit half/double-time check: prior-weighted scores of the octave candidates.
  let ambiguous = false;
  for (const octaveLag of [bestLag * 2, Math.round(bestLag / 2)]) {
    const octaveBpm = 60 / (octaveLag * hopSeconds);
    if (octaveBpm < MIN_BPM || octaveBpm > MAX_BPM || octaveLag >= acf.length) {
      continue;
    }
    const octaveScore = localPeak(acf, octaveLag) * prior(octaveBpm);
    if (octaveScore >= bestScore * OCTAVE_AMBIGUITY_RATIO) {
      ambiguous = true;
    }
  }

  // Confidence: how dominant the beat period is in the envelope's own energy.
  const periodicity = Math.min(Math.max(acf[bestLag] / acf[0], 0), 1);
  let confidence = Math.min(periodicity * 1.5, 1);
  if (ambiguous) {
    confidence = Math.min(confidence, AMBIGUOUS_CONFIDENCE_CAP);
  }
  return { implementation: TEMPO_IMPLEMENTATION, bpm, confidence, ambiguous };
}
