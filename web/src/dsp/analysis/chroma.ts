/** librosa.feature.chroma_stft(S=power, sr=22050) as librosa 1.0 computes it, in pieces a
 * streaming pass can use: tuning from spectral peaks (`estimate_tuning` over `piptrack`), the
 * chroma filterbank at that tuning (`filters.chroma`), and the per-frame projection with its
 * max normalisation.
 */

import { medianF32 } from './numeric';

const f32 = Math.fround;

/** The spectral peaks `piptrack` finds in every frame, kept for `estimateTuning`. */
export class PeakCollector {
  private pitches = new Float32Array(1 << 16);
  private mags = new Float32Array(1 << 16);
  private count = 0;
  private readonly low: number;
  private readonly high: number;
  private readonly binHz: number;
  private readonly masked: Float64Array;

  /** `bins` is n_fft / 2 + 1 of the power frames this will see. */
  constructor(readonly sampleRate: number, readonly bins: number, fmin = 150, fmax = 4000) {
    const nFft = 2 * (bins - 1);
    this.binHz = sampleRate / nFft;
    const top = Math.min(fmax, sampleRate / 2);
    // fft_frequencies inside [fmin, fmax)
    let low = bins;
    let high = -1;
    for (let bin = 0; bin < bins; bin += 1) {
      const frequency = (bin * sampleRate) / nFft;
      if (frequency >= Math.max(fmin, 0) && frequency < top) {
        low = Math.min(low, bin);
        high = Math.max(high, bin);
      }
    }
    this.low = low;
    this.high = high;
    this.masked = new Float64Array(bins);
  }

  /** piptrack's peaks in one float32 power frame (threshold 0.1 of the frame's maximum). */
  add(power: Float32Array): void {
    const { bins } = this;
    let largest = -Infinity;
    for (let bin = 0; bin < bins; bin += 1) if (power[bin] > largest) largest = power[bin];
    const reference = f32(0.1 * largest);
    const masked = this.masked;
    for (let bin = 0; bin < bins; bin += 1) masked[bin] = power[bin] > reference ? power[bin] : 0;
    for (let bin = Math.max(this.low, 1); bin <= Math.min(this.high, bins - 2); bin += 1) {
      // util.localmax: above the left neighbour, not below the right one
      if (!(masked[bin] > masked[bin - 1] && masked[bin] >= masked[bin + 1])) continue;
      const left = power[bin - 1];
      const mid = power[bin];
      const right = power[bin + 1];
      // _parabolic_interpolation as numba types it on float32 input: the sums of two float32
      // values stay float32, anything with the integer 2 is float64, the result is stored float32
      const a = f32(right + left) - 2 * mid;
      const b = f32(right - left) / 2;
      const shift = Math.abs(b) >= Math.abs(a) ? 0 : f32(-b / a);
      // np.gradient: the central difference
      const slope = f32(f32(right - left) / 2);
      const dskew = f32(f32(0.5 * slope) * shift);
      const pitch = f32(((bin + shift) * this.sampleRate) / (2 * (bins - 1)));
      this.push(pitch, f32(mid + dskew));
    }
  }

  private push(pitch: number, mag: number): void {
    if (this.count === this.pitches.length) {
      const pitches = new Float32Array(this.count * 2);
      pitches.set(this.pitches);
      this.pitches = pitches;
      const mags = new Float32Array(this.count * 2);
      mags.set(this.mags);
      this.mags = mags;
    }
    this.pitches[this.count] = pitch;
    this.mags[this.count] = mag;
    this.count += 1;
  }

  /** estimate_tuning: the histogram peak of the strong peaks' deviation from the 12-tone grid,
   * in fractions of a semitone, on 0.01 steps from -0.5. */
  tuning(): number {
    const pitches: number[] = [];
    const mags: number[] = [];
    for (let index = 0; index < this.count; index += 1) {
      if (this.pitches[index] > 0) {
        pitches.push(this.pitches[index]);
        mags.push(this.mags[index]);
      }
    }
    const threshold = pitches.length ? medianF32(mags) : 0;
    const chosen: number[] = [];
    for (let index = 0; index < pitches.length; index += 1) if (mags[index] >= threshold) chosen.push(pitches[index]);
    return pitchTuning(chosen);
  }
}

