import { describe, expect, it } from 'vitest';
import { renderMix, RenderTrack } from './render';
import { bufferOfSeconds, FakeAudioBuffer, FakeOfflineAudioContext } from './testAudio';

/** Tracks of n seconds as n-kilobyte fake files; the fake decode reads that back. */
const tracksOf = (...seconds: number[]): RenderTrack[] =>
  seconds.map((time, index) => ({ id: `t${index}`, data: async () => new ArrayBuffer(time * 1000) }));

const decode = async (bytes: ArrayBuffer) => bufferOfSeconds(bytes.byteLength / 1000) as unknown as AudioBuffer;

const offline = (fill?: (buffer: FakeAudioBuffer) => void) =>
  (channels: number, frames: number, rate: number) =>
    new FakeOfflineAudioContext(channels, frames, rate, { fill }) as unknown as OfflineAudioContext;

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

  it('rejects output peaking above full scale', async () => {
    const result = await renderMix({
      tracks: tracksOf(10),
      decode,
      createOfflineContext: offline((buffer) => {
        buffer.getChannelData(1)[0] = 1.5;
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_output', detail: expect.stringMatching(/full scale/) });
  });

  it('reports a render engine failure as such, with the part that failed', async () => {
    const result = await renderMix({
      tracks: tracksOf(10),
      decode,
      createOfflineContext: () => ({
        createBufferSource: () => { throw new Error('worklet died'); },
      } as unknown as OfflineAudioContext),
    });
    expect(result).toMatchObject({ ok: false, reason: 'render_failed' });
  });

  it('schedules the crossfade envelopes at the track boundaries', async () => {
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
    expect(entryGain.events[1]).toEqual({ type: 'ramp', value: 1, at: expect.closeTo(40, 5) });
  });
});
