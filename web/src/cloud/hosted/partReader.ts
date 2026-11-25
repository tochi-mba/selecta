import { framesIn, readStreamInfo, windowFile, type StreamInfo } from './flacFrames';

/** Reads one part of a hosted timeline (a stretch of a lossless file) a window at a time
 * (cloud.hosted_render). See flacFrames.ts for why the player never decodes a whole song.
 *
 * Each window is a small FLAC file of whole frames plus where its samples sit in the source file;
 * the player decodes it, trims the first and last window to the part's exact samples, and schedules
 * it straight after the one before. Bytes come through `read`, which the player gives ranged reads
 * of the part's signed link (and fresh links when one runs out). */

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
const MAX_HEAD_BYTES = 4 * 1024 * 1024;
const SEEK_TRIES = 8;

export class PartReader {
  stream: StreamInfo | null = null;
  private offset = 0; // the next window's first byte
  private sample = 0; // ...and its first sample
  private bytesPerSample = 0;
  private begin = 0;
  private end = 0;
  private done = false;
  private whole: Uint8Array | null = null;

  constructor(private read: ReadBytes, private fromS: number, private seconds: number) {}

  get finished() { return this.done; }

  /** The part's first sample in the source, at the stream's rate. */
  get startSample() { return this.begin; }

  /** Read the header and find the frame the part starts in. `skipS` starts later into the part. */
  async open(skipS = 0): Promise<void> {
    let size = HEAD_BYTES;
    let head = await this.read(0, size);
    let stream: StreamInfo | null = null;
    for (;;) {
      try { stream = readStreamInfo(head); break; } catch (problem) {
        if (!(problem instanceof RangeError) || size >= MAX_HEAD_BYTES || head.length < size) throw new Error('This part of the mix is not a playable file.');
        size *= 4;
        head = await this.read(0, size);
      }
    }
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

  /** Find the frame that holds `target`: guess the byte from the average frame size, read a little
   * there, and correct the guess from the frame numbers found. */
  private async seek(target: number): Promise<void> {
    const stream = this.stream!;
    let guess = stream.audioStart + Math.floor(target * this.bytesPerSample) - PROBE_BYTES / 2;
    for (let tries = 0; tries < SEEK_TRIES; tries += 1) {
      const at = Math.max(stream.audioStart, guess);
      const bytes = await this.read(at, at + PROBE_BYTES);
      const { frames, next } = framesIn(bytes, stream, bytes.length < PROBE_BYTES);
      const all = next ? [...frames, next] : frames;
      if (!all.length) {
        if (at === stream.audioStart) throw new Error('This part of the mix could not be read.');
        guess = at - PROBE_BYTES;
        continue;
      }
      const first = all[0];
      const final = all[all.length - 1];
      if (first.sample > target) {
        if (at === stream.audioStart) { this.offset = at + first.offset; this.sample = first.sample; return; }
        guess = at - Math.ceil((first.sample - target) * this.bytesPerSample * 1.2) - PROBE_BYTES / 4;
        continue;
      }
      const holding = all.find((frame) => frame.sample <= target && target < frame.sample + frame.samples);
      if (holding && holding !== final) { this.offset = at + holding.offset; this.sample = holding.sample; return; }
      if (holding === final || (final.sample <= target && final.sample + final.samples > target)) {
        this.offset = at + final.offset; this.sample = final.sample; return;
      }
      if (bytes.length < PROBE_BYTES) { this.offset = at + final.offset; this.sample = final.sample; return; } // past the end
      // the target is further on: move by what the frames here say about bytes per sample
      const span = final.sample - first.sample;
      if (span > 0) this.bytesPerSample = (final.offset - first.offset) / span;
      guess = at + final.offset + Math.floor((target - final.sample) * this.bytesPerSample) - PROBE_BYTES / 4;
    }
    throw new Error('This part of the mix could not be found in its file.');
  }

  /** The next window, or null when the part is over. */
  async next(): Promise<Window | null> {
    if (this.done) return null;
    if (this.whole) {
      this.done = true;
      return { file: this.whole, sample: 0, skip: -1, keep: -1, last: true };
    }
    const stream = this.stream!;
    const want = Math.max(PROBE_BYTES, Math.ceil(WINDOW_SECONDS * stream.sampleRate * this.bytesPerSample));
    let size = want;
    for (;;) {
      const bytes = await this.read(this.offset, this.offset + size);
      const final = bytes.length < size;
      const { frames, next } = framesIn(bytes, stream, final);
      if (!frames.length || frames[0].offset !== 0) {
        if (final && !frames.length) { this.done = true; return null; }
        if (frames.length && frames[0].offset !== 0) throw new Error('This part of the mix could not be read.');
        size *= 2;
        if (size > 32 * 1024 * 1024) throw new Error('This part of the mix could not be read.');
        continue;
      }
      const start = this.sample;
      const lastFrame = frames[frames.length - 1];
      const stop = next ? next.offset : bytes.length;
      const covered = lastFrame.sample + lastFrame.samples;
      const skip = Math.max(0, this.begin - start);
      const keep = Math.max(0, Math.min(covered, this.end) - start - skip);
      this.done = covered >= this.end || final || !next;
      if (next) { this.offset += next.offset; this.sample = next.sample; }
      return { file: windowFile(stream, bytes.subarray(0, stop)), sample: start, skip, keep, last: this.done };
    }
  }
}
