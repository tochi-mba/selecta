import { describe, expect, it } from 'vitest';
import { fft, hannWindow, isPowerOfTwo, realMagnitudeSpectrum } from './fft';

function sine(size: number, cycles: number, amplitude = 1): Float64Array {
  const output = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    output[index] = amplitude * Math.sin((2 * Math.PI * cycles * index) / size);
  }
  return output;
}

describe('fft', () => {
  it('puts a pure sinusoid in exactly its own bin', () => {
    const size = 1024;
    const cycles = 37;
    const real = sine(size, cycles, 0.5);
    const imag = new Float64Array(size);
    fft(real, imag);
    const magnitudes = Array.from({ length: size / 2 }, (_, bin) =>
      Math.hypot(real[bin], imag[bin])
    );
    const peakBin = magnitudes.indexOf(Math.max(...magnitudes));
    expect(peakBin).toBe(cycles);
    // An N-point FFT of a sine of amplitude A carries A*N/2 in the positive-frequency bin.
    expect(magnitudes[peakBin]).toBeCloseTo((0.5 * size) / 2, 6);
    // Energy away from the tone is numerically zero.
    expect(magnitudes[cycles + 5]).toBeLessThan(1e-8);
  });

  it('resolves two sinusoids independently (linearity)', () => {
    const size = 512;
    const real = sine(size, 10, 1);
    const second = sine(size, 40, 0.25);
    for (let index = 0; index < size; index += 1) {
      real[index] += second[index];
    }
    const imag = new Float64Array(size);
    fft(real, imag);
    expect(Math.hypot(real[10], imag[10])).toBeCloseTo(size / 2, 5);
    expect(Math.hypot(real[40], imag[40])).toBeCloseTo((0.25 * size) / 2, 5);
  });

  it('rejects non power-of-two sizes', () => {
    expect(isPowerOfTwo(1000)).toBe(false);
    expect(() => fft(new Float64Array(1000), new Float64Array(1000))).toThrow();
  });

  it('realMagnitudeSpectrum peaks at the sinusoid bin through the Hann window', () => {
    const size = 1024;
    const frame = new Float32Array(size);
    for (let index = 0; index < size; index += 1) {
      frame[index] = Math.sin((2 * Math.PI * 64 * index) / size);
    }
    const spectrum = realMagnitudeSpectrum(frame);
    expect(spectrum.length).toBe(size / 2 + 1);
    let peakBin = 0;
    for (let bin = 1; bin < spectrum.length; bin += 1) {
      if (spectrum[bin] > spectrum[peakBin]) {
        peakBin = bin;
      }
    }
    expect(peakBin).toBe(64);
  });

  it('hann window is zero at the edges and one in the middle', () => {
    const window = hannWindow(101);
    expect(window[0]).toBeCloseTo(0, 12);
    expect(window[100]).toBeCloseTo(0, 12);
    expect(window[50]).toBeCloseTo(1, 12);
  });
});
