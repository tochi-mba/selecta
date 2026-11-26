import { describe, expect, it } from 'vitest';
import type { RenderedClip } from '../dsp/seams';
import { bSecondAt, joinSamples, renderedJoins, renderedProblem } from './renderedSeam';

// The rendered seam's join arithmetic and the checks a clip must pass, at both common rates.

type Song = { length: number; sampleRate: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };

/** A song of steady noise from a seed, so audio from any other place does not match it. */
function noisy(seconds: number, rate: number, seed = 1): Song {
  const length = Math.round(seconds * rate);
  let state = seed;
  const data = Float32Array.from({ length }, () => {
    state = (state * 16807) % 2147483647;
    return ((state / 2147483647) * 2 - 1) * 0.1;
  });
  return { length, sampleRate: rate, numberOfChannels: 1, getChannelData: () => data };
}

/** A clip that is native A for its first join and native B for its last, as a clean render is. */
function clipBetween(a: Song, b: Song, aStart: number, bEnd: number, length: number, levels = { a: 1, b: 1 }): RenderedClip {
  const rate = a.sampleRate;
  const seam = joinSamples(rate);
  const channel = new Float32Array(length);
  for (let index = 0; index < seam; index += 1) channel[index] = Math.fround(a.getChannelData(0)[aStart + index] * levels.a);
  for (let index = 0; index < seam; index += 1) channel[length - seam + index] = Math.fround(b.getChannelData(0)[bEnd - seam + index] * levels.b);
  return {
    channels: [channel, Float32Array.from(channel)], sampleRate: rate, aStartSample: aStart, bEndSample: bEnd, levels,
    switchAt: length / rate / 2, bWarp: { output: [0, length / rate], source: [bEnd / rate - length / rate, bEnd / rate] }, implementation: 'web-render-1+wsola-stretch-v1',
  };
}

describe('the rendered seam joins', () => {
  it('are in_context\'s 30 ms: 1,323 samples at 44.1 kHz and 1,440 at 48 kHz', () => {
    expect(joinSamples(44_100)).toBe(1323);
    expect(joinSamples(48_000)).toBe(1440);
  });

  for (const rate of [44_100, 48_000]) {
    it(`fall on whole samples from A's origin at ${rate} Hz`, () => {
      const seam = joinSamples(rate);
      const length = 4 * rate + 7;
      const a = noisy(60, rate);
      const b = noisy(60, rate);
      const clip = clipBetween(a, b, 10 * rate + 3, 3 * rate + 11, length);
      const base = 2.5;
      const joins = renderedJoins(base, clip);
      expect(joins.clipAt).toBe(base + (10 * rate + 3) / rate);
      expect(joins.ramp).toBe((seam - 1) / rate);
      expect(joins.tailAt).toBe(joins.clipAt + (length - seam) / rate);
      expect(joins.bOffset).toBe((3 * rate + 11 - seam) / rate);
      expect(joins.bStartedAt).toBe(joins.clipAt + length / rate);
      // native B's sample bEnd lands where the clip's would have followed its last sample
      expect(joins.tailAt + seam / rate).toBeCloseTo(joins.bStartedAt, 12);
      expect(joins.switchAt).toBe(joins.clipAt + clip.switchAt);
    });
  }

  it('follow B along its warp while the clip plays', () => {
    const clip = clipBetween(noisy(60, 44_100), noisy(60, 44_100), 441_000, 300_000, 176_400);
    expect(bSecondAt(clip, -1)).toBe(clip.bWarp.source[0]);
    expect(bSecondAt(clip, 2)).toBeCloseTo((clip.bWarp.source[0] + clip.bWarp.source[1]) / 2, 9);
    expect(bSecondAt(clip, 99)).toBe(clip.bWarp.source[1]);
  });
});

describe('a rendered clip is refused when anything about it is in doubt', () => {
  const rate = 44_100;
  const a = noisy(60, rate);
  const b = noisy(60, rate, 7);
  const levels = { a: 1, b: 1 };
  const good = () => clipBetween(a, b, 441_000, 200_000, 176_400);

  it('plays a clip made from these songs at these levels', () => {
    expect(renderedProblem(good(), a, b, levels, rate)).toBeNull();
  });

  it('refuses a sample that is not sound', () => {
    const clip = good();
    clip.channels[1][5000] = Number.NaN;
    expect(renderedProblem(clip, a, b, levels, rate)).toMatch(/not sound/);
    const loud = good();
    loud.channels[0][5000] = 1.5;
    expect(renderedProblem(loud, a, b, levels, rate)).toMatch(/not sound/);
  });

  it('refuses a clip at another rate, malformed, or too short to join', () => {
    expect(renderedProblem(good(), a, b, levels, 48_000)).toMatch(/sample rate/);
    const ragged = good();
    ragged.channels[1] = ragged.channels[1].subarray(1);
    expect(renderedProblem(ragged, a, b, levels, rate)).toMatch(/malformed/);
    expect(renderedProblem(clipBetween(a, b, 441_000, 200_000, 2000), a, b, levels, rate)).toMatch(/too short/);
  });

  it('refuses a clip that starts or ends off a sample or outside the songs', () => {
    expect(renderedProblem({ ...good(), aStartSample: 441_000.5 }, a, b, levels, rate)).toMatch(/on a sample/);
    expect(renderedProblem({ ...good(), aStartSample: a.length }, a, b, levels, rate)).toMatch(/first song/);
    expect(renderedProblem({ ...good(), bEndSample: b.length + 5 }, a, b, levels, rate)).toMatch(/next song/);
  });

  it('refuses a clip made at other levels than the songs play at', () => {
    expect(renderedProblem(good(), a, b, { a: 1, b: 0.5 }, rate)).toMatch(/another level/);
  });

  it('refuses a join whose two sides are not the same audio', () => {
    // the same clip one second off in A: a different place, or a different decode
    expect(renderedProblem({ ...good(), aStartSample: 441_000 + rate }, a, b, levels, rate)).toMatch(/first song/);
    expect(renderedProblem({ ...good(), bEndSample: 200_000 - rate }, a, b, levels, rate)).toMatch(/next song/);
  });
});
