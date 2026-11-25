import { describe, expect, it } from 'vitest';
import { framesIn, readStreamInfo, windowFile } from './flacFrames';
import { PartReader } from './partReader';
import { LinkExpired, TimelinePlayer, type TimelinePart } from './timelinePlayer';

// A tiny FLAC writer and reader (16-bit, VERBATIM subframes), so the tests build real files whose
// every sample is known: sample n of channel c is (n * 7 + c * 1000) % 30000, plus a file tag.

const CRC8 = (() => { const t = new Uint8Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 0x80 ? ((c << 1) ^ 7) & 0xff : (c << 1) & 0xff; t[n] = c; } return t; })();
const crc8 = (b: number[]) => b.reduce((c, x) => CRC8[c ^ x], 0);
const crc16 = (b: number[]) => { let c = 0; for (const x of b) { c ^= x << 8; for (let k = 0; k < 8; k += 1) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; } return c; };
const sampleOf = (tag: number, n: number, c: number) => ((n * 7 + c * 1000 + tag * 333) % 30000) - 15000;

function utf8(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 63)];
  if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)];
  return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 63), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)];
}

/** A FLAC of `total` samples, stereo, 44.1 kHz, fixed blocks of `block` (the last one short). */
function flac(total: number, block = 1024, tag = 0): Uint8Array {
  const out: number[] = [0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34];
  const info = new Array(34).fill(0);
  info[0] = block >> 8; info[1] = block & 255; info[2] = block >> 8; info[3] = block & 255;
  // rate 44100 (20 bits), channels-1 = 1 (3 bits), bits-1 = 15 (5 bits), total (36 bits)
  const rate = 44100;
  info[10] = rate >> 12; info[11] = (rate >> 4) & 255; info[12] = ((rate & 15) << 4) | (1 << 1) | (15 >> 4);
  info[13] = ((15 & 15) << 4) | Math.floor(total / 2 ** 32);
  info[14] = (total >>> 24) & 255; info[15] = (total >>> 16) & 255; info[16] = (total >>> 8) & 255; info[17] = total & 255;
  out.push(...info);
  for (let frame = 0, start = 0; start < total; frame += 1, start += block) {
    const size = Math.min(block, total - start);
    const head = [0xff, 0xf8, (7 << 4) | 9, (1 << 4) | (4 << 1), ...utf8(frame), (size - 1) >> 8, (size - 1) & 255];
    head.push(crc8(head));
    const body: number[] = [];
    for (let c = 0; c < 2; c += 1) {
      body.push(0x02); // VERBATIM subframe, no wasted bits
      for (let n = 0; n < size; n += 1) { const v = sampleOf(tag, start + n, c) & 0xffff; body.push(v >> 8, v & 255); }
    }
    const all = [...head, ...body];
    const crc = crc16(all);
    out.push(...all, crc >> 8, crc & 255);
  }
  return new Uint8Array(out);
}

/** Decode what flac() writes (and what windowFile makes of it). */
function decode(bytes: Uint8Array): Float32Array[] {
  const stream = readStreamInfo(bytes)!;
  const { frames } = framesIn(bytes.subarray(stream.audioStart), stream, true);
  const channels = [[] as number[], [] as number[]];
  for (const frame of frames) {
    let at = stream.audioStart + frame.offset + 4;
    while ((bytes[at] & 0xc0) === 0x80 || at === stream.audioStart + frame.offset + 4) { at += 1; if ((bytes[at] & 0xc0) !== 0x80) break; }
    at += 2 + 1; // block size (2 bytes) and CRC-8
    for (let c = 0; c < 2; c += 1) {
      at += 1;
      for (let n = 0; n < frame.samples; n += 1) { const v = (bytes[at] << 8) | bytes[at + 1]; channels[c].push((v >= 0x8000 ? v - 0x10000 : v) / 32768); at += 2; }
    }
  }
  return channels.map((list) => Float32Array.from(list));
}

class FakeBuffer {
  constructor(public data: Float32Array[], public sampleRate = 44100) {}
  get length() { return this.data[0].length; }
  get numberOfChannels() { return this.data.length; }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(c: number) { return this.data[c]; }
  copyToChannel(from: Float32Array, c: number) { this.data[c].set(from); }
}

type Started = { when: number; buffer: FakeBuffer; gain: number };

