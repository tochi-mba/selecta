import { describe, expect, it } from 'vitest';
import { limiterCoefficients, process } from './limiter';

const SR = 44100;

function stereoTone(freqHz: number, amplitude: number, seconds: number): Float32Array[] {
  const length = Math.round(seconds * SR);
  const channel = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    channel[index] = amplitude * Math.sin((2 * Math.PI * freqHz * index) / SR);
  }
  return [channel, channel.slice()];
}

describe('lookahead brick-wall limiter', () => {
  it('never lets a sample over the ceiling', () => {
    const hot = stereoTone(220, 1.5, 1);
    const limited = process(hot, { ceilingDb: -1.0, sampleRate: SR });
    const ceiling = 10 ** (-1.0 / 20);
    for (const channel of limited) {
      for (let index = 0; index < channel.length; index += 1) {
        expect(Math.abs(channel[index])).toBeLessThanOrEqual(ceiling + 1e-6);
      }
    }
    // It limited, it did not mute: the loud passage still sits near the ceiling.
    const peak = Math.max(...Array.from(limited[0], Math.abs));
    expect(peak).toBeGreaterThan(ceiling * 0.5);
  });

  it('leaves anything under the ceiling sample-identical', () => {
    const quiet = stereoTone(220, 0.1, 0.5);
    const limited = process(quiet, { ceilingDb: -1.1, sampleRate: SR });
    expect(limited[0]).not.toBe(quiet[0]); // a copy, not the same array
    for (let index = 0; index < quiet[0].length; index += 1) {
      expect(limited[0][index]).toBe(quiet[0][index]);
    }
  });

  it('ties the channels: both get the same gain curve', () => {
    const left = new Float32Array(Math.round(0.5 * SR));
    const right = new Float32Array(left.length);
    for (let index = 0; index < left.length; index += 1) {
      left[index] = 1.4 * Math.sin((2 * Math.PI * 330 * index) / SR);
      right[index] = 0.2 * Math.sin((2 * Math.PI * 330 * index) / SR);
    }
    const [limitedLeft, limitedRight] = process([left, right], {
      ceilingDb: -1.0,
      sampleRate: SR,
    });
    // The gain that tamed the left channel is applied to the right as well, keeping the image.
    let middle = Math.round(0.25 * SR);
    for (let index = middle; index < middle + 200; index += 1) {
      if (Math.abs(left[index]) > Math.abs(left[middle])) {
        middle = index; // land on a crest, away from zero crossings
      }
    }
    const ratioBefore = right[middle] / left[middle];
    const ratioAfter = limitedRight[middle] / limitedLeft[middle];
    expect(ratioAfter).toBeCloseTo(ratioBefore, 5);
  });

  it('exports worklet coefficients with a centred (lookahead) window', () => {
    const coefficients = limiterCoefficients({ sampleRate: 48000 });
    expect(coefficients.ceilingLinear).toBeCloseTo(10 ** (-1.1 / 20), 9);
    expect(coefficients.windowSamples % 2).toBe(1);
    // The default 80 ms release at 48 kHz: a 3840-sample window, half of it lookahead.
    expect(coefficients.windowSamples).toBeGreaterThanOrEqual(3840 - 2);
    expect(coefficients.lookaheadSamples).toBe((coefficients.windowSamples - 1) / 2);
  });
});
