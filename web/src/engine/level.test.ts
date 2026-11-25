import { describe, expect, it, vi } from 'vitest';
import { analyse } from '../dsp/workers/analysisWorker';
import { createLevels, gainDb, linear, PEAK_CEILING_DB, TARGET_LUFS } from './level';

const buffer = (channels: Float32Array[], sampleRate = 44100) => ({
  numberOfChannels: channels.length,
  sampleRate,
  getChannelData: (channel: number) => channels[channel],
}) as unknown as AudioBuffer;

describe('song level (cloud.seam_lead)', () => {
  it('uses local mode’s rule: toward -14 LUFS, held back by the song’s own peak', () => {
    // a loud master comes down to the target
    expect(gainDb(-8, -0.2)).toBeCloseTo(TARGET_LUFS - -8);
    // a quiet song is raised only as far as its peak allows
    expect(gainDb(-20, -3)).toBeCloseTo(PEAK_CEILING_DB - -3);
    // silence, or a measurement that failed, changes nothing
    expect(gainDb(-Infinity, -90)).toBe(0);
    expect(gainDb(NaN, NaN)).toBe(0);
    expect(linear(0)).toBe(1);
  });

  it('measures a song once, from copies, and plays an unmeasurable song at 1', async () => {
    const left = new Float32Array([0.1, -0.1]);
    const measure = vi.fn(async (channels: Float32Array[]) => {
      // the playing buffer’s own data is never handed over
      expect(channels[0]).not.toBe(left);
      return { lufs: -8, peakDb: -0.2 };
    });
    const levels = createLevels(measure);
    const song = buffer([left]);
    expect(await levels.of(song)).toBeCloseTo(linear(-6));
    expect(await levels.of(song)).toBeCloseTo(linear(-6));
    expect(measure).toHaveBeenCalledTimes(1);

    const failing = createLevels(async () => { throw new Error('worker gone'); });
    expect(await failing.of(buffer([left]))).toBe(1);
    levels.dispose();
    expect(await levels.of(buffer([left]))).toBe(1);
  });

  it('the analysis worker answers loudness and peak for the channels it is given', () => {
    const rate = 44100;
    const tone = new Float32Array(rate * 2);
    for (let index = 0; index < tone.length; index += 1) tone[index] = 0.5 * Math.sin((2 * Math.PI * 1000 * index) / rate);
    const answer = analyse({ id: 1, sampleRate: rate, pcm: new Float32Array(0), tasks: ['loudness'], channels: [tone, tone.slice()] });
    expect(answer.error).toBeUndefined();
    expect(answer.peakDb).toBeCloseTo(20 * Math.log10(0.5), 1);
    // a full-scale 1 kHz sine on both channels reads about 0 LUFS, so half scale is about -6
    expect(answer.lufs).toBeGreaterThan(-7.5);
    expect(answer.lufs).toBeLessThan(-5);
  });
});
