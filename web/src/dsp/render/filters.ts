/** The zero-phase filters of src/selecta/render/dsp.py: a second-order Butterworth run forwards
 * and backwards (scipy `sosfiltfilt`), the band split built from it, and the moving sweep.
 *
 * Exactness: the section is designed in closed form (bilinear transform, `tan(pi fc / fs)`),
 * within a few parts in 1e16 of scipy's `butter(2, fc, fs, output="sos")`; the odd extension,
 * the steady-state initial conditions and the direct form II transposed loop are scipy's, in
 * float64, rounded to float32 at the end as `zero_phase_lowpass` does. Scratch buffers are kept
 * between calls so a render does not allocate per filter.
 */

import { f32, interp, linspace } from './npy';
import { SAMPLE_RATE } from './script';

export const LOW_SPLIT_HZ = 200;
export const HIGH_SPLIT_HZ = 2500;
const PAD = 9;

/** One second-order section: b0, b1, b2, a1, a2 (a0 is 1), and its steady-state state. */
export interface Section {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  z0: number;
  z1: number;
}

const sections = new Map<number, Section>();

/** `butter(2, cutoff, btype="lowpass", fs=44100, output="sos")`, and `sosfilt_zi` for it. */
export function lowpassSection(cutoffHz: number, sampleRate = SAMPLE_RATE): Section {
  const key = cutoffHz * 1e6 + sampleRate;
  const kept = sections.get(key);
  if (kept) return kept;
  const k = Math.tan((Math.PI * cutoffHz) / sampleRate);
  const norm = 1 / (1 + Math.SQRT2 * k + k * k);
  const b0 = k * k * norm;
  const b1 = 2 * b0;
  const b2 = b0;
  const a1 = 2 * (k * k - 1) * norm;
  const a2 = (1 - Math.SQRT2 * k + k * k) * norm;
  // lfilter_zi: solve (I - companion(a).T) zi = b[1:] - a[1:] b0 by LU with partial pivoting
  let m00 = 1 + a1;
  let m01 = -1;
  let m10 = a2;
  let m11 = 1;
  let r0 = b1 - a1 * b0;
  let r1 = b2 - a2 * b0;
  if (Math.abs(m10) > Math.abs(m00)) {
    [m00, m01, m10, m11, r0, r1] = [m10, m11, m00, m01, r1, r0];
  }
  const l = m10 / m00;
  const z1 = (r1 - l * r0) / (m11 - l * m01);
  const z0 = (r0 - m01 * z1) / m00;
  const section = { b0, b1, b2, a1, a2, z0, z1 };
  sections.set(key, section);
  return section;
}

let scratch = new Float64Array(0);

function work(size: number): Float64Array {
  if (scratch.length < size) scratch = new Float64Array(size);
  return scratch;
}

/** `sosfiltfilt(sos, x)` of one float32 channel into `out` (float32), which may be `x` itself. */
export function filtfilt(section: Section, x: Float32Array, out: Float32Array): Float32Array {
  const n = x.length;
  if (n <= PAD) throw new Error(`a zero-phase filter needs more than ${PAD} samples`);
  const m = n + 2 * PAD;
  const y = work(m);
  // the odd extension, computed in float32 like the float32 input it is made from
  const twiceFirst = f32(2 * x[0]);
  const twiceLast = f32(2 * x[n - 1]);
  for (let index = 0; index < PAD; index += 1) {
    y[index] = f32(twiceFirst - x[PAD - index]);
    y[PAD + n + index] = f32(twiceLast - x[n - 2 - index]);
  }
  for (let index = 0; index < n; index += 1) y[PAD + index] = x[index];
  const { b0, b1, b2, a1, a2 } = section;
  let z0 = section.z0 * y[0];
  let z1 = section.z1 * y[0];
  for (let index = 0; index < m; index += 1) {
    const value = y[index];
    const next = b0 * value + z0;
    z0 = b1 * value - a1 * next + z1;
    z1 = b2 * value - a2 * next;
    y[index] = next;
  }
  const last = y[m - 1];
  z0 = section.z0 * last;
  z1 = section.z1 * last;
  for (let index = m - 1; index >= 0; index -= 1) {
    const value = y[index];
    const next = b0 * value + z0;
    z0 = b1 * value - a1 * next + z1;
    z1 = b2 * value - a2 * next;
    y[index] = next;
  }
  for (let index = 0; index < n; index += 1) out[index] = y[index + PAD];
  return out;
}

