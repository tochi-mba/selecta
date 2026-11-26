/** A reusable real FFT plan and the STFT framing librosa uses (device studio, whole-song analysis).
 *
 * One plan per frame size, built once: twiddles and the bit-reversal table are precomputed, the
 * work buffers are reused, and a frame allocates nothing. A real frame of N samples is packed
 * into an N/2-point complex FFT and split afterwards, which halves the work of the plain complex
 * FFT in ../fft.ts. Double precision throughout; callers round to float32 where numpy does.
 */

import { isPowerOfTwo } from '../fft';

export class RealFft {
  readonly size: number;
  /** Bins 0..size/2 inclusive. */
  readonly bins: number;
  private readonly half: number;
  private readonly reverse: Uint32Array;
  private readonly twiddleRe: Float64Array;
  private readonly twiddleIm: Float64Array;
  private readonly splitCos: Float64Array;
  private readonly splitSin: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(size: number) {
    if (!isPowerOfTwo(size) || size < 4) throw new Error('RealFft needs a power-of-two size of at least 4.');
    this.size = size;
    this.bins = size / 2 + 1;
    const half = size / 2;
    this.half = half;
    this.reverse = new Uint32Array(half);
    const bits = Math.log2(half);
    for (let index = 0; index < half; index += 1) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit += 1) reversed |= ((index >> bit) & 1) << (bits - 1 - bit);
      this.reverse[index] = reversed;
    }
    this.twiddleRe = new Float64Array(half / 2);
    this.twiddleIm = new Float64Array(half / 2);
    for (let k = 0; k < half / 2; k += 1) {
      this.twiddleRe[k] = Math.cos((-2 * Math.PI * k) / half);
      this.twiddleIm[k] = Math.sin((-2 * Math.PI * k) / half);
    }
    this.splitCos = new Float64Array(half + 1);
    this.splitSin = new Float64Array(half + 1);
    for (let k = 0; k <= half; k += 1) {
      this.splitCos[k] = Math.cos((2 * Math.PI * k) / size);
      this.splitSin[k] = Math.sin((2 * Math.PI * k) / size);
    }
    this.re = new Float64Array(half);
    this.im = new Float64Array(half);
  }

  /** The spectrum of one real frame into `outRe` and `outIm` (each `bins` long). */
  forward(frame: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
    const { half, re, im, reverse } = this;
    for (let index = 0; index < half; index += 1) {
      const to = reverse[index];
      re[to] = frame[2 * index];
      im[to] = frame[2 * index + 1];
    }
    for (let width = 2; width <= half; width <<= 1) {
      const step = half / width;
      const span = width >> 1;
      for (let start = 0; start < half; start += width) {
        for (let offset = 0; offset < span; offset += 1) {
          const wr = this.twiddleRe[offset * step];
          const wi = this.twiddleIm[offset * step];
          const even = start + offset;
          const odd = even + span;
          const pr = re[odd] * wr - im[odd] * wi;
          const pi = re[odd] * wi + im[odd] * wr;
          re[odd] = re[even] - pr;
          im[odd] = im[even] - pi;
          re[even] += pr;
          im[even] += pi;
        }
      }
    }
    // split the packed transform into the real signal's spectrum
    for (let k = 0; k <= half; k += 1) {
      const a = re[k % half];
      const b = im[k % half];
      const c = re[(half - k) % half];
      const d = im[(half - k) % half];
      const evenRe = (a + c) / 2;
      const evenIm = (b - d) / 2;
      const oddRe = (b + d) / 2;
      const oddIm = -(a - c) / 2;
      const cos = this.splitCos[k];
      const sin = this.splitSin[k];
      outRe[k] = evenRe + cos * oddRe + sin * oddIm;
      outIm[k] = evenIm + cos * oddIm - sin * oddRe;
    }
  }
}

const periodicHann = new Map<number, Float64Array>();

/** scipy.signal.get_window('hann', n, fftbins=True), built the way scipy builds it: the
 * symmetric n+1 window 0.5 + 0.5 cos(x) on linspace(-pi, pi), last point dropped. */
export function hannPeriodic(size: number): Float64Array {
  const cached = periodicHann.get(size);
  if (cached) return cached;
  const window = new Float64Array(size);
  const step = (Math.PI - -Math.PI) / size;
  for (let index = 0; index < size; index += 1) {
    const x = index * step + -Math.PI;
    window[index] = 0.5 + 0.5 * Math.cos(x);
  }
  periodicHann.set(size, window);
  return window;
}

/** Frames in librosa's centred STFT: 1 + floor(length / hop). */
export function stftFrameCount(length: number, hop: number): number {
  return 1 + Math.floor(length / hop);
}

/** One centred STFT power frame, as `np.abs(librosa.stft(y))**2` gives it for float32 `y`:
 * zero padding of n/2 at both ends, a periodic Hann window, the complex result rounded to
 * complex64, its magnitude to float32, squared in float32. Writes `bins` values into `power`. */
export class PowerFrames {
  readonly fft: RealFft;
  readonly hop: number;
  private readonly window: Float64Array;
  private readonly frame: Float64Array;
  private readonly specRe: Float64Array;
  private readonly specIm: Float64Array;

  constructor(size: number, hop: number) {
    this.fft = new RealFft(size);
    this.hop = hop;
    this.window = hannPeriodic(size);
    this.frame = new Float64Array(size);
    this.specRe = new Float64Array(this.fft.bins);
    this.specIm = new Float64Array(this.fft.bins);
  }

  power(signal: Float32Array, index: number, power: Float32Array): void {
    const size = this.fft.size;
    const start = index * this.hop - size / 2;
    const { frame, window } = this;
    for (let k = 0; k < size; k += 1) {
      const at = start + k;
      frame[k] = at >= 0 && at < signal.length ? window[k] * signal[at] : 0;
    }
    this.fft.forward(frame, this.specRe, this.specIm);
    for (let bin = 0; bin < this.fft.bins; bin += 1) {
      const re = Math.fround(this.specRe[bin]);
      const im = Math.fround(this.specIm[bin]);
      const magnitude = Math.fround(Math.hypot(re, im));
      power[bin] = Math.fround(magnitude * magnitude);
    }
  }
}
