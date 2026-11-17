/** Spectral-flux onset detection (ADR-0459 Tier 2, BF-0459-03).
 *
 * Frames the signal (default 1024-sample Hann frames, 256-sample hop), takes the magnitude
 * spectrum from the dependency-free FFT, log-compresses it, and sums the positive per-bin
 * change between frames. Peaks in the flux envelope mark onsets. This is the lightweight
 * estimate, a different implementation from the native engine's librosa onset strength, and
 * every result says so through its implementation id.
 *
 * Pure and deterministic; runs in a worker, never on the audio callback.
 */

import { realMagnitudeSpectrum } from '../fft';

export const ONSETS_IMPLEMENTATION = 'spectral-flux-onsets-v1';

export const DEFAULT_FRAME_SIZE = 1024;
export const DEFAULT_HOP_SIZE = 256;

export interface OnsetOptions {
  /** Power-of-two analysis frame length in samples. Default 1024. */
  frameSize?: number;
  /** Hop between frames in samples. Default 256. */
  hopSize?: number;
}

export interface OnsetResult {
  implementation: string;
  /** Spectral flux per frame, normalised so the largest value is 1 (all-zero when silent). */
  flux: Float32Array;
  /** Seconds between consecutive flux frames. */
  hopSeconds: number;
  frameSize: number;
  hopSize: number;
  /** Detected onset times in seconds (peaks in the flux envelope). */
  onsetTimes: number[];
}

/** Spectral flux over one mono channel. */
export function detectOnsets(
  channel: Float32Array,
  sampleRate: number,
  options: OnsetOptions = {}
): OnsetResult {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  const hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
  const frames = channel.length >= frameSize ? Math.floor((channel.length - frameSize) / hopSize) + 1 : 0;
  const flux = new Float32Array(Math.max(frames, 0));
  let previous: Float64Array | null = null;
  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * hopSize;
    const spectrum = realMagnitudeSpectrum(channel.subarray(start, start + frameSize));
    for (let bin = 0; bin < spectrum.length; bin += 1) {
      spectrum[bin] = Math.log1p(spectrum[bin] * 100);
    }
    if (previous) {
      let sum = 0;
      for (let bin = 0; bin < spectrum.length; bin += 1) {
        const rise = spectrum[bin] - previous[bin];
        if (rise > 0) {
          sum += rise;
        }
      }
      flux[frame] = sum;
    }
    previous = spectrum;
  }
  let largest = 0;
  for (let frame = 0; frame < flux.length; frame += 1) {
    if (flux[frame] > largest) {
      largest = flux[frame];
    }
  }
  if (largest > 0) {
    for (let frame = 0; frame < flux.length; frame += 1) {
      flux[frame] /= largest;
    }
  }
  const hopSeconds = hopSize / sampleRate;
  return {
    implementation: ONSETS_IMPLEMENTATION,
    flux,
    hopSeconds,
    frameSize,
    hopSize,
    onsetTimes: pickPeaks(flux, hopSeconds),
  };
}

/** Local maxima above an adaptive threshold (mean + half a standard deviation), at least
 * 50 ms apart. */
export function pickPeaks(flux: Float32Array, hopSeconds: number): number[] {
  if (flux.length < 3) {
    return [];
  }
  let mean = 0;
  for (let frame = 0; frame < flux.length; frame += 1) {
    mean += flux[frame];
  }
  mean /= flux.length;
  let variance = 0;
  for (let frame = 0; frame < flux.length; frame += 1) {
    const offset = flux[frame] - mean;
    variance += offset * offset;
  }
  const threshold = mean + 0.5 * Math.sqrt(variance / flux.length);
  const gapFrames = Math.max(1, Math.round(0.05 / hopSeconds));
  const times: number[] = [];
  let lastPeak = -gapFrames - 1;
  for (let frame = 1; frame < flux.length - 1; frame += 1) {
    const value = flux[frame];
    if (value <= threshold || value < flux[frame - 1] || value <= flux[frame + 1]) {
      continue;
    }
    if (frame - lastPeak <= gapFrames) {
      continue;
    }
    lastPeak = frame;
    times.push(frame * hopSeconds);
  }
  return times;
}
