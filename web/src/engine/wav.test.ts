import { describe, expect, it } from 'vitest';
import { FakeAudioBuffer } from './testAudio';
import { encodeWav, flacSupported, validateWav } from './wav';

const filled = (seconds: number, value: number, channels = 2, sampleRate = 44100) => {
  const buffer = new FakeAudioBuffer(channels, Math.round(seconds * sampleRate), sampleRate);
  for (let channel = 0; channel < channels; channel += 1) buffer.getChannelData(channel).fill(value);
  return buffer;
};

describe('encoding WAV', () => {
  it('writes a 16-bit RIFF file whose own validator accepts it', () => {
    const made = encodeWav([filled(1, 0.5)], 16);
    expect(made.bytes.length).toBe(44 + 44100 * 2 * 2);
    expect(made.durationSeconds).toBe(1);
    expect(made.sha256).toMatch(/^[0-9a-f]{64}$/);
    const read = validateWav(made.bytes, { durationSeconds: 1 });
    expect(read).toEqual({ ok: true, sampleRate: 44100, channels: 2, bits: 16, durationSeconds: 1, dataBytes: 44100 * 4 });
  });

  it('spans several chunks as one continuous file', () => {
    const made = encodeWav([filled(0.5, 0.1), filled(0.25, 0.2), filled(0.25, 0.3)], 16);
    const read = validateWav(made.bytes);
    expect(read.ok && read.durationSeconds).toBe(1);
  });

  it('writes the samples it was given, clamped to full scale', () => {
    const loud = filled(0.001, 0.5, 1);
    loud.getChannelData(0)[0] = 2; // beyond full scale
    loud.getChannelData(0)[1] = -2;
    const made = encodeWav([loud], 16);
    const view = new DataView(made.bytes.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(Math.round(0.5 * 32767));
  });

  it('writes 24-bit frames with the right block alignment', () => {
    const made = encodeWav([filled(0.5, 0.25)], 24);
    const read = validateWav(made.bytes, { durationSeconds: 0.5 });
    expect(read).toMatchObject({ ok: true, bits: 24 });
    const view = new DataView(made.bytes.buffer);
    expect(view.getUint16(32, true)).toBe(6); // 2 channels of 3 bytes
    const sample = view.getUint8(44) | (view.getUint8(45) << 8) | (view.getUint8(46) << 16);
    expect(sample).toBe(Math.round(0.25 * 8388607));
  });

  it('refuses nothing to encode, and chunks that disagree on their format', () => {
    expect(() => encodeWav([], 16)).toThrow(/no audio/);
    const other = new FakeAudioBuffer(1, 10, 48000);
    expect(() => encodeWav([filled(0.1, 0), other], 16)).toThrow(/share one sample rate/);
  });

  it('checksums change with the audio, so a stale file cannot pass for a new one', () => {
    const one = encodeWav([filled(0.1, 0.1)], 16);
    const two = encodeWav([filled(0.1, 0.2)], 16);
    expect(one.sha256).not.toBe(two.sha256);
  });
});

describe('validating WAV bytes', () => {
  it('rejects files too short to carry a header', () => {
    expect(validateWav(new Uint8Array(10))).toMatchObject({ ok: false, reason: expect.stringMatching(/too short/) });
  });

  it('rejects the wrong magic words', () => {
    const made = encodeWav([filled(0.1, 0)], 16);
    const bent = made.bytes.slice();
    bent[0] = 0x58;
    expect(validateWav(bent)).toMatchObject({ ok: false, reason: expect.stringMatching(/RIFF/) });
  });

  it('rejects a truncated file: the sizes no longer agree', () => {
    const made = encodeWav([filled(0.1, 0)], 16);
    const cut = made.bytes.slice(0, made.bytes.length - 100);
    const read = validateWav(cut);
    expect(read.ok).toBe(false);
  });

  it('rejects a duration that does not match what was promised', () => {
    const made = encodeWav([filled(1, 0)], 16);
    const read = validateWav(made.bytes, { durationSeconds: 3 });
    expect(read).toMatchObject({ ok: false, reason: expect.stringMatching(/lasts 1\.00 s/) });
  });
});

describe('FLAC support', () => {
  it('reports the bundled encoder by implementation id, now that one exists', () => {
    const answer = flacSupported();
    expect(answer.supported).toBe(true);
    expect(answer.implementation).toBe('ts-flac-fixed-rice-v1');
  });
});
