/** Key estimate: FFT chroma plus Krumhansl-Schmuckler template matching
 * (ADR-0459 Tier 2, BF-0459-03).
 *
 * Implementation 'lightweight-chroma-v1'. This is the chroma second opinion of the native
 * engine (`src/selecta/analysis/key.py::chroma_key`), never the neural S-KEY model, and no
 * result from here may be presented as the neural engine's output.
 *
 * Frames: 4096-sample Hann frames, 1024-sample hop (documented defaults). Each frame's power
 * spectrum is folded onto 12 pitch classes (A440 tuning), averaged over time, and matched
 * against the Krumhansl-Schmuckler major and minor templates by mean-centred correlation,
 * exactly as the Python reference scores them.
 */

import { realMagnitudeSpectrum } from '../fft';

export const KEY_IMPLEMENTATION = 'lightweight-chroma-v1';

export const KEY_FRAME_SIZE = 4096;
export const KEY_HOP_SIZE = 1024;

/** Pitch-class names, matching `_NAMES` in src/selecta/analysis/key.py (index 0 = C). */
export const PITCH_NAMES = [
  'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

/** Krumhansl-Schmuckler profiles, matching `_KS_MAJOR` and `_KS_MINOR` in the reference. */
export const KS_MAJOR = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
] as const;
export const KS_MINOR = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
] as const;

export interface KeyEstimate {
  implementation: string;
  /** Pitch-class name from PITCH_NAMES, e.g. 'C'. */
  key: string;
  mode: 'major' | 'minor';
  /** In [0, 1]: how clearly the best template beat the runner-up. */
  confidence: number;
  /** The averaged 12-bin chroma profile the match was made on. */
  chroma: number[];
}

/** Average 12-bin chroma profile (power weighted) over the whole channel. */
export function chromaProfile(
  channel: Float32Array,
  sampleRate: number,
  frameSize = KEY_FRAME_SIZE,
  hopSize = KEY_HOP_SIZE
): number[] {
  const profile = new Float64Array(12);
  const frames = channel.length >= frameSize ? Math.floor((channel.length - frameSize) / hopSize) + 1 : 0;
  const binHz = sampleRate / frameSize;
  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * hopSize;
    const spectrum = realMagnitudeSpectrum(channel.subarray(start, start + frameSize));
    // Skip bin 0 (DC) and anything below 27.5 Hz or above 5 kHz: outside melodic range.
    for (let bin = 1; bin < spectrum.length; bin += 1) {
      const frequency = bin * binHz;
      if (frequency < 27.5 || frequency > 5000) {
        continue;
      }
      const midi = 69 + 12 * Math.log2(frequency / 440);
      const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
      profile[pitchClass] += spectrum[bin] * spectrum[bin];
    }
  }
  const largest = Math.max(...profile, 1e-12);
  return [...profile].map((value) => value / largest);
}

function centred(values: readonly number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.map((value) => value - mean);
}

function rotated(values: number[], by: number): number[] {
  return values.map((_, index) => values[(index - by + 12) % 12]);
}

function correlation(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < 12; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return dot / Math.max(Math.sqrt(normA * normB), 1e-12);
}

/** Match a chroma profile against all 24 Krumhansl-Schmuckler keys. */
export function matchKey(chroma: number[]): KeyEstimate {
  const profile = centred(chroma);
  const majors = centred(KS_MAJOR);
  const minors = centred(KS_MINOR);
  let best = { score: -Infinity, tonic: 0, mode: 'major' as 'major' | 'minor' };
  let runnerUp = -Infinity;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const [template, mode] of [
      [majors, 'major'],
      [minors, 'minor'],
    ] as const) {
      const score = correlation(profile, rotated(template, tonic));
      if (score > best.score) {
        runnerUp = best.score;
        best = { score, tonic, mode };
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }
  }
  const margin = best.score - Math.max(runnerUp, -1);
  const confidence = Math.min(Math.max(best.score, 0) * Math.min(margin * 4 + 0.5, 1), 1);
  return {
    implementation: KEY_IMPLEMENTATION,
    key: PITCH_NAMES[best.tonic],
    mode: best.mode,
    confidence: Math.max(confidence, 0),
    chroma: [...chroma],
  };
}

/** Chroma extraction and template match in one call. */
export function estimateKey(channel: Float32Array, sampleRate: number): KeyEstimate {
  return matchKey(chromaProfile(channel, sampleRate));
}
