/** Onset timing in src/selecta/render/dsp.py: the transient envelope, the pocket nudge's
 * `onset_offset`, the stretch drift measure `_stretch_lag`, and the windowed-sinc `fine_warp`
 * that moves audio by a fraction of a sample. float32 where numpy works in float32. */

import { lowpassSection, filtfilt, type Channels } from './filters';
import { argmax, f32, Interpolator, kaiser, median, medianFilterNearest, pairwiseSum, pairwiseSum64, interp, sinc } from './npy';
import { SAMPLE_RATE } from './script';

export const ENV_HOP = 128;
export const ENV_HOP_TIME = ENV_HOP / SAMPLE_RATE;

/** The two channels' mean, `audio.mean(axis=1)` in float32. */
export function monoOf(audio: Channels, from = 0, to = audio[0].length): Float32Array {
  const out = new Float32Array(Math.max(0, to - from));
  const [left, right] = audio;
  for (let index = from; index < to; index += 1) out[index - from] = f32(f32(left[index] + right[index]) / 2);
  return out;
}

const frameScratch = new Float32Array(ENV_HOP);

/** `transient_envelope`: positive changes in short-term level on a 2.9 ms grid. */
export function transientEnvelope(mono: Float32Array): Float32Array {
  const frames = Math.floor(mono.length / ENV_HOP);
  const out = new Float32Array(frames);
  let previous = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const first = frame * ENV_HOP;
    for (let k = 0; k < ENV_HOP; k += 1) {
      const index = first + k;
      frameScratch[k] = index === 0 ? 0 : Math.abs(f32(mono[index] - mono[index - 1]));
    }
    const logged = f32(Math.log1p(f32(pairwiseSum(frameScratch, 0, ENV_HOP) * 200)));
    out[frame] = frame === 0 ? 0 : Math.max(f32(logged - previous), 0);
    previous = logged;
  }
  return out;
}

function scaledEnvelope(mono: Float32Array): Float32Array {
  const full = transientEnvelope(mono);
  const low = transientEnvelope(filtfilt(lowpassSection(250), mono, new Float32Array(mono.length)));
  const fullScale = f32(Math.max(maxOf(full), 1e-9));
  const lowScale = f32(Math.max(maxOf(low), 1e-9));
  const out = new Float32Array(full.length);
  for (let index = 0; index < full.length; index += 1) out[index] = f32(f32(full[index] / fullScale) + f32(low[index] / lowScale));
  return out;
}

function maxOf(values: ArrayLike<number>): number {
  let largest = -Infinity;
  for (let index = 0; index < values.length; index += 1) if (values[index] > largest) largest = values[index];
  return largest;
}

/** float32 dot product of `a[aFrom..]` and `b[bFrom..]`, as one float32 value (np.dot of two
 * float32 vectors gives float32; BLAS's own order of adds is not reproduced, so the last bit may
 * differ). */
function dotF32(a: ArrayLike<number>, aFrom: number, b: ArrayLike<number>, bFrom: number, count: number): number {
  let total = 0;
  for (let index = 0; index < count; index += 1) total += a[aFrom + index] * b[bFrom + index];
  return f32(total);
}

/** `onset_offset`: how late `other`'s onsets fall against `reference`'s, in seconds, or null
 * when the answer is unclear (an edge, a weak peak). */
export function onsetOffset(reference: Float32Array, other: Float32Array, reach = 0.02): number | null {
  const envR = scaledEnvelope(reference);
  const envO = scaledEnvelope(other);
  const size = Math.min(envR.length, envO.length);
  const frames = Math.trunc(reach / ENV_HOP_TIME);
  if (size <= frames * 4) return null;
  const width = size - 2 * frames;
  const centred = new Float32Array(width);
  const average = f32(pairwiseSum(envR, frames, width) / width);
  for (let index = 0; index < width; index += 1) centred[index] = f32(envR[frames + index] - average);
  const scores = new Float64Array(2 * frames + 1);
  for (let lag = -frames; lag <= frames; lag += 1) scores[lag + frames] = dotF32(centred, 0, envO, frames + lag, width);
  const best = argmax(scores);
  if (best === 0 || best === scores.length - 1 || scores[best] <= 0) return null;
  if (scores[best] < median(scores) * 1.25) return null;
  let lag = best - frames;
  const left = scores[best - 1];
  const mid = scores[best];
  const right = scores[best + 1];
  const curve = left - 2 * mid + right;
  if (Math.abs(curve) > 1e-9) lag += (0.5 * (left - right)) / curve;
  return lag * ENV_HOP_TIME;
}