function fakeContext(decodeDelay = () => Promise.resolve()) {
  const started: Started[] = [];
  const context = {
    currentTime: 0, sampleRate: 44100, state: 'running', closed: false, suspended: false, decodes: 0,
    destination: {},
    resume: async () => undefined,
    close: async () => { context.closed = true; },
    suspend: async () => { context.suspended = true; },
    async decodeAudioData(bytes: ArrayBuffer) { context.decodes += 1; await decodeDelay(); return new FakeBuffer(decode(new Uint8Array(bytes))); },
    createBuffer(channels: number, length: number, rate: number) { return new FakeBuffer(Array.from({ length: channels }, () => new Float32Array(length)), rate); },
    createGain() { const node = { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined }; return node; },
    createBufferSource() {
      let level = { gain: { value: 1 } };
      const source = {
        buffer: null as FakeBuffer | null, onended: null as null | (() => void),
        connect: (to: typeof level) => { level = to; return to; },
        disconnect: () => undefined,
        start: (when: number) => { started.push({ when, buffer: source.buffer!, gain: level.gain.value }); },
        stop: () => undefined,
      };
      return source;
    },
  };
  return { context, started };
}

const files = new Map<string, Uint8Array>();
const reads: string[] = [];
async function readUrl(url: string, start: number, end: number) {
  reads.push(url);
  if (url.includes('expired')) throw new LinkExpired('ran out');
  const file = files.get(url.split('?')[0]);
  if (!file) throw new Error('missing');
  return file.slice(start, end);
}

files.set('a.flac', flac(44100 * 30, 1024, 1));
files.set('seam.flac', flac(44100 * 6, 4096, 2));
files.set('b.flac', flac(44100 * 30, 47, 3));

const PARTS: TimelinePart[] = [
  { kind: 'song', from_s: 0, seconds: 20.5, url: 'a.flac', gain_db: -2 },
  { kind: 'seam', from_s: 0, seconds: 6, url: 'seam.flac' },
  { kind: 'song', from_s: 9.25, seconds: 12, url: 'b.flac', gain_db: 1 },
];

/** Every sample the player scheduled, laid end to end by start time, channel 0. */
function laidOut(started: Started[]) {
  const sorted = [...started].sort((a, b) => a.when - b.when);
  const out: number[] = [];
  for (const one of sorted) out.push(...one.buffer.data[0].map((x) => x * one.gain));
  return { sorted, out };
}

describe('flacFrames', () => {
  it('reads STREAMINFO and finds every frame, each confirmed by the next', () => {
    const file = files.get('b.flac')!;
    const stream = readStreamInfo(file)!;
    expect(stream).toMatchObject({ sampleRate: 44100, channels: 2, bitsPerSample: 16, fixedBlock: 47, totalSamples: 44100 * 30 });
    const { frames, next } = framesIn(file.subarray(stream.audioStart, stream.audioStart + 20000), stream);
    expect(frames[0]).toMatchObject({ offset: 0, sample: 0, samples: 47 });
    frames.forEach((frame, i) => expect(frame.sample).toBe(i * 47));
    expect(next!.sample).toBe(frames.length * 47);
  });

  it('a window from the middle of a file decodes to exactly those samples', () => {
    const file = files.get('a.flac')!;
    const stream = readStreamInfo(file)!;
    const middle = file.subarray(stream.audioStart + 50000, stream.audioStart + 90000);
    const { frames, next } = framesIn(middle, stream);
    const piece = windowFile(stream, middle.subarray(frames[0].offset, next!.offset));
    const decoded = decode(piece);
    const first = frames[0].sample;
    expect(decoded[0].length).toBe(next!.sample - first);
    expect(decoded[0][0]).toBeCloseTo(sampleOf(1, first, 0) / 32768, 6);
    expect(decoded[1][5]).toBeCloseTo(sampleOf(1, first + 5, 1) / 32768, 6);
  });
});

describe('PartReader', () => {
  it.each([0, 3.3, 9.25, 21.7])('reads a part starting at %s s as contiguous windows of exactly its samples', async (from) => {
    const file = files.get('b.flac')!;
    const reader = new PartReader(async (s, e) => file.slice(s, e), from, 5);
    await reader.open();
    const got: number[] = [];
    for (let window = await reader.next(); window; window = await reader.next()) {
      got.push(...decode(window.file)[0].slice(window.skip, window.skip + window.keep));
    }
    const begin = Math.round(from * 44100);
    expect(got.length).toBe(5 * 44100);
    expect(got[0]).toBeCloseTo(sampleOf(3, begin, 0) / 32768, 6);
    expect(got[got.length - 1]).toBeCloseTo(sampleOf(3, begin + 5 * 44100 - 1, 0) / 32768, 6);
  });
});

