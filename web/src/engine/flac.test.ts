import { describe, expect, it } from 'vitest';
import { encodeFlac, FlacBits, FlacCancelled, quantise } from './flac';
import { crc16, crc8 } from './flacBits';
import { decodeFlac, validateFlac } from './flacDecode';
import { encodeWav, PcmChunk } from './wav';

/** Chunks of float PCM, like render.ts produces. */
const chunk = (channels: Float32Array[], sampleRate = 44100): PcmChunk => ({
  numberOfChannels: channels.length,
  length: channels[0].length,
  sampleRate,
  getChannelData: (index: number) => channels[index],
});

let seed = 12345;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 1073741824 - 1;
};

/** A test signal that walks through every subframe path: tone, silence, a DC step, full-scale
 * noise (verbatim), quiet noise, and a sweep. */
function signal(frames: number, channel: number, rate = 44100): Float32Array {
  const out = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    const t = index / rate;
    const part = Math.floor((index / frames) * 6);
    if (part === 0) out[index] = 0.6 * Math.sin(2 * Math.PI * (220 + 110 * channel) * t);
    else if (part === 1) out[index] = 0;
    else if (part === 2) out[index] = channel === 0 ? 0.25 : -0.25;
    else if (part === 3) out[index] = random();
    else if (part === 4) out[index] = 0.01 * random() + 0.3 * Math.sin(2 * Math.PI * 55 * t);
    else out[index] = 0.9 * Math.sin(2 * Math.PI * (40 + 4000 * t) * t);
  }
  return out;
}

const split = (channels: Float32Array[], sizes: number[], rate = 44100): PcmChunk[] => {
  const chunks: PcmChunk[] = [];
  let at = 0;
  for (const size of sizes) {
    chunks.push(chunk(channels.map((data) => data.subarray(at, at + size)), rate));
    at += size;
  }
  return chunks;
};

const immediate = () => Promise.resolve();

async function roundTrip(channelCount: number, frames: number, bits: FlacBits, rate = 44100, sizes?: number[]) {
  const channels = Array.from({ length: channelCount }, (_, index) => signal(frames, index, rate));
  const chunks = split(channels, sizes ?? [frames], rate);
  const encoded = await encodeFlac(chunks, bits, { yieldToLoop: immediate });
  const decoded = decodeFlac(encoded.bytes);
  channels.forEach((data, index) => {
    const expected = Int32Array.from(data, (sample) => quantise(sample, bits));
    expect(decoded.channels[index]).toEqual(expected);
  });
  expect(decoded.md5).toBe(encoded.md5);
  expect(decoded.info).toMatchObject({ sampleRate: rate, channels: channelCount, bits, totalSamples: frames, md5: encoded.md5 });
  return { encoded, decoded, channels };
}

