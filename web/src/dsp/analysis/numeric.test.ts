import { describe, expect, it } from 'vitest';
import { medianF32, medianFilterNearest, percentile, polyfit, pyRound, roundHalfEven, savgolInterp } from './numeric';
import { resample, resampledLength } from './resample';
import { hashNoise } from './synth';

// The numpy and scipy rules the whole-song ports rely on, against values numpy 2.5 and scipy
// 1.18 gave for the same inputs (docs/engineering/device-analysis.md).

describe('numpy rounding', () => {
  it('rounds half to even', () => {
    expect([0.5, 1.5, 2.5, -1.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, -2, 2, 3]);
  });

  it('rounds to places from the exact value, ties to even, as Python round does', () => {
    expect(pyRound(0.0625, 3)).toBe(0.062);
    expect(pyRound(2.675, 2)).toBe(2.67);
    expect(pyRound(0.125, 2)).toBe(0.12);
    expect(pyRound(-0.0625, 3)).toBe(-0.062);
    expect(pyRound(1.0005, 3)).toBe(1.0);
    expect(pyRound(119.875, 2)).toBe(119.88);
  });
});

describe('numpy statistics', () => {
  const values = Float32Array.from([3, 1, 4, 1, 5, 9, 2, 6]);

  it('takes float32 percentiles the way numpy does', () => {
    expect(percentile(values, 70, true)).toBe(4.900000095367432);
    expect(percentile(values, 5, true)).toBe(1.0);
    expect(percentile(values, 99, true)).toBe(8.789999961853027);
    expect(percentile(Float64Array.from(values), 90)).toBe(6.8999999999999995);
    expect(medianF32(values)).toBe(3.5);
  });

  it('fits a line exactly', () => {
    const [slope, intercept] = polyfit([0, 1, 2, 3], [1, 3, 5, 7], 1);
    expect(slope).toBeCloseTo(2, 12);
    expect(intercept).toBeCloseTo(1, 12);
  });
});

describe('scipy filters', () => {
  const x = [0, 1, 4, 2, 8, 3, 1, 7, 5, 6, 2, 9, 4, 3, 8, 1, 0, 5];

  it('matches savgol_filter with its interp edges', () => {
    const expected = [
      -0.785714285714, 1.928571428571, 3.714285714286, 4.571428571429, 4.047619047619, 4.0, 4.285714285714,
      4.380952380952, 4.666666666667, 5.809523809524, 5.285714285714, 4.761904761905, 5.52380952381,
      5.666666666667, 3.047619047619, 2.571428571429, 2.714285714286, 3.47619047619,
    ];
    const got = savgolInterp(x, 7, 2);
    expected.forEach((value, index) => expect(got[index]).toBeCloseTo(value, 9));
  });

  it('matches median_filter with nearest edges', () => {
    expect(Array.from(medianFilterNearest(x, 5))).toEqual([0, 1, 2, 3, 3, 3, 5, 5, 5, 6, 5, 4, 4, 4, 3, 3, 5, 5]);
  });
});

describe('the resampler', () => {
  it('keeps a constant constant and makes ceil(n * to / from) samples', () => {
    for (const rate of [44100, 48000]) {
      const out = resample(new Float32Array(rate).fill(0.5), rate, 22050);
      expect(out.length).toBe(22050);
      expect(resampledLength(rate, rate, 22050)).toBe(22050);
      for (let index = 200; index < out.length - 200; index += 997) expect(out[index]).toBeCloseTo(0.5, 6);
    }
  });

  it('passes a tone in the passband at its level and removes one above the new Nyquist', () => {
    const rate = 48000;
    const tone = (hz: number) => Float32Array.from({ length: rate }, (_, k) => Math.sin((2 * Math.PI * hz * k) / rate));
    const peak = (signal: Float32Array) => signal.subarray(500, signal.length - 500).reduce((top, value) => Math.max(top, Math.abs(value)), 0);
    expect(peak(resample(tone(1000), rate, 22050))).toBeCloseTo(1, 3);
    expect(peak(resample(tone(15000), rate, 22050))).toBeLessThan(1e-3);
  });
});

describe('the fixtures noise', () => {
  it('is the lowbias32 hash the generator uses', () => {
    // tools/device_analysis_golden.py hash_noise for indexes 0, 1 and 1000 with seed 3
    expect([0, 1, 1000].map((index) => hashNoise(index, 3))).toEqual([-0.8785364939831197, 0.8966682557947934, -0.6118007553741336]);
  });
});
