import { describe, expect, it } from 'vitest';
import { equalPowerIn } from '../dsp/crossfade';
import { LIMITER_IMPLEMENTATION, limiterCoefficients, process as limit } from '../dsp/limiter';
import { LIMIT_BLOCK_SECONDS, renderMix, RenderTrack } from './render';
import { bufferOfSeconds, FakeAudioBuffer, FakeOfflineAudioContext } from './testAudio';
import type { RenderedClip } from '../dsp/seams';

/** Tracks of n seconds as n-kilobyte fake files; the fake decode reads that back. */
const tracksOf = (...seconds: number[]): RenderTrack[] =>
  seconds.map((time, index) => ({ id: `t${index}`, data: async () => new ArrayBuffer(time * 1000) }));

const decode = async (bytes: ArrayBuffer) => bufferOfSeconds(bytes.byteLength / 1000) as unknown as AudioBuffer;

const offline = (fill?: (buffer: FakeAudioBuffer) => void) =>
  (channels: number, frames: number, rate: number) =>
    new FakeOfflineAudioContext(channels, frames, rate, { fill }) as unknown as OfflineAudioContext;

const CEILING = limiterCoefficients({ sampleRate: 44100 }).ceilingLinear;

describe('rendering a mix offline', () => {
  it('renders in chunks with progress, and validates before calling it a success', async () => {
    const heard: number[] = [];
    const result = await renderMix({
      tracks: tracksOf(40, 25),
      decode,
      chunkSeconds: 30,
      createOfflineContext: offline(),
      onProgress: (progress) => heard.push(progress.chunk),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 40 s + 25 s with a 0.03 s crossfade is 64.97 s: three 30 s chunks
    expect(result.chunks).toHaveLength(3);
    expect(heard).toEqual([1, 2, 3]);
    expect(result.durationSeconds).toBeCloseTo(64.97, 1);
    expect(result.peak).toBe(0);
    expect(result.limiter).toBe(LIMITER_IMPLEMENTATION);
  });

  it('refuses an empty track list', async () => {
    const result = await renderMix({ tracks: [], decode, createOfflineContext: offline() });
    expect(result).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('a cancelled render resolves to a typed failure, never a partial success', async () => {
    const control = new AbortController();
    const result = await renderMix({
      tracks: tracksOf(40, 40, 40),
      decode,
      chunkSeconds: 30,
      signal: control.signal,
      createOfflineContext: offline(),
      onProgress: (progress) => {
        if (progress.chunk === 1) control.abort();
      },
    });
    expect(result).toEqual({ ok: false, reason: 'cancelled', detail: expect.stringMatching(/cancelled/) });
    expect((result as { chunks?: unknown }).chunks).toBeUndefined();
  });

  it('a cancel during the very last chunk still wins over success', async () => {
    const control = new AbortController();
    const result = await renderMix({
      tracks: tracksOf(10),
      decode,
      signal: control.signal,
      createOfflineContext: offline(),
      onProgress: () => control.abort(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
  });

  it('cancelling before the first chunk renders nothing at all', async () => {
    const control = new AbortController();
    control.abort();
    let made = 0;
    const result = await renderMix({
      tracks: tracksOf(10),
      decode,
      signal: control.signal,
      createOfflineContext: (channels, frames, rate) => {
        made += 1;
        return offline()(channels, frames, rate);
      },
    });
    expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(made).toBe(0);
  });

  it('names the track whose decode failed', async () => {
    const result = await renderMix({
      tracks: tracksOf(10, 10),
      decode: async (bytes) => {
        if (bytes.byteLength === 10000) throw new Error('corrupt stream');
        return decode(bytes);
      },
      createOfflineContext: offline(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'decode_failed', detail: expect.stringMatching(/t0.*corrupt stream/) });
  });

  it('a read that throws is a typed decode failure too', async () => {
    const result = await renderMix({
      tracks: [{ id: 'gone', data: () => { throw new Error('permission revoked'); } }],
      decode,
      createOfflineContext: offline(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'decode_failed', detail: expect.stringMatching(/gone.*permission revoked/) });
  });

  it('rejects output with NaN in it instead of writing a broken file', async () => {
    const result = await renderMix({
      tracks: tracksOf(10),
      decode,
      createOfflineContext: offline((buffer) => {
        buffer.getChannelData(0)[5] = Number.NaN;
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_output', detail: expect.stringMatching(/invalid audio/) });
  });

  it('limits a render that peaks above full scale instead of clipping it', async () => {
    const result = await renderMix({
      tracks: tracksOf(10),
      decode,
      createOfflineContext: offline((buffer) => {
        buffer.getChannelData(1)[1000] = 1.5;
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.peak).toBeLessThanOrEqual(CEILING + 1e-6);
    expect(result.peak).toBeGreaterThan(0.5);
  });

  it('a scheduling error inside a chunk is a typed render failure with the part that failed', async () => {
    const result = await renderMix({
      tracks: tracksOf(10),
      decode,
      createOfflineContext: () => ({
        createBufferSource: () => { throw new Error('worklet died'); },
      } as unknown as OfflineAudioContext),
    });
    expect(result).toMatchObject({ ok: false, reason: 'render_failed', detail: expect.stringMatching(/part 1.*worklet died/) });
  });

  it('an error thrown by a progress listener is a typed failure, never an unhandled rejection', async () => {
    const result = await renderMix({
      tracks: tracksOf(10),
      decode,
      createOfflineContext: offline(),
      onProgress: () => { throw new Error('listener broke'); },
    });
    expect(result).toMatchObject({ ok: false, reason: 'render_failed', detail: expect.stringMatching(/listener broke/) });
  });

  it('refuses a mix longer than the memory budget as too_long, before rendering past it', async () => {
    let decoded = 0;
    const result = await renderMix({
      tracks: tracksOf(40, 40, 40, 40),
      decode: async (bytes) => {
        decoded += 1;
        return decode(bytes);
      },
      chunkSeconds: 30,
      maxSeconds: 70,
      createOfflineContext: offline(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'too_long' });
    expect(decoded).toBe(2); // the second song crosses 70 s; the rest are never read
  });

  it('decodes lazily: songs are read only when a chunk reaches them', async () => {
    const reads: string[] = [];
    const tracks = tracksOf(40, 40, 40).map((track) => ({
      ...track,
      data: async () => {
        reads.push(String(track.id));
        return track.data();
      },
    }));
    const progress: number[] = [];
    const result = await renderMix({
      tracks,
      decode,
      chunkSeconds: 30,
      createOfflineContext: offline(),
      onProgress: () => progress.push(reads.length),
    });
    expect(result.ok).toBe(true);
    // chunk 1 (0-30 s) needs only song 0; chunk 2 (30-60 s) needs song 1 as well.
    expect(progress.slice(0, 2)).toEqual([1, 2]);
  }, 30_000); // two minutes of audio through the real limiter

  it('schedules equal-power crossfade envelopes at the track boundaries', async () => {
    const contexts: FakeOfflineAudioContext[] = [];
    const result = await renderMix({
      tracks: tracksOf(40, 25),
      decode,
      chunkSeconds: 60, // one chunk holds the whole seam
      crossfadeSeconds: 0.03,
      createOfflineContext: (channels, frames, rate) => {
        const made = new FakeOfflineAudioContext(channels, frames, rate);
        contexts.push(made);
        return made as unknown as OfflineAudioContext;
      },
    });
    expect(result.ok).toBe(true);
    const first = contexts[0];
    expect(first.madeSources).toHaveLength(2);
    // the second track enters 0.03 s before the first ends, from its own start
    expect(first.madeSources[1].started[0].when).toBeCloseTo(39.97, 5);
    const entryGain = first.madeGains[1];
    expect(entryGain.events[0]).toEqual({ type: 'set', value: 0, at: expect.closeTo(39.97, 5) });
    const quarter = entryGain.events.find((event) => Math.abs(event.at - (39.97 + 0.03 / 4)) < 1e-9);
    expect(quarter?.value).toBeCloseTo(equalPowerIn(0.25), 9);
    const full = entryGain.events.find((event) => Math.abs(event.at - 40) < 1e-9);
    expect(full?.value).toBeCloseTo(1, 9);
  });

  it('limits across chunk edges exactly as if the whole mix were limited at once', async () => {
    // A loud burst straddling the 1 s chunk edge, on fake rendered audio.
    const sampleRate = 44100;
    const seconds = 3;
    const whole = [new Float32Array(seconds * sampleRate), new Float32Array(seconds * sampleRate)];
    for (let index = 0; index < whole[0].length; index += 1) {
      const loud = index > sampleRate - 3000 && index < sampleRate + 3000 ? 2.5 : 0.4;
      whole[0][index] = loud * Math.sin(index / 7);
      whole[1][index] = loud * Math.cos(index / 11);
    }
    let cursor = 0;
    const result = await renderMix({
      tracks: tracksOf(seconds),
      decode,
      chunkSeconds: 1,
      sampleRate,
      createOfflineContext: offline((buffer) => {
        for (let channel = 0; channel < 2; channel += 1) {
          buffer.getChannelData(channel).set(whole[channel].subarray(cursor, cursor + buffer.length));
        }
        cursor += buffer.length;
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reference = limit(whole, { sampleRate });
    const streamed = [0, 1].map((channel) => {
      const lane = new Float32Array(whole[0].length);
      let at = 0;
      for (const chunk of result.chunks) {
        lane.set(chunk.getChannelData(channel), at);
        at += chunk.length;
      }
      return lane;
    });
    let worst = 0;
    for (let channel = 0; channel < 2; channel += 1) {
      for (let index = 0; index < reference[channel].length; index += 1) {
        worst = Math.max(worst, Math.abs(reference[channel][index] - streamed[channel][index]));
      }
    }
    expect(worst).toBeLessThan(1e-6);
    expect(result.peak).toBeLessThanOrEqual(CEILING + 1e-6);
  });
});

describe('the render limiter yields inside a chunk', () => {
  const sampleRate = 44100;
  const loudMix = (seconds: number) => {
    const whole = [new Float32Array(seconds * sampleRate), new Float32Array(seconds * sampleRate)];
    for (let index = 0; index < whole[0].length; index += 1) {
      // Loud bursts straddling every limiter block edge inside one render chunk.
      const nearEdge = [1, 2, 3, 4, 5].map((edge) => edge * LIMIT_BLOCK_SECONDS).some((edge) => Math.abs(index - edge * sampleRate) < 3000);
      const loud = nearEdge ? 2.5 : 0.4;
      whole[0][index] = loud * Math.sin(index / 7);
      whole[1][index] = loud * Math.cos(index / 11);
    }
    return whole;
  };
  const filledFrom = (whole: Float32Array[]) => {
    let cursor = 0;
    return offline((buffer) => {
      for (let channel = 0; channel < 2; channel += 1) buffer.getChannelData(channel).set(whole[channel].subarray(cursor, cursor + buffer.length));
      cursor += buffer.length;
    });
  };

  it('limits block by block exactly as if the whole chunk were limited at once', async () => {
    const seconds = 3 * LIMIT_BLOCK_SECONDS;
    const whole = loudMix(seconds);
    let yields = 0;
    const result = await renderMix({
      tracks: tracksOf(seconds),
      decode,
      chunkSeconds: 60, // one render chunk, so only the block split is exercised
      sampleRate,
      createOfflineContext: filledFrom(whole),
      yieldToLoop: async () => { yields += 1; },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chunks).toHaveLength(1);
    expect(yields).toBe(2); // one between each of the three blocks
    const reference = limit(whole, { sampleRate });
    let worst = 0;
    for (let channel = 0; channel < 2; channel += 1) {
      const lane = result.chunks[0].getChannelData(channel);
      for (let index = 0; index < lane.length; index += 1) worst = Math.max(worst, Math.abs(reference[channel][index] - lane[index]));
    }
    expect(worst).toBeLessThan(1e-6);
    expect(result.peak).toBeLessThanOrEqual(CEILING + 1e-6);
  });

  it('a cancel at a limiter yield resolves to cancelled with no audio', async () => {
    const control = new AbortController();
    const result = await renderMix({
      tracks: tracksOf(4),
      decode,
      chunkSeconds: 60,
      sampleRate,
      createOfflineContext: filledFrom(loudMix(4)),
      signal: control.signal,
      yieldToLoop: async () => control.abort(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
    expect('chunks' in result).toBe(false);
  });
});

describe('writing the transitions made ahead (T-20261126-96d3)', () => {
  const RATE = 44100;
  const seam = Math.trunc(0.03 * RATE);
  const clipOf = (levels: { a: number; b: number }): RenderedClip => ({
    channels: [new Float32Array(RATE * 2), new Float32Array(RATE * 2)], sampleRate: RATE,
    aStartSample: 30 * RATE, bEndSample: 5 * RATE, levels, switchAt: 1, bWarp: { output: [0, 2], source: [3, 5] }, implementation: 'web-render-1',
  });
  const clipBuffer = (clip: RenderedClip) => {
    const made = new FakeAudioBuffer(clip.channels.length, clip.channels[0].length, clip.sampleRate);
    return made as unknown as AudioBuffer;
  };
  type Made = { context: FakeOfflineAudioContext };
  const capture = (made: Made[]) => (channels: number, frames: number, rate: number) => {
    const context = new FakeOfflineAudioContext(channels, frames, rate);
    made.push({ context });
    return context as unknown as OfflineAudioContext;
  };

  it('plays native A, the clip and native B as the scheduler joins them, each song at its level', async () => {
    const made: Made[] = [];
    const result = await renderMix({
      tracks: tracksOf(40, 40), decode, chunkSeconds: 200, createOfflineContext: capture(made), clipBuffer,
      level: async (index) => (index === 1 ? 0.5 : 1),
      joins: async (index, _from, _to, levels) => (index === 0 ? clipOf(levels) : null),
    });
    expect(result.ok).toBe(true);
    const [{ context }] = made;
    const [a, clip, b] = context.madeSources;
    const clipAt = 30;
    const tailAt = clipAt + (2 * RATE - seam) / RATE;
    expect(a.started[0]).toMatchObject({ when: 0, offset: 0 });
    expect(clip.started[0].when).toBeCloseTo(clipAt, 6);
    expect(b.started[0].when).toBeCloseTo(tailAt, 6);
    expect(b.started[0].offset).toBeCloseTo((5 * RATE - seam) / RATE, 6);
    // A falls linearly to 0 over the join; B rises to its own level, 0.5
    const [aGain, , bGain] = context.madeGains;
    expect(aGain.events.at(-1)).toMatchObject({ type: 'ramp', value: 0 });
    expect(bGain.events.at(-1)?.value).toBeCloseTo(0.5, 6);
    if (result.ok) expect(result.durationSeconds).toBeCloseTo(tailAt + 40 - (5 * RATE - seam) / RATE, 2);
  });

  it('keeps the crossfade where a clip does not fit these songs at these levels', async () => {
    const made: Made[] = [];
    const result = await renderMix({
      tracks: tracksOf(40, 40), decode, chunkSeconds: 200, createOfflineContext: capture(made), clipBuffer,
      level: async () => 1,
      joins: async () => clipOf({ a: 1, b: 0.25 }),
    });
    expect(result.ok).toBe(true);
    expect(made[0].context.madeSources).toHaveLength(2);
    if (result.ok) expect(result.durationSeconds).toBeCloseTo(80 - 0.03, 2);
  });
});