/** librosa.pitch_tuning(frequencies, resolution=0.01, bins_per_octave=12) on float32 input. */
export function pitchTuning(frequencies: number[]): number {
  const positive = frequencies.filter((value) => value > 0);
  if (positive.length === 0) return 0;
  const edges = new Float64Array(101);
  const step = (0.5 - -0.5) / 100;
  for (let k = 0; k < 101; k += 1) edges[k] = k * step + -0.5;
  edges[100] = 0.5;
  const counts = new Int32Array(100);
  const reference = 440 / 16;
  for (const frequency of positive) {
    // 12 * hz_to_octs(f), in float32 as numpy computes it for a float32 array
    const octaves = f32(Math.log2(f32(frequency / reference)));
    let residual = f32(f32(12 * octaves) % 1);
    if (residual < 0) residual = f32(residual + 1);
    if (residual >= 0.5) residual = f32(residual - 1);
    let bin = Math.floor((residual - -0.5) * 100);
    // np.histogram's own edge corrections
    if (bin >= 0 && bin < 100 && residual < edges[bin]) bin -= 1;
    if (bin >= 0 && bin < 99 && residual >= edges[bin + 1]) bin += 1;
    if (residual === 0.5) bin = 99;
    if (bin >= 0 && bin < 100) counts[bin] += 1;
  }
  let best = 0;
  for (let k = 1; k < 100; k += 1) if (counts[k] > counts[best]) best = k;
  return edges[best];
}

/** librosa.filters.chroma(sr, n_fft, tuning, n_chroma=12, ctroct=5, octwidth=2, norm=2,
 * base_c=True), float32, as 12 rows of n_fft / 2 + 1 weights. */
export function chromaFilterbank(sampleRate: number, nFft: number, tuning: number): Float32Array[] {
  const nChroma = 12;
  const a440 = 440 * 2 ** (tuning / nChroma);
  const frqbins = new Float64Array(nFft);
  // frequencies = linspace(0, sr, n_fft, endpoint=False)[1:]
  const step = sampleRate / nFft;
  for (let k = 1; k < nFft; k += 1) frqbins[k] = nChroma * Math.log2((k * step) / (a440 / 16));
  frqbins[0] = frqbins[1] - 1.5 * nChroma;
  const widths = new Float64Array(nFft);
  for (let k = 0; k < nFft - 1; k += 1) widths[k] = Math.max(frqbins[k + 1] - frqbins[k], 1);
  widths[nFft - 1] = 1;
  const half = Math.round(nChroma / 2);
  const columns = 1 + nFft / 2;
  const weights = Array.from({ length: nChroma }, () => new Float64Array(nFft));
  for (let column = 0; column < nFft; column += 1) {
    let norm = 0;
    for (let chroma = 0; chroma < nChroma; chroma += 1) {
      const raw = frqbins[column] - chroma + half + 10 * nChroma;
      // np.remainder: the sign of the divisor
      const distance = (((raw % nChroma) + nChroma) % nChroma) - half;
      const value = Math.exp(-0.5 * ((2 * distance) / widths[column]) ** 2);
      weights[chroma][column] = value;
      norm += value * value;
    }
    norm = Math.sqrt(norm);
    const octave = Math.exp(-0.5 * ((frqbins[column] / nChroma - 5) / 2) ** 2);
    for (let chroma = 0; chroma < nChroma; chroma += 1) {
      // util.normalize's threshold is the smallest normal float64 here (the weights are float64)
      const scaled = norm < 2.2250738585072014e-308 ? weights[chroma][column] : weights[chroma][column] / norm;
      weights[chroma][column] = scaled * octave;
    }
  }
  // base_c: roll by -3 so row 0 is C
  const rows: Float32Array[] = [];
  for (let chroma = 0; chroma < nChroma; chroma += 1) {
    const source = weights[(chroma + 3) % nChroma];
    rows.push(Float32Array.from(source.subarray(0, columns)));
  }
  return rows;
}

/** One frame's chroma: the filterbank over float32 power, then each value over the frame's
 * largest (util.normalize with norm=inf). */
export function chromaFrame(bank: Float32Array[], power: Float32Array, out: Float32Array, offset: number): void {
  let largest = 0;
  const raw = chromaScratch;
  for (let chroma = 0; chroma < 12; chroma += 1) {
    const row = bank[chroma];
    let total = 0;
    for (let bin = 0; bin < row.length; bin += 1) total += row[bin] * power[bin];
    raw[chroma] = f32(total);
    if (Math.abs(raw[chroma]) > largest) largest = Math.abs(raw[chroma]);
  }
  const length = largest < 1.1754943508222875e-38 ? 1 : largest;
  for (let chroma = 0; chroma < 12; chroma += 1) out[offset + chroma] = f32(raw[chroma] / length);
}

const chromaScratch = new Float64Array(12);