/** `_stretch_lag`: windows of the actual envelope slid against the expected one. */
export function stretchLag(reference: Float64Array, actual: Float32Array, window = 2.0, hop = 0.5): { centres: number[]; lags: number[] } {
  const reach = Math.trunc(0.09 / ENV_HOP_TIME);
  const width = Math.trunc(window / ENV_HOP_TIME);
  const step = Math.trunc(hop / ENV_HOP_TIME);
  const centres: number[] = [];
  const lags: number[] = [];
  const limit = Math.min(reference.length, actual.length);
  const ref = new Float64Array(width);
  const scores = new Float64Array(2 * reach + 1);
  for (let start = reach; start < limit - width - reach; start += step) {
    if (pairwiseSum64(reference, start, width) < 1e-3) continue;
    const average = pairwiseSum64(reference, start, width) / width;
    for (let index = 0; index < width; index += 1) ref[index] = reference[start + index] - average;
    for (let lag = -reach; lag <= reach; lag += 1) {
      let total = 0;
      for (let index = 0; index < width; index += 1) total += ref[index] * actual[start + lag + index];
      scores[lag + reach] = total;
    }
    const best = argmax(scores);
    if (scores[best] <= 0) continue;
    let lag = best - reach;
    if (best > 0 && best < scores.length - 1) {
      const left = scores[best - 1];
      const mid = scores[best];
      const right = scores[best + 1];
      const denominator = left - 2 * mid + right;
      if (Math.abs(denominator) > 1e-9) lag += (0.5 * (left - right)) / denominator;
    }
    centres.push((start + width / 2) * ENV_HOP_TIME);
    lags.push(lag * ENV_HOP_TIME);
  }
  return { centres, lags };
}

const SINC_TAPS = 16;
const SINC_PHASES = 256;
let sincTable: Float32Array | null = null;

/** `_sinc_table`: 256 phases of a 16-tap Kaiser (beta 8.6) windowed sinc, each summing to 1. */
export function sincKernels(): Float32Array {
  if (sincTable) return sincTable;
  const half = SINC_TAPS / 2;
  const window = kaiser(SINC_TAPS * 64 + 1, 8.6);
  const grid = Float64Array.from({ length: window.length }, (_, index) => index);
  const table = new Float32Array(SINC_PHASES * SINC_TAPS);
  for (let phase = 0; phase < SINC_PHASES; phase += 1) {
    const fraction = phase / SINC_PHASES;
    for (let tap = 0; tap < SINC_TAPS; tap += 1) {
      const x = -half + 1 + tap - fraction;
      const position = ((x + half) / SINC_TAPS) * (window.length - 1);
      table[phase * SINC_TAPS + tap] = sinc(x) * interp(position, grid, window);
    }
    const total = pairwiseSum(table, phase * SINC_TAPS, SINC_TAPS);
    for (let tap = 0; tap < SINC_TAPS; tap += 1) table[phase * SINC_TAPS + tap] = f32(table[phase * SINC_TAPS + tap] / total);
  }
  sincTable = table;
  return table;
}

/** `fine_warp`: audio read at fractional positions. numpy's einsum adds the 16 products in order
 * in float32, and so does this. */
export function fineWarp(audio: Channels, positions: Float64Array): Channels {
  const table = sincKernels();
  const length = audio[0].length;
  const padded = length + SINC_TAPS;
  return audio.map((channel) => {
    const out = new Float32Array(positions.length);
    for (let index = 0; index < positions.length; index += 1) {
      const where = positions[index];
      const base = Math.floor(where);
      const phase = Math.trunc((where - base) * SINC_PHASES) % SINC_PHASES;
      const row = phase * SINC_TAPS;
      let total = 0;
      for (let tap = 0; tap < SINC_TAPS; tap += 1) {
        // padded index base + 1 + tap, clipped, minus the 8 samples of padding in front
        const at = Math.min(Math.max(base + 1 + tap, 0), padded - 1) - SINC_TAPS / 2;
        const sample = at >= 0 && at < length ? channel[at] : 0;
        total = f32(total + f32(table[row + tap] * sample));
      }
      out[index] = total;
    }
    return out;
  });
}

/** `correct_drift`: the slow timing drift a stretcher leaves, measured against where onsets
 * should be and removed by a resample too small to hear. Returns the audio and the largest lag. */
export function correctDrift(stretched: Channels, expected: Float64Array, count: number): { audio: Channels; drift: number } {
  const actual = transientEnvelope(monoOf(stretched));
  const { centres, lags } = stretchLag(expected, actual);
  if (lags.length < 2) return { audio: stretched.map((channel) => channel.slice(0, count)), drift: 0 };
  const size = Math.min(5, lags.length % 2 ? lags.length : lags.length - 1);
  const smooth = size >= 3 ? Array.from(medianFilterNearest(lags, size)) : lags;
  const curve = new Interpolator(centres, smooth);
  const positions = new Float64Array(count);
  const last = stretched[0].length - 1;
  for (let index = 0; index < count; index += 1) {
    const time = index / SAMPLE_RATE;
    positions[index] = Math.min(Math.max(time * SAMPLE_RATE + curve.at(time) * SAMPLE_RATE, 0), last);
  }
  let drift = 0;
  for (const lag of smooth) drift = Math.max(drift, Math.abs(lag));
  return { audio: fineWarp(stretched, positions), drift };
}