describe('FLAC encoder round trip', () => {
  it('16-bit stereo decodes bit-exactly, through every subframe type and stereo mode', async () => {
    const { encoded } = await roundTrip(2, 44100 * 6 + 1234, 16, 44100, [44100 * 2, 44100 * 3 + 17, 44100 + 1217]);
    expect(encoded.subframes.constant).toBeGreaterThan(0);
    expect(encoded.subframes.verbatim).toBeGreaterThan(0);
    expect(encoded.subframes.fixed).toBeGreaterThan(0);
    // Lossless and still smaller than PCM on this mostly-compressible signal.
    expect(encoded.bytes.length).toBeLessThan((44100 * 6 + 1234) * 4 * 0.8);
  });

  it('24-bit stereo decodes bit-exactly, including RICE2 parameters on loud noise', async () => {
    await roundTrip(2, 44100 * 3, 24);
  });

  it('mono, multichannel, short and odd-length streams, and unusual sample rates', async () => {
    await roundTrip(1, 10000, 16, 48000);
    await roundTrip(3, 9001, 24, 96000);
    await roundTrip(2, 7, 16, 22050);
    await roundTrip(2, 4096, 16, 37800); // no frame-header code: read from STREAMINFO
    await roundTrip(2, 4097, 24, 44100, [1, 4000, 96]);
  });

  it('holds exactly the samples a WAV export of the same render holds', async () => {
    const channels = [signal(30000, 0), signal(30000, 1)];
    for (const bits of [16, 24] as const) {
      const flac = await encodeFlac([chunk(channels)], bits, { yieldToLoop: immediate });
      const wav = encodeWav([chunk(channels)], bits);
      const decoded = decodeFlac(flac.bytes);
      const pcm = wav.bytes.subarray(44);
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const step = bits / 8;
      for (let frame = 0; frame < 30000; frame += 1) {
        for (let channel = 0; channel < 2; channel += 1) {
          const at = (frame * 2 + channel) * step;
          const value = bits === 16 ? view.getInt16(at, true) : ((view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)));
          if (decoded.channels[channel][frame] !== value) throw new Error(`frame ${frame} channel ${channel} differs`);
        }
      }
    }
  });

  it('writes a valid STREAMINFO: marker, block sizes, frame sizes, totals and the PCM MD5', async () => {
    const { encoded, decoded } = await roundTrip(2, 20000, 16);
    expect(String.fromCharCode(...encoded.bytes.subarray(0, 4))).toBe('fLaC');
    expect(decoded.info.minBlockSize).toBe(4096);
    expect(decoded.info.maxBlockSize).toBe(4096);
    expect(decoded.info.minFrameSize).toBeGreaterThan(0);
    expect(decoded.info.maxFrameSize).toBeGreaterThanOrEqual(decoded.info.minFrameSize);
    expect(encoded.frames).toBe(Math.ceil(20000 / 4096));
    expect(encoded.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(encoded.md5).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('FLAC checks and CRCs', () => {
  it('uses the FLAC CRC-8 and CRC-16 polynomials (check values from the CRC catalogue)', () => {
    const text = new TextEncoder().encode('123456789');
    expect(crc8(text, 0, text.length)).toBe(0xf4); // CRC-8 (poly 0x07, init 0)
    expect(crc16(text, 0, text.length)).toBe(0xfee8); // CRC-16/UMTS (poly 0x8005, init 0)
  });

  it('validateFlac passes a good file and rejects damage anywhere', async () => {
    const encoded = await encodeFlac([chunk([signal(20000, 0), signal(20000, 1)])], 16, { yieldToLoop: immediate });
    const good = await validateFlac(encoded.bytes, { durationSeconds: 20000 / 44100, toleranceSeconds: 1 / 44100 }, { yieldToLoop: immediate });
    expect(good).toMatchObject({ ok: true, channels: 2, bits: 16, totalSamples: 20000, md5: encoded.md5 });

    const flip = (at: number) => {
      const copy = encoded.bytes.slice();
      copy[at] ^= 0x10;
      return copy;
    };
    const middle = Math.floor(encoded.bytes.length / 2);
    expect(await validateFlac(flip(middle), undefined, { yieldToLoop: immediate })).toMatchObject({ ok: false });
    expect(await validateFlac(flip(encoded.bytes.length - 1), undefined, { yieldToLoop: immediate })).toMatchObject({ ok: false, reason: expect.stringMatching(/CRC-16/) });
    expect(await validateFlac(flip(30), undefined, { yieldToLoop: immediate })).toMatchObject({ ok: false, reason: expect.stringMatching(/MD5/) });
    expect(await validateFlac(encoded.bytes.subarray(0, encoded.bytes.length - 100), undefined, { yieldToLoop: immediate })).toMatchObject({ ok: false });
    expect(await validateFlac(new Uint8Array(10))).toMatchObject({ ok: false, reason: expect.stringMatching(/fLaC/) });
    expect(await validateFlac(encoded.bytes, { durationSeconds: 3 }, { yieldToLoop: immediate })).toMatchObject({ ok: false, reason: expect.stringMatching(/lasts 0\.45 s/) });
  });
});

describe('FLAC encoding never blocks or leaks a partial file', () => {
  it('yields to the event loop between slices and reports progress', async () => {
    let yields = 0;
    const progress: number[] = [];
    const frames = 44100 * 10;
    await encodeFlac([chunk([signal(frames, 0), signal(frames, 1)])], 16, {
      yieldToLoop: async () => { yields += 1; },
      onProgress: (fraction) => progress.push(fraction),
    });
    // At least one yield per 32 frames; slower machines end slices earlier and yield more.
    expect(yields).toBeGreaterThanOrEqual(Math.ceil(Math.ceil(frames / 4096) / 32) - 1);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('a cancel mid-encode throws FlacCancelled and returns no bytes', async () => {
    const control = new AbortController();
    const frames = 44100 * 10;
    const pending = encodeFlac([chunk([signal(frames, 0), signal(frames, 1)])], 16, {
      signal: control.signal,
      yieldToLoop: async () => control.abort(),
    });
    await expect(pending).rejects.toBeInstanceOf(FlacCancelled);
  });

  it('refuses input it cannot store', async () => {
    await expect(encodeFlac([], 16)).rejects.toThrow(/no audio/);
    await expect(encodeFlac([chunk([new Float32Array(10)], 44100), chunk([new Float32Array(10)], 48000)], 16)).rejects.toThrow(/one sample rate/);
    await expect(encodeFlac([chunk([new Float32Array(10)])], 8 as FlacBits)).rejects.toThrow(/16-bit or 24-bit/);
  });
});

// Fixtures for tests/test_bf_flac_decode.py, which decodes these files with libsndfile and
// compares every sample against the raw integers. Written only when that test asks for them.
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined>; getBuiltinModule(id: string): unknown } }).process;
const outDir = env?.env.SELECTA_FLAC_FIXTURE_DIR;
describe.runIf(Boolean(outDir))('fixtures for the libsndfile cross-check', () => {
  it('writes FLAC files with the integer samples they must decode to', async () => {
    const fs = env!.getBuiltinModule('node:fs') as { writeFileSync(path: string, data: Uint8Array | string): void };
    const cases: { name: string; channels: number; frames: number; bits: FlacBits; rate: number }[] = [
      { name: 'stereo16', channels: 2, frames: 44100 * 6 + 333, bits: 16, rate: 44100 },
      { name: 'stereo24', channels: 2, frames: 48000 * 4 + 5, bits: 24, rate: 48000 },
      { name: 'mono16', channels: 1, frames: 22050 * 3, bits: 16, rate: 22050 },
      { name: 'odd24', channels: 2, frames: 4097, bits: 24, rate: 37800 },
    ];
    const manifest = [];
    for (const item of cases) {
      const channels = Array.from({ length: item.channels }, (_, index) => signal(item.frames, index, item.rate));
      const encoded = await encodeFlac([chunk(channels, item.rate)], item.bits, { yieldToLoop: immediate });
      const raw = new Int32Array(item.frames * item.channels);
      for (let frame = 0; frame < item.frames; frame += 1) {
        for (let channel = 0; channel < item.channels; channel += 1) raw[frame * item.channels + channel] = quantise(channels[channel][frame], item.bits);
      }
      fs.writeFileSync(`${outDir}/${item.name}.flac`, encoded.bytes);
      fs.writeFileSync(`${outDir}/${item.name}.i32`, new Uint8Array(raw.buffer));
      manifest.push({ ...item, md5: encoded.md5, sha256: encoded.sha256 });
    }
    fs.writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest));
  });
});
