import { describe, expect, it } from 'vitest';
import {
  equalPowerIn,
  equalPowerOut,
  fadeInPoints,
  fadeOutPoints,
  sampleCurve,
  scheduleFade,
  FALLBACK_FADE_SECONDS,
  SEAM_FADE_SECONDS,
} from './crossfade';

describe('equal-power crossfade curves', () => {
  it('keeps constant power along the whole crossfade', () => {
    for (let step = 0; step <= 20; step += 1) {
      const x = step / 20;
      const power = equalPowerIn(x) ** 2 + equalPowerOut(x) ** 2;
      expect(power).toBeCloseTo(1, 9);
    }
  });

  it('matches the Python engine timing constants', () => {
    expect(SEAM_FADE_SECONDS).toBe(0.03); // SEAM_FADE in web/src/player.ts
    expect(FALLBACK_FADE_SECONDS).toBe(3); // END_FADE in web/src/player.ts
  });

  it('fade-in starts silent and ends at unity, fade-out mirrors it', () => {
    const rise = fadeInPoints(1, 2);
    expect(rise[0][1]).toBe(0);
    expect(rise[0][0]).toBeLessThan(1); // the tiny leading zero point
    expect(rise[rise.length - 1][1]).toBeCloseTo(1, 9);
    const fall = fadeOutPoints(1, 2);
    expect(fall[0][1]).toBeCloseTo(1, 9);
    expect(fall[fall.length - 1][1]).toBe(0);
    expect(fall[fall.length - 1][0]).toBeGreaterThan(2); // the trailing zero point
  });

  it('sampleCurve interpolates linearly and clamps at the ends', () => {
    const sampled = sampleCurve([[0, 0] as const, [1, 1] as const], 20, 10);
    expect(sampled[0]).toBeCloseTo(0, 6);
    expect(sampled[5]).toBeCloseTo(0.5, 6);
    expect(sampled[10]).toBeCloseTo(1, 6);
    expect(sampled[19]).toBeCloseTo(1, 6); // held after the last point
  });

  it('schedules a seam fade of 30 ms and a fallback fade of 3 s', () => {
    const seam = scheduleFade('seam', 10);
    expect(seam.durationSeconds).toBe(SEAM_FADE_SECONDS);
    expect(seam.incomingGain[seam.incomingGain.length - 1][0]).toBeCloseTo(10.03, 9);
    const fallback = scheduleFade('fallback', 10);
    expect(fallback.durationSeconds).toBe(FALLBACK_FADE_SECONDS);
    // Crossing gains stay equal-power at mid-fade.
    const midIn = equalPowerIn(0.5);
    const midOut = equalPowerOut(0.5);
    expect(midIn ** 2 + midOut ** 2).toBeCloseTo(1, 9);
  });
});