describe('TimelinePlayer', () => {
  const quietTimers = { every: () => () => undefined, sleep: async () => undefined };

  it('schedules every window back to back in whole frames, at each part’s level, sample-exact at the joins', async () => {
    const { context, started } = fakeContext();
    const player = new TimelinePlayer(PARTS, async () => PARTS, () => undefined, { ...quietTimers, context: () => context as never, readUrl, aheadS: 100 });
    await player.play();
    const { sorted, out } = laidOut(started);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(Math.round(sorted[i].when * 44100)).toBe(Math.round(sorted[i - 1].when * 44100) + sorted[i - 1].buffer.length);
    }
    const gain = (db: number) => 10 ** (db / 20);
    const expected = [
      ...Array.from({ length: Math.round(20.5 * 44100) }, (_, n) => sampleOf(1, n, 0) / 32768 * gain(-2)),
      ...Array.from({ length: 6 * 44100 }, (_, n) => sampleOf(2, n, 0) / 32768),
      ...Array.from({ length: 12 * 44100 }, (_, n) => sampleOf(3, Math.round(9.25 * 44100) + n, 0) / 32768 * gain(1)),
    ];
    expect(out.length).toBe(expected.length);
    let worst = 0;
    for (let i = 0; i < out.length; i += 1) worst = Math.max(worst, Math.abs(out[i] - expected[i]));
    expect(worst).toBeLessThan(1e-6);
  });

  it('keeps only about AHEAD seconds decoded, and lets windows go as they play', async () => {
    const { context } = fakeContext();
    const player = new TimelinePlayer(PARTS, async () => PARTS, () => undefined, { ...quietTimers, context: () => context as never, readUrl, aheadS: 6 });
    await player.play();
    const bound = (6 + 9) * 44100 * 2; // the horizon plus one window (8 s), two channels
    expect(player.stats.peakHeldFrames).toBeLessThanOrEqual(bound);
    expect(player.stats.peakHeldFrames).toBeGreaterThan(0);
  });

  it('never schedules a part twice however often the clock ticks while a decode is slow', async () => {
    let release: () => void = () => undefined;
    const slow = () => new Promise<void>((done) => { release = done; });
    const { context, started } = fakeContext(slow);
    let tick: () => void = () => undefined;
    const player = new TimelinePlayer(PARTS, async () => PARTS, () => undefined, { context: () => context as never, readUrl, aheadS: 100, every: (_ms, run) => { tick = run; return () => undefined; }, sleep: async () => undefined });
    const playing = player.play();
    await new Promise((done) => setTimeout(done, 0));
    for (let i = 0; i < 50; i += 1) tick();
    for (let i = 0; i < 200; i += 1) { release(); await new Promise((done) => setTimeout(done, 0)); }
    await playing;
    const whens = started.map((one) => Math.round(one.when * 44100));
    expect(new Set(whens).size).toBe(whens.length);
    expect(laidOut(started).out.length).toBe(Math.round((20.5 + 6 + 12) * 44100));
  });

  it('Stop silences everything and lets every window go; leaving the page closes the context', async () => {
    const { context } = fakeContext();
    let made = 0;
    const player = new TimelinePlayer(PARTS, async () => PARTS, () => undefined, { ...quietTimers, context: () => { made += 1; return context as never; }, readUrl, aheadS: 10 });
    await player.play();
    player.stop();
    expect(context.suspended).toBe(true);
    expect(context.closed).toBe(false);
    expect(player.stats.heldFrames).toBe(0);
    expect(player.state.playing).toBe(false);
    await player.play(1);
    expect(made).toBe(1); // the silent context is used again: no second wait to make one
    player.close();
    expect(context.closed).toBe(true);
    expect(player.stats.heldFrames).toBe(0);
  });

  it('asks for fresh links when a read is refused, and when its links are old', async () => {
    const stale: TimelinePart[] = PARTS.map((part) => ({ ...part, url: `expired-${part.url}` }));
    let refreshed = 0;
    let clock = 0;
    const { context } = fakeContext();
    const player = new TimelinePlayer(stale, async () => { refreshed += 1; return PARTS; }, () => undefined, { ...quietTimers, context: () => context as never, readUrl, aheadS: 100, now: () => clock });
    await player.play();
    expect(refreshed).toBe(1);
    expect(player.state.error).toBeNull();
    clock = 11 * 60 * 1000;
    await player.play(2);
    expect(refreshed).toBe(2);
  });

  it('says plainly when a part cannot be read, and keeps the place for Try again', async () => {
    const broken: TimelinePart[] = [PARTS[0], { ...PARTS[1], url: 'missing.flac' }, PARTS[2]];
    const states: string[] = [];
    const { context } = fakeContext();
    const player = new TimelinePlayer(broken, async () => broken, (state) => { if (state.error) states.push(state.error); }, { ...quietTimers, context: () => context as never, readUrl, aheadS: 100 });
    await player.play();
    expect(states.at(-1)).toBe('missing');
    expect(player.state.playing).toBe(false);
    expect(player.stats.heldFrames).toBe(0);
  });
});
