import { describe, expect, it } from 'vitest';
import { boundedFade, boundedPosition, equalPowerCurves, remainingMs, transitionWindow } from './timing';

describe('two-deck timing without an audio device', () => {
  it('clamps untrusted seek, fade and short tracks', () => {
    expect(boundedPosition(-10, 5)).toBe(0);
    expect(boundedPosition(100, 5)).toBeCloseTo(4.999);
    expect(boundedPosition(NaN, 5)).toBe(0);
    expect(boundedFade(Infinity)).toBe(0);
    expect(boundedFade(30)).toBe(12);
    expect(transitionWindow(1.4, 8, 3)).toBe(1.4);
    expect(remainingMs(10, 8, 3)).toBe(0);
  });
  it('produces equal-power crossfade envelopes without unbounded allocations in worklet', () => {
    const { outgoing, incoming } = equalPowerCurves(65);
    expect(outgoing).toHaveLength(65);
    expect(incoming).toHaveLength(65);
    expect(outgoing[0]).toBeCloseTo(1);
    expect(incoming[0]).toBeCloseTo(0);
    expect(outgoing[64]).toBeCloseTo(0, 5);
    expect(incoming[64]).toBeCloseTo(1);
    for (let index = 0; index < 65; index++) {
      expect(outgoing[index] ** 2 + incoming[index] ** 2).toBeCloseTo(1, 5);
    }
  });
});
