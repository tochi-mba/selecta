/** Just enough FLAC to play a lossless file a few seconds at a time (cloud.hosted_render).
 *
 * The hosted player never decodes a whole song: a 3 to 4 minute 24-bit file is 30 to 60 MB on
 * the wire and 60 to 90 MB once decoded, and holding several made the tab stall. Instead it reads a
 * window of bytes, finds the frames in it, and hands the browser's own decoder a tiny FLAC made of
 * the file's STREAMINFO and those whole frames. FLAC frames decode independently, so windows
 * joined back to back are the same samples as the whole file: the joins stay sample-exact.
 *
 * A frame header says where it sits in the stream (its frame or sample number) and carries a CRC-8,
 * so a frame can be found from any byte offset. A header is trusted only when the next one follows
 * on (number + 1), which rules out the odd byte pattern that looks like a header inside audio data.
 */

export type StreamInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** min block size === max block size: frame headers carry frame numbers, not sample numbers. */
  fixedBlock: number | null;
  totalSamples: number;
  /** Byte offset of the first audio frame. */
  audioStart: number;
  /** The STREAMINFO block (34 bytes), copied into every window's header. */
  info: Uint8Array;
};

export type Frame = { offset: number; sample: number; samples: number };

const BLOCK_SIZES: Record<number, number> = {
  1: 192, 2: 576, 3: 1152, 4: 2304, 5: 4608, 8: 256, 9: 512, 10: 1024, 11: 2048, 12: 4096, 13: 8192, 14: 16384, 15: 32768,
};
const RATES: Record<number, number> = { 1: 88200, 2: 176400, 3: 192000, 4: 8000, 5: 16000, 6: 22050, 7: 24000, 8: 32000, 9: 44100, 10: 48000, 11: 96000 };
const DEPTHS: Record<number, number> = { 1: 8, 2: 12, 4: 16, 5: 20, 6: 24, 7: 32 };

const CRC8 = (() => {
  const table = new Uint8Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    table[n] = c;
  }
  return table;
})();

function crc8(bytes: Uint8Array, from: number, to: number): number {
  let c = 0;
  for (let i = from; i < to; i += 1) c = CRC8[c ^ bytes[i]];
  return c;
}

/** The metadata at the start of a FLAC file, or null when `head` is not FLAC. Throws RangeError
 * when `head` stops inside the metadata: read more and ask again. */
export function readStreamInfo(head: Uint8Array): StreamInfo | null {
  if (head.length < 4 || head[0] !== 0x66 || head[1] !== 0x4c || head[2] !== 0x61 || head[3] !== 0x43) return null; // fLaC
  let at = 4;
  let info: Uint8Array | null = null;
  for (;;) {
    if (at + 4 > head.length) throw new RangeError('metadata continues');
    const last = (head[at] & 0x80) !== 0;
    const type = head[at] & 0x7f;
    const size = (head[at + 1] << 16) | (head[at + 2] << 8) | head[at + 3];
    if (type === 0) {
      if (at + 4 + 34 > head.length) throw new RangeError('metadata continues');
      info = head.slice(at + 4, at + 4 + 34);
    }
    at += 4 + size;
    if (last) break;
  }
  if (!info) return null;
  const minBlock = (info[0] << 8) | info[1];
  const maxBlock = (info[2] << 8) | info[3];
  const sampleRate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4);
  const channels = ((info[12] >> 1) & 0x07) + 1;
  const bitsPerSample = (((info[12] & 1) << 4) | (info[13] >> 4)) + 1;
  const totalSamples = (info[13] & 0x0f) * 2 ** 32 + ((info[14] << 24) >>> 0) + (info[15] << 16) + (info[16] << 8) + info[17];
  return { sampleRate, channels, bitsPerSample, fixedBlock: minBlock === maxBlock ? minBlock : null, totalSamples, audioStart: at, info };
}

