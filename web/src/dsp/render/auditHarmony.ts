/** The audit's harmony check (`_harmony` in src/selecta/audit/checks.py): how rough the overlap
 * is, over and above how rough each song is alone, from the chroma of each dry side.
 *
 * The chroma is librosa's `chroma_stft(S=power, sr=22050, norm=None)` over 4096-point frames
 * every 2048 samples, with the tuning estimated from the frames' own peaks. The pieces are the
 * whole-song analysis port's (analysis/chroma.ts, analysis/fftPlan.ts), at this frame size; the
 * 22,050 Hz signal comes from the analysis resampler where the Desktop uses soxr.
 */

import { chromaFilterbank, PeakCollector } from '../analysis/chroma';
import { PowerFrames, stftFrameCount } from '../analysis/fftPlan';
import { resample } from '../analysis/resample';
import { monoOf } from './envelope';
import type { Channels } from './filters';
import { f32, pairwiseSum64 } from './npy';
import { SAMPLE_RATE } from './script';

export const HARMONY_LIMIT = 0.16;
export const ROUGHNESS_BY_INTERVAL = [0.0, 1.0, 0.45, 0.12, 0.1, 0.03, 0.6, 0.03, 0.1, 0.12, 0.45, 1.0];
const CHROMA_RATE = 22_050;
const N_FFT = 4096;
const HOP = 2048;

/** `_chroma_frames`: 12 rows of float32 chroma, one value per frame, with no normalisation. */
export function chromaFrames(audio: Channels, from: number, to: number): Float32Array[] {
  const mono = resample(monoOf(audio, from, Math.min(to, audio[0].length)), SAMPLE_RATE, CHROMA_RATE);
  const frames = stftFrameCount(mono.length, HOP);
  const stft = new PowerFrames(N_FFT, HOP);
  const bins = stft.fft.bins;
  const powers = new Float32Array(frames * bins);
  const peaks = new PeakCollector(CHROMA_RATE, bins);
  for (let frame = 0; frame < frames; frame += 1) {
    const power = powers.subarray(frame * bins, (frame + 1) * bins);
    stft.power(mono, frame, power);
    peaks.add(power);
  }
  const bank = chromaFilterbank(CHROMA_RATE, N_FFT, peaks.tuning());
  const out = Array.from({ length: 12 }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    const power = powers.subarray(frame * bins, (frame + 1) * bins);
    for (let chroma = 0; chroma < 12; chroma += 1) {
      const row = bank[chroma];
      let total = 0;
      for (let bin = 0; bin < bins; bin += 1) total += row[bin] * power[bin];
      out[chroma][frame] = total;
    }
  }
  return out;
}

/** Each frame over its sum, as numpy does it: the 12 rows added one after another in float32. */
function shares(chroma: Float32Array[]): Float32Array[] {
  const frames = chroma[0].length;
  const totals = new Float32Array(frames);
  for (const row of chroma) for (let frame = 0; frame < frames; frame += 1) totals[frame] = f32(totals[frame] + row[frame]);
  const floor = f32(1e-9);
  return chroma.map((row) => Float32Array.from(row, (value, frame) => f32(value / Math.max(totals[frame], floor))));
}

/** `_roughness`: the mean over frames of a's chroma, the interval kernel, and b's chroma. */
export function roughness(chromaA: Float32Array[], chromaB: Float32Array[]): number {
  const a = shares(chromaA);
  const b = shares(chromaB);
  const frames = a[0].length;
  const perFrame = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let total = 0;
    for (let i = 0; i < 12; i += 1) {
      for (let j = 0; j < 12; j += 1) total += a[i][frame] * ROUGHNESS_BY_INTERVAL[(((j - i) % 12) + 12) % 12] * b[j][frame];
    }
    perFrame[frame] = total;
  }
  return pairwiseSum64(perFrame, 0, frames) / frames;
}

/** together minus the mean of each alone. */
export function excessRoughness(aDry: Channels, bDry: Channels, from: number, to: number): number {
  const chromaA = chromaFrames(aDry, from, to);
  const chromaB = chromaFrames(bDry, from, to);
  const together = roughness(chromaA, chromaB);
  const alone = (roughness(chromaA, chromaA) + roughness(chromaB, chromaB)) / 2;
  return together - alone;
}
