/** Stereo convolution for the reverb (`fftconvolve(send, response, axes=0)` in dsp.reverb_tail).
 *
 * Overlap-add with one complex FFT per block for both channels: left goes in the real part and
 * right in the imaginary part, the two spectra are pulled apart by symmetry, each is multiplied
 * by its own channel's response, and they go back together for one inverse transform. A block of
 * silence is skipped (it adds nothing). Double precision throughout; scipy works in float32 for
 * float32 input, so the two differ by float32 rounding, about 1e-7 of the signal.
 */

export class ComplexFft {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (!(size >= 2 && (size & (size - 1)) === 0)) throw new Error('ComplexFft needs a power-of-two size.');
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let k = 0; k < size / 2; k += 1) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / size);
      this.sin[k] = -Math.sin((2 * Math.PI * k) / size);
    }
    const bits = Math.log2(size);
    this.reverse = new Uint32Array(size);
    for (let index = 0; index < size; index += 1) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit += 1) reversed |= ((index >> bit) & 1) << (bits - 1 - bit);
      this.reverse[index] = reversed;
    }
  }

  /** In place. `inverse` runs the conjugate transform and divides by the size. */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const { size, reverse } = this;
    for (let index = 0; index < size; index += 1) {
      const to = reverse[index];
      if (index < to) {
        const r = re[index];
        re[index] = re[to];
        re[to] = r;
        const i = im[index];
        im[index] = im[to];
        im[to] = i;
      }
    }
    const sign = inverse ? -1 : 1;
    for (let width = 2; width <= size; width <<= 1) {
      const half = width >> 1;
      const step = size / width;
      for (let start = 0; start < size; start += width) {
        for (let offset = 0; offset < half; offset += 1) {
          const wr = this.cos[offset * step];
          const wi = sign * this.sin[offset * step];
          const even = start + offset;
          const odd = even + half;
          const pr = re[odd] * wr - im[odd] * wi;
          const pi = re[odd] * wi + im[odd] * wr;
          re[odd] = re[even] - pr;
          im[odd] = im[even] - pi;
          re[even] += pr;
          im[even] += pi;
        }
      }
    }
    if (inverse) {
      for (let index = 0; index < size; index += 1) {
        re[index] /= size;
        im[index] /= size;
      }
    }
  }
}

/** The first `count` samples of each channel of `signal` convolved with the same channel of
 * `response`, as float32. */
export function convolveStereo(signal: Float32Array[], response: Float32Array[], count: number): Float32Array[] {
  const taps = response[0].length;
  let size = 2;
  while (size < 2 * taps) size <<= 1;
  const block = size - taps + 1;
  const fft = new ComplexFft(size);
  // both channels' responses from one transform
  const hr = new Float64Array(size);
  const hi = new Float64Array(size);
  hr.set(response[0]);
  hi.set(response[1]);
  fft.transform(hr, hi);
  const leftRe = new Float64Array(size);
  const leftIm = new Float64Array(size);
  const rightRe = new Float64Array(size);
  const rightIm = new Float64Array(size);
  for (let k = 0; k < size; k += 1) {
    const j = (size - k) % size;
    leftRe[k] = (hr[k] + hr[j]) / 2;
    leftIm[k] = (hi[k] - hi[j]) / 2;
    rightRe[k] = (hi[k] + hi[j]) / 2;
    rightIm[k] = (hr[j] - hr[k]) / 2;
  }
  const out = [new Float64Array(count), new Float64Array(count)];
  const re = hr;
  const im = hi;
  const length = signal[0].length;
  for (let first = 0; first < Math.min(length, count); first += block) {
    const last = Math.min(first + block, length);
    let silent = true;
    for (let index = first; index < last && silent; index += 1) if (signal[0][index] !== 0 || signal[1][index] !== 0) silent = false;
    if (silent) continue;
    re.fill(0);
    im.fill(0);
    for (let index = first; index < last; index += 1) {
      re[index - first] = signal[0][index];
      im[index - first] = signal[1][index];
    }
    fft.transform(re, im);
    // Z = X_L + i X_R; X_L = (Z[k] + conj Z[-k]) / 2, X_R = (Z[k] - conj Z[-k]) / 2i
    for (let k = 0; k <= size / 2; k += 1) {
      const j = (size - k) % size;
      const zr = re[k];
      const zi = im[k];
      const cr = re[j];
      const ci = im[j];
      const xlr = (zr + cr) / 2;
      const xli = (zi - ci) / 2;
      const xrr = (zi + ci) / 2;
      const xri = (cr - zr) / 2;
      // Y_L and Y_R at k; at -k each is the conjugate, since both outputs are real
      const ylr = xlr * leftRe[k] - xli * leftIm[k];
      const yli = xlr * leftIm[k] + xli * leftRe[k];
      const yrr = xrr * rightRe[k] - xri * rightIm[k];
      const yri = xrr * rightIm[k] + xri * rightRe[k];
      // W = Y_L + i Y_R at k and at -k
      re[k] = ylr - yri;
      im[k] = yli + yrr;
      if (j !== k) {
        re[j] = ylr + yri;
        im[j] = -yli + yrr;
      }
    }
    fft.transform(re, im, true);
    const reach = Math.min(count, first + size);
    for (let index = first; index < reach; index += 1) {
      out[0][index] += re[index - first];
      out[1][index] += im[index - first];
    }
  }
  return out.map((channel) => Float32Array.from(channel));
}