/** A frame header at `at`, checked against the stream (rate, channels, depth, CRC-8). */
export function frameAt(bytes: Uint8Array, at: number, stream: StreamInfo): Frame | null {
  if (at + 6 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xfe) !== 0xf8) return null;
  const variable = (bytes[at + 1] & 1) === 1;
  const blockCode = bytes[at + 2] >> 4;
  const rateCode = bytes[at + 2] & 0x0f;
  const channelCode = bytes[at + 3] >> 4;
  const depthCode = (bytes[at + 3] >> 1) & 0x07;
  if (blockCode === 0 || rateCode === 15 || (bytes[at + 3] & 1) !== 0 || channelCode > 10) return null;
  if (rateCode !== 0 && rateCode < 12 && RATES[rateCode] !== stream.sampleRate) return null;
  if ((channelCode < 8 ? channelCode + 1 : 2) !== stream.channels) return null;
  if (depthCode !== 0 && DEPTHS[depthCode] !== stream.bitsPerSample) return null;
  // the frame or sample number, UTF-8 style
  let j = at + 4;
  const lead = bytes[j];
  let number: number;
  let extra: number;
  if (lead < 0x80) { number = lead; extra = 0; }
  else if (lead >= 0xc0 && lead < 0xe0) { number = lead & 0x1f; extra = 1; }
  else if (lead >= 0xe0 && lead < 0xf0) { number = lead & 0x0f; extra = 2; }
  else if (lead >= 0xf0 && lead < 0xf8) { number = lead & 0x07; extra = 3; }
  else if (lead >= 0xf8 && lead < 0xfc) { number = lead & 0x03; extra = 4; }
  else if (lead >= 0xfc && lead < 0xfe) { number = lead & 0x01; extra = 5; }
  else if (lead === 0xfe) { number = 0; extra = 6; }
  else return null;
  if (j + 1 + extra + 4 > bytes.length) return null;
  for (let k = 1; k <= extra; k += 1) {
    const next = bytes[j + k];
    if ((next & 0xc0) !== 0x80) return null;
    number = number * 64 + (next & 0x3f);
  }
  j += 1 + extra;
  let samples: number;
  if (blockCode === 6) { samples = bytes[j] + 1; j += 1; }
  else if (blockCode === 7) { samples = ((bytes[j] << 8) | bytes[j + 1]) + 1; j += 2; }
  else samples = BLOCK_SIZES[blockCode] ?? 0;
  if (!samples) return null;
  if (rateCode === 12) j += 1;
  else if (rateCode === 13 || rateCode === 14) j += 2;
  if (j >= bytes.length || crc8(bytes, at, j) !== bytes[j]) return null;
  let sample = number;
  if (!variable) {
    if (!stream.fixedBlock) return null;
    sample = number * stream.fixedBlock;
  }
  return { offset: at, sample, samples };
}

/** The chain of frames that start in `bytes` (offsets relative to `bytes`): each header is
 * confirmed by the next one following on. The last header found can't be confirmed (its frame
 * may run past the window), so it is returned as `next`, where the next window starts; the frames
 * before it are whole. With `final` (the window ends at the end of the file) it is a whole frame. */
export function framesIn(bytes: Uint8Array, stream: StreamInfo, final = false): { frames: Frame[]; next: Frame | null } {
  const candidates: Frame[] = [];
  for (let at = 0; at + 6 <= bytes.length; at += 1) {
    if (bytes[at] !== 0xff) continue;
    const frame = frameAt(bytes, at, stream);
    if (frame) candidates.push(frame);
  }
  const bySample = new Map<number, Frame[]>();
  for (const frame of candidates) {
    const list = bySample.get(frame.sample);
    if (list) list.push(frame); else bySample.set(frame.sample, [frame]);
  }
  const after = (frame: Frame) => bySample.get(frame.sample + frame.samples)?.find((next) => next.offset > frame.offset) ?? null;
  const first = candidates.find((frame) => after(frame) !== null);
  if (!first) return { frames: final && candidates.length === 1 ? candidates : [], next: final ? null : candidates[0] ?? null };
  const frames: Frame[] = [];
  let at: Frame | null = first;
  while (at) {
    const next = after(at);
    if (!next) break;
    frames.push(at);
    at = next;
  }
  if (final) { frames.push(at); return { frames, next: null }; }
  return { frames, next: at };
}

/** A playable FLAC: the stream's STREAMINFO (total samples and MD5 cleared, since this is a piece)
 * followed by whole frames. */
export function windowFile(stream: StreamInfo, frames: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 4 + 34 + frames.length);
  out.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34], 0); // fLaC, last block: STREAMINFO, 34 bytes
  const info = stream.info.slice();
  info[13] &= 0xf0; // total samples unknown
  info.fill(0, 14, 34); // ...and no MD5
  out.set(info, 8);
  out.set(frames, 42);
  return out;
}
