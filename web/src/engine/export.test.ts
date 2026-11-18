import { describe, expect, it } from 'vitest';
import { LIMITER_IMPLEMENTATION } from '../dsp/limiter';
import { exportFile, exportFlac, exportWav, localExportFormats } from './export';
import type { RenderTrack } from './render';
import { bufferOfSeconds, FakeOfflineAudioContext } from './testAudio';
import { validateWav } from './wav';

const tracksOf = (...seconds: number[]): RenderTrack[] =>
  seconds.map((time, index) => ({ id: `t${index}`, data: async () => new ArrayBuffer(time * 1000) }));
const decode = async (bytes: ArrayBuffer) => bufferOfSeconds(bytes.byteLength / 1000) as unknown as AudioBuffer;
const offline = (channels: number, frames: number, rate: number) =>
  new FakeOfflineAudioContext(channels, frames, rate) as unknown as OfflineAudioContext;

describe('the whole local export', () => {
  it('hands back only a file that was re-read and matched the rendered length', async () => {
    const result = await exportWav({ tracks: tracksOf(2, 3), decode, createOfflineContext: offline, bits: 24 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.limiter).toBe(LIMITER_IMPLEMENTATION);
    expect(result.checked).toMatchObject({ ok: true, bits: 24, channels: 2, sampleRate: 44100 });
    expect(result.checked.durationSeconds).toBeCloseTo(4.97, 3);
    expect(validateWav(result.wav.bytes).ok).toBe(true);
    expect(result.wav.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a render failure passes through typed and carries no bytes', async () => {
    const result = await exportWav({ tracks: [], decode, createOfflineContext: offline });
    expect(result).toEqual({ ok: false, reason: 'empty', detail: expect.any(String) });
    expect('wav' in result).toBe(false);
  });

  it('a cancel that lands after rendering still yields no file', async () => {
    const control = new AbortController();
    const result = await exportWav({
      tracks: tracksOf(2),
      decode,
      createOfflineContext: (channels, frames, rate) => {
        const made = offline(channels, frames, rate);
        const render = made.startRendering.bind(made);
        made.startRendering = async () => {
          const done = await render();
          control.abort();
          return done;
        };
        return made;
      },
      signal: control.signal,
    });
    expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
  });
});

describe('FLAC export', () => {
  const immediate = () => Promise.resolve();

  it('hands back a FLAC only after decoding it end to end and matching its MD5 and length', async () => {
    const result = await exportFlac({ tracks: tracksOf(2, 3), decode, createOfflineContext: offline, bits: 24, yieldToLoop: immediate });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.limiter).toBe(LIMITER_IMPLEMENTATION);
    expect(result.checked).toMatchObject({ ok: true, bits: 24, channels: 2, sampleRate: 44100, md5: result.flac.md5 });
    expect(result.checked.durationSeconds).toBeCloseTo(4.97, 3);
    expect(result.flac.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exportFile gives one checked file with its type, for either format', async () => {
    for (const format of ['wav', 'flac'] as const) {
      const result = await exportFile({ tracks: tracksOf(2), decode, createOfflineContext: offline, format, yieldToLoop: immediate });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.file).toMatchObject({ format, extension: format, mimeType: `audio/${format}` });
      expect(result.file.durationSeconds).toBeCloseTo(2, 2);
    }
  });

  it('a cancel during encoding or checking yields no file', async () => {
    const control = new AbortController();
    let slices = 0;
    const result = await exportFlac({
      tracks: tracksOf(4),
      decode,
      createOfflineContext: offline,
      signal: control.signal,
      yieldToLoop: async () => {
        slices += 1;
        if (slices === 1) control.abort();
      },
    });
    expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
    expect('flac' in result).toBe(false);
  });

  it('a render failure passes through typed and carries no bytes', async () => {
    const result = await exportFlac({ tracks: [], decode, createOfflineContext: offline });
    expect(result).toEqual({ ok: false, reason: 'empty', detail: expect.any(String) });
  });

  it('formats are offered only behind cloud.local_export', () => {
    expect(localExportFormats({ localExport: false })).toEqual([]);
    expect(localExportFormats({ localExport: true })).toEqual(['wav', 'flac']);
  });
});
