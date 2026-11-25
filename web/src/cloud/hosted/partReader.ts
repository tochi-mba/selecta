import { framesIn, readStreamInfo, windowFile, type StreamInfo } from './flacFrames';

/** Reads one part of a hosted timeline (a stretch of a lossless file) a window at a time
 * (cloud.hosted_render). See flacFrames.ts for why the player never decodes a whole song.
 *
 * Each window is a small FLAC file of whole frames plus where its samples sit in the source file;
 * the player decodes it, trims the first and last window to the part's exact samples, and schedules
 * it straight after the one before. Bytes come through `read`, which the player gives ranged reads
 * of the part's signed link (and fresh links when one runs out).
 *
 * A jump reads only what it needs: the file's header once per session (`heads`), then a few small
 * probes from the nearest frames this session already saw in that file (`points`), and the first
 * window starts with the bytes of the last probe rather than reading them again. */

export type ReadBytes = (start: number, end: number) => Promise<Uint8Array>;

export type Window = {
  /** A FLAC file to decode, or the whole source when it isn't FLAC (an original played as is). */
  file: Uint8Array;
  /** The first sample of `file` in the source. */
  sample: number;
  /** Samples to drop from the start of the decoded window, and how many to keep after that. */
  skip: number;
  keep: number;
  last: boolean;
};

export const HEAD_BYTES = 64 * 1024;
const PROBE_BYTES = 96 * 1024;
/** About this many seconds of audio per window: small enough for a phone, big enough that the
 * per-window cost (a read and a decode) stays well under the time it plays. */
export const WINDOW_SECONDS = 8;
/** The first window after a start or a jump is shorter, so the first sound comes sooner. */
export const FIRST_WINDOW_SECONDS = 3;
const MAX_HEAD_BYTES = 4 * 1024 * 1024;
const SEEK_TRIES = 24;

type Point = { offset: number; sample: number };

/** Per file (the signed link without its signature), for this page's life: the header bytes, and
 * frame starts seen so far, sorted by sample. Signed links change every few minutes; the file
 * behind one does not. Bounded: the oldest file is let go past `KEEP_FILES`. */
const KEEP_FILES = 48;
const heads = new Map<string, Uint8Array>();
const points = new Map<string, Point[]>();

/** The part of a signed link that names the file (the signature and expiry are dropped). */
export function fileKey(url: string): string {
  const at = url.indexOf('?');
  return at < 0 ? url : url.slice(0, at);
}

function remember<T>(store: Map<string, T>, key: string, value: T) {
  store.delete(key);
  store.set(key, value);
  if (store.size > KEEP_FILES) store.delete(store.keys().next().value as string);
}

/** Forget every cached header and frame point (tests). */
export function forgetFiles() { heads.clear(); points.clear(); }

export class PartReader {
  stream: StreamInfo | null = null;
  private offset = 0; // the next window's first byte
  private sample = 0; // ...and its first sample
  private bytesPerSample = 0;
  private begin = 0;
  private end = 0;
  private done = false;
  private first = true;
  private whole: Uint8Array | null = null;
  /** Bytes already read from `offset` on (the tail of the probe that found the frame). */
  private carry: Uint8Array | null = null;

  constructor(private read: ReadBytes, private fromS: number, private seconds: number, private key: string | null = null) {}

  get finished() { return this.done; }

  /** The part's first sample in the source, at the stream's rate. */
  get startSample() { return this.begin; }

  private known(): Point[] {
    if (!this.key) return [];
    let list = points.get(this.key);
    if (!list) { list = []; remember(points, this.key, list); }
    return list;
  }