export type Channels = Float32Array[];

/** `zero_phase_lowpass`: every channel, float32. */
export function zeroPhaseLowpass(audio: Channels, cutoffHz: number): Channels {
  const section = lowpassSection(cutoffHz);
  return audio.map((channel) => filtfilt(section, channel, new Float32Array(channel.length)));
}

/** `zero_phase_highpass`: the input minus its lowpass, in float32. */
export function zeroPhaseHighpass(audio: Channels, cutoffHz: number): Channels {
  const low = zeroPhaseLowpass(audio, cutoffHz);
  low.forEach((channel, c) => {
    const input = audio[c];
    for (let index = 0; index < channel.length; index += 1) channel[index] = f32(input[index] - channel[index]);
  });
  return low;
}

/** `split_bands`: low, mid and high that sum to the input exactly. */
export function splitBands(audio: Channels): [Channels, Channels, Channels] {
  const low = zeroPhaseLowpass(audio, LOW_SPLIT_HZ);
  const high = zeroPhaseHighpass(audio, HIGH_SPLIT_HZ);
  const mid = audio.map((channel, c) => {
    const out = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) out[index] = f32(f32(channel[index] - low[c][index]) - high[c][index]);
    return out;
  });
  return [low, mid, high];
}

/** `sweep_filter`: a moving filter made by crossfading a bank of fixed zero-phase filters, all
 * in phase with each other. Python stacks the whole bank; this runs one member at a time and adds
 * it where it is used, which gives the same float32 sums with one member in memory. */
export function sweepFilter(audio: Channels, cutoffs: Float32Array, highpass: boolean): Channels {
  const n = cutoffs.length;
  let low = Infinity;
  let high = -Infinity;
  for (const cutoff of cutoffs) {
    if (cutoff < low) low = cutoff;
    if (cutoff > high) high = cutoff;
  }
  const count = Math.max(2, Math.ceil(Math.log2(Math.max(high / Math.max(low, 1), 1.01)) * 3) + 1);
  const centres = geomspace(Math.max(low, 10), Math.min(high, SAMPLE_RATE * 0.45), count);
  const logCentres = Float64Array.from(centres, Math.log);
  const steps = Float64Array.from({ length: count }, (_, index) => index);
  const lower = new Int32Array(n);
  const fraction = new Float32Array(n);
  const used = new Uint8Array(count);
  for (let index = 0; index < n; index += 1) {
    // np.log of a float32 array is taken in float32
    const position = interp(f32(Math.log(Math.max(cutoffs[index], 1))), logCentres, steps);
    const bottom = Math.min(Math.trunc(position), count - 2);
    lower[index] = bottom;
    fraction[index] = position - bottom;
    used[bottom] = 1;
    used[bottom + 1] = 1;
  }
  const out = audio.map((channel) => new Float32Array(channel.length));
  const member = audio.map((channel) => new Float32Array(channel.length));
  for (let c = 0; c < count; c += 1) {
    if (!used[c]) continue;
    const section = lowpassSection(centres[c]);
    audio.forEach((channel, k) => {
      const filtered = filtfilt(section, channel, member[k]);
      if (highpass) for (let index = 0; index < channel.length; index += 1) filtered[index] = f32(channel[index] - filtered[index]);
      const target = out[k];
      for (let index = 0; index < n; index += 1) {
        if (lower[index] === c) target[index] = f32(filtered[index] * f32(1 - fraction[index]));
        else if (lower[index] + 1 === c) target[index] = f32(target[index] + f32(filtered[index] * fraction[index]));
      }
    });
  }
  return out;
}

/** `np.geomspace(start, stop, count)` for positive ends: 10 to the evenly spaced log10s, with
 * the ends set to `start` and `stop` exactly. */
export function geomspace(start: number, stop: number, count: number): Float64Array {
  const exponents = linspace(Math.log10(start), Math.log10(stop), count);
  const out = Float64Array.from(exponents, (exponent) => 10 ** exponent);
  if (count > 0) out[0] = start;
  if (count > 1) out[count - 1] = stop;
  return out;
}
