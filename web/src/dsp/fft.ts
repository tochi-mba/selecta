/** Radix-2 iterative FFT, dependency-free (ADR-0459 Tier 2 analysis support).
 *
 * Deterministic double-precision Cooley-Tukey with bit-reversal permutation. Sizes must be
 * powers of two. This is deliberately plain: the analysis frame sizes used in `web/src/dsp/`
 * are 1024 to 4096, where a simple radix-2 kernel is fast enough off the audio thread.
 */

export function isPowerOfTwo(size: number): boolean {
  return Number.isInteger(size) && size > 0 && (size & (size - 1)) === 0;
}

/** In-place FFT of complex input held as separate real and imaginary arrays. */
export function fft(real: Float64Array, imag: Float64Array): void {
  const size = real.length;
  if (imag.length !== size || !isPowerOfTwo(size)) {
    throw new Error('fft needs matching power-of-two arrays.');
  }
  // Bit-reversal permutation.
  for (let target = 0, index = 1; index < size; index += 1) {
    let bit = size >> 1;
    for (; target & bit; bit >>= 1) {
      target ^= bit;
    }
    target ^= bit;
    if (index < target) {
      const swapReal = real[index];
      real[index] = real[target];
      real[target] = swapReal;
      const swapImag = imag[index];
      imag[index] = imag[target];
      imag[target] = swapImag;
    }
  }
  for (let width = 2; width <= size; width <<= 1) {
    const angle = (-2 * Math.PI) / width;
    const rootReal = Math.cos(angle);
    const rootImag = Math.sin(angle);
    for (let start = 0; start < size; start += width) {
      let twiddleReal = 1;
      let twiddleImag = 0;
      const half = width >> 1;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const productReal = real[odd] * twiddleReal - imag[odd] * twiddleImag;
        const productImag = real[odd] * twiddleImag + imag[odd] * twiddleReal;
        real[odd] = real[even] - productReal;
        imag[odd] = imag[even] - productImag;
        real[even] += productReal;
        imag[even] += productImag;
        const nextReal = twiddleReal * rootReal - twiddleImag * rootImag;
        twiddleImag = twiddleReal * rootImag + twiddleImag * rootReal;
        twiddleReal = nextReal;
      }
    }
  }
}

/** Hann window of the given length, cached per size. */
const hannCache = new Map<number, Float64Array>();

export function hannWindow(size: number): Float64Array {
  const cached = hannCache.get(size);
  if (cached) {
    return cached;
  }
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)));
  }
  hannCache.set(size, window);
  return window;
}

/** Magnitude spectrum (bins 0..N/2 inclusive) of one real frame, optionally Hann windowed. */
export function realMagnitudeSpectrum(
  frame: Float32Array | Float64Array,
  windowed = true
): Float64Array {
  const size = frame.length;
  if (!isPowerOfTwo(size)) {
    throw new Error('realMagnitudeSpectrum needs a power-of-two frame.');
  }
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const window = windowed ? hannWindow(size) : null;
  for (let index = 0; index < size; index += 1) {
    real[index] = window ? frame[index] * window[index] : frame[index];
  }
  fft(real, imag);
  const bins = size / 2 + 1;
  const magnitude = new Float64Array(bins);
  for (let bin = 0; bin < bins; bin += 1) {
    magnitude[bin] = Math.hypot(real[bin], imag[bin]);
  }
  return magnitude;
}