  /** Note a frame start seen in the file, so a later jump into it starts closer. */
  private learn(point: Point) {
    if (!this.key) return;
    const list = this.known();
    let lo = 0;
    let hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].sample < point.sample) lo = mid + 1; else hi = mid; }
    if (list[lo]?.sample === point.sample) return;
    list.splice(lo, 0, point);
    if (list.length > 4096) list.splice(0, list.length - 4096);
  }

  private async header(): Promise<{ head: Uint8Array; size: number; stream: StreamInfo | null }> {
    const cached = this.key ? heads.get(this.key) : undefined;
    if (cached) return { head: cached, size: cached.length + 1, stream: readStreamInfo(cached) };
    let size = HEAD_BYTES;
    let head = await this.read(0, size);
    for (;;) {
      try {
        const stream = readStreamInfo(head);
        if (stream && this.key) remember(heads, this.key, head);
        return { head, size, stream };
      } catch (problem) {
        if (!(problem instanceof RangeError) || size >= MAX_HEAD_BYTES || head.length < size) throw new Error('This part of the mix is not a playable file.');
        size *= 4;
        head = await this.read(0, size);
      }
    }
  }

  /** Read the header and find the frame the part starts in. `skipS` starts later into the part. */
  async open(skipS = 0): Promise<void> {
    const { head, size, stream } = await this.header();
    if (!stream) {
      // not FLAC: an original the server hands over as is. Read it whole (an MP3 is a few MB).
      this.whole = head.length < size ? head : await this.readAll(head);
      return;
    }
    this.stream = stream;
    const rate = stream.sampleRate;
    this.begin = Math.round((this.fromS + skipS) * rate);
    const length = Math.round((this.seconds - skipS) * rate);
    this.end = stream.totalSamples ? Math.min(stream.totalSamples, this.begin + length) : this.begin + length;
    const inHead = framesIn(head.subarray(stream.audioStart), stream).frames;
    const last = inHead[inHead.length - 1];
    this.bytesPerSample = last && last.sample > 0 ? (last.offset) / last.sample : stream.channels * stream.bitsPerSample / 8 * 0.7;
    if (this.bytesPerSample <= 0) this.bytesPerSample = stream.channels * stream.bitsPerSample / 8 * 0.7;
    const holding = inHead.find((frame) => frame.sample <= this.begin && this.begin < frame.sample + frame.samples);
    if (holding) { // the part starts in the header's own bytes: no probe at all
      this.offset = stream.audioStart + holding.offset;
      this.sample = holding.sample;
      this.carry = head.subarray(this.offset);
      return;
    }
    await this.seek(this.begin);
  }

  private async readAll(head: Uint8Array): Promise<Uint8Array> {
    const parts: Uint8Array[] = [head];
    let at = head.length;
    for (;;) {
      const more = await this.read(at, at + 4 * 1024 * 1024);
      if (!more.length) break;
      parts.push(more);
      at += more.length;
      if (more.length < 4 * 1024 * 1024) break;
      if (at > 64 * 1024 * 1024) throw new Error('This part of the mix is too large to play here.');
    }
    const out = new Uint8Array(at);
    let put = 0;
    for (const part of parts) { out.set(part, put); put += part.length; }
    return out;
  }

  /** Find the frame that holds `target`. Every read narrows a bracket (a frame known to be before
   * the target, one known after it) and the next read lands where the bracket's bytes per sample
   * say the target is: loud and quiet passages compress differently, so one average is not enough.
   * The bracket starts from the closest frames this session already saw in the file. Once the
   * bracket is small, it is simply read from its start. */
  private async seek(target: number): Promise<void> {
    const stream = this.stream!;
    let lo: Point = { offset: stream.audioStart, sample: 0 };
    let hi: Point | null = null;
    for (const point of this.known()) {
      if (point.sample <= target) lo = point;
      else { hi = point; break; }
    }
    let hiSample = hi ? hi.sample : stream.totalSamples; // the sample at `hi`, or the end of the file before any is found
    const spread = (from: Point) => hi && hi.sample > from.sample ? (hi.offset - from.offset) / (hi.sample - from.sample) : this.bytesPerSample;
    let guess = lo.offset + Math.floor((target - lo.sample) * spread(lo)) - PROBE_BYTES / 2;
    // once a real bracket says where the target is, a probe is as long as the first window, so the
    // read that finds the frame is also the read the first window plays from
    const firstBytes = Math.ceil(FIRST_WINDOW_SECONDS * stream.sampleRate * this.bytesPerSample) + PROBE_BYTES / 2;
    for (let tries = 0; tries < SEEK_TRIES; tries += 1) {
      if (hi && hi.offset - lo.offset <= 2 * PROBE_BYTES) guess = lo.offset;
      const size = hi ? Math.max(PROBE_BYTES, firstBytes) : PROBE_BYTES;
      const at = Math.max(lo.offset, Math.min(guess, hi ? hi.offset - PROBE_BYTES / 2 : guess));
      const bytes = await this.read(at, at + size);
      const atEnd = bytes.length < size;
      const { frames, next } = framesIn(bytes, stream, atEnd);
      const all = next ? [...frames, next] : frames;
      if (!all.length) {
        if (at === stream.audioStart) throw new Error('This part of the mix could not be read.');
        hi = { offset: at, sample: hiSample };
        guess = lo.offset + Math.floor((at - lo.offset) / 2);
        continue;
      }
      const first = all[0];
      const final = all[all.length - 1];
      this.learn({ offset: at + first.offset, sample: first.sample });
      if (frames.length) this.learn({ offset: at + final.offset, sample: final.sample });
      const holding = all.find((frame) => frame.sample <= target && target < frame.sample + frame.samples);
      const land = (frame: { offset: number; sample: number }) => {
        this.offset = at + frame.offset;
        this.sample = frame.sample;
        this.carry = bytes.subarray(frame.offset);
      };
      if (holding) { land(holding); return; }
      if (first.sample > target) {
        if (at <= stream.audioStart) { land(first); return; }
        hi = { offset: at + first.offset, sample: first.sample };
        hiSample = first.sample;
      } else {
        if (atEnd) { land(final); return; } // past the end
        lo = { offset: at + final.offset, sample: final.sample };
      }
      guess = lo.offset + Math.floor((target - lo.sample) * spread(lo)) - PROBE_BYTES / 2;
    }
    throw new Error('This part of the mix could not be found in its file.');
  }

  /** Bytes `offset` to `offset + size`, starting with what the seek already read. */
  private async bytesFrom(size: number): Promise<Uint8Array> {
    const carry = this.carry;
    this.carry = null;
    if (!carry || !carry.length) return this.read(this.offset, this.offset + size);
    if (carry.length >= size) return carry.subarray(0, size);
    const more = await this.read(this.offset + carry.length, this.offset + size);
    const out = new Uint8Array(carry.length + more.length);
    out.set(carry, 0);
    out.set(more, carry.length);
    return out;
  }

  /** The next window, or null when the part is over. */
  async next(): Promise<Window | null> {
    if (this.done) return null;
    if (this.whole) {
      this.done = true;
      return { file: this.whole, sample: 0, skip: -1, keep: -1, last: true };
    }
    const stream = this.stream!;
    const seconds = this.first ? FIRST_WINDOW_SECONDS : WINDOW_SECONDS;
    const want = Math.max(PROBE_BYTES, Math.ceil(seconds * stream.sampleRate * this.bytesPerSample));
    let size = want;
    for (;;) {
      const bytes = await this.bytesFrom(size);
      const final = bytes.length < size;
      const { frames, next } = framesIn(bytes, stream, final);
      if (!frames.length || frames[0].offset !== 0) {
        if (final && !frames.length) { this.done = true; return null; }
        if (frames.length && frames[0].offset !== 0) throw new Error('This part of the mix could not be read.');
        size *= 2;
        if (size > 32 * 1024 * 1024) throw new Error('This part of the mix could not be read.');
        this.carry = bytes; // read on from here instead of from the start again
        continue;
      }
      this.first = false;
      const start = this.sample;
      const lastFrame = frames[frames.length - 1];
      const stop = next ? next.offset : bytes.length;
      const covered = lastFrame.sample + lastFrame.samples;
      const skip = Math.max(0, this.begin - start);
      const keep = Math.max(0, Math.min(covered, this.end) - start - skip);
      this.done = covered >= this.end || final || !next;
      if (next) {
        this.learn({ offset: this.offset + next.offset, sample: next.sample });
        this.offset += next.offset;
        this.sample = next.sample;
      }
      return { file: windowFile(stream, bytes.subarray(0, stop)), sample: start, skip, keep, last: this.done };
    }
  }
}
