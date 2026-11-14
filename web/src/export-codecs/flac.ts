import { type ByteSink, crc8, crc16, pcm16, crc32, crc32Blob } from './pcm';

/**
 * Strict native FLAC (not a renamed WAV): STREAMINFO + variable-blocksize frames
 * with 16-bit signed verbatim subframes, CRC-8 header and CRC-16 frame.
 * Lossless and standards-compliant, but intentionally compression=none. Future
 * WASM encoders may replace this implementation after licence/perf review.
 */
const BLOCK = 4096;
const MAX_TOTAL = 0xfffffffff; // FLAC STREAMINFO is 36 bits

function utf8Number(number: number): number[] {
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_TOTAL) throw new Error('Invalid FLAC sample number');
  const bits = [7, 11, 16, 21, 26, 31, 36];
  const length = bits.findIndex(x => number < 2 ** x) + 1;
  if (length === 1) return [number];
  const value = BigInt(number);
  const bytes: number[] = [];
  const payloadBits = 7 - length;
  bytes.push((((0xff << (8 - length)) & 255) | (Number(value >> BigInt(6 * (length - 1))) & ((1 << payloadBits) - 1))) & 255);
  for (let i = length - 2; i >= 0; i--) bytes.push(0x80 | (Number(value >> BigInt(6 * i)) & 63));
  return bytes;
}
function streamInfo(totalFrames: number, channels: 1 | 2, rate: number): Uint8Array {
  if (!Number.isSafeInteger(totalFrames) || totalFrames < 16 || totalFrames > MAX_TOTAL) throw new Error('Unsupported FLAC duration');
  if (!Number.isSafeInteger(rate) || rate < 8000 || rate > 192000) throw new Error('Unsupported FLAC sample rate');
  const bytes = new Uint8Array(42);
  bytes.set([102, 76, 97, 67, 0x80, 0, 0, 34], 0); // fLaC + last STREAMINFO block
  const view = new DataView(bytes.buffer);
  view.setUint16(8, 16, false); view.setUint16(10, BLOCK, false);
  // min/max compressed frame bytes unknown (0). MD5 all-zero = unavailable per FLAC spec.
  const packed = (BigInt(rate) << 44n) | (BigInt(channels - 1) << 41n) | (15n << 36n) | BigInt(totalFrames);
  for (let i = 0; i < 8; i++) bytes[18 + i] = Number((packed >> BigInt(56 - 8 * i)) & 255n);
  return bytes;
}
export class FlacWriter {
  readonly format = 'flac' as const;
  private pending: Float32Array[];
  private used = 0;
  private framesWritten = 0;
  private bytesWritten = 0;
  private checksum = 0;
  private constructor(private sink: ByteSink, readonly totalFrames: number, readonly channels: 1 | 2, readonly rate: number) {
    this.pending = Array.from({ length: channels }, () => new Float32Array(BLOCK));
  }
  static async open(sink: ByteSink, frames: number, channels: 1 | 2, rate: number): Promise<FlacWriter> {
    const head = streamInfo(frames, channels, rate);
    await sink.write(head);
    const writer = new FlacWriter(sink, frames, channels, rate);
    writer.bytesWritten = head.length; writer.checksum = crc32(head);
    return writer;
  }
  async push(channels: readonly Float32Array[]): Promise<void> {
    if (channels.length !== this.channels || channels.some(c => c.length !== channels[0].length)) throw new Error('FLAC channel mismatch');
    if (this.framesWritten + this.used + channels[0].length > this.totalFrames) throw new Error('FLAC stream exceeds recipe');
    let position = 0;
    while (position < channels[0].length) {
      const count = Math.min(BLOCK - this.used, channels[0].length - position);
      for (let c = 0; c < this.channels; c++) this.pending[c].set(channels[c].subarray(position, position + count), this.used);
      position += count; this.used += count;
      if (this.used === BLOCK) await this.flushBlock();
    }
  }
  private async flushBlock(): Promise<void> {
    if (!this.used) return;
    const blockFrames = this.used;
    const header = [0xff, 0xf9, 0x70, (this.channels - 1) << 4, ...utf8Number(this.framesWritten),
      (blockFrames - 1) >>> 8, (blockFrames - 1) & 255];
    header.push(crc8(new Uint8Array(header)));
    const bytes = new Uint8Array(header.length + this.channels * (1 + blockFrames * 2) + 2);
    bytes.set(header, 0);
    const view = new DataView(bytes.buffer);
    let at = header.length;
    for (let c = 0; c < this.channels; c++) {
      bytes[at++] = 0x02; // zero-pad, VERBATIM subframe type, no wasted bits
      for (let i = 0; i < blockFrames; i++) {
        view.setInt16(at, pcm16(this.pending[c][i]), false);
        at += 2;
      }
    }
    const crc = crc16(bytes.subarray(0, at));
    view.setUint16(at, crc, false);
    await this.sink.write(bytes);
    this.checksum = crc32(bytes, this.checksum);
    this.bytesWritten += bytes.length;
    this.framesWritten += blockFrames;
    this.used = 0;
  }
  async finish(): Promise<{ expectedBytes: number; crc32: number; frames: number }> {
    await this.flushBlock();
    if (this.framesWritten !== this.totalFrames) throw new Error('Truncated FLAC source');
    return { expectedBytes: this.bytesWritten, crc32: this.checksum, frames: this.framesWritten };
  }
}

/** Read-back structural, length, per-frame CRC and whole-file checks without
 * loading the entire output into memory. Real decoder compliance is a separate gate. */
export async function validateFlac(blob: Blob, frames: number, channels: 1 | 2, rate: number, checksum?: number): Promise<void> {
  if (blob.size < 42 || frames < 16) throw new Error('Truncated FLAC');
  const head = new Uint8Array(await blob.slice(0, 42).arrayBuffer());
  if (head.some((v, i) => v !== streamInfo(frames, channels, rate)[i])) throw new Error('Invalid FLAC STREAMINFO');
  let at = 42, sampleCount = 0;
  while (at < blob.size) {
    const prefix = new Uint8Array(await blob.slice(at, at + 16).arrayBuffer());
    if (prefix.length < 8 || prefix[0] !== 0xff || prefix[1] !== 0xf9 || prefix[2] !== 0x70 || prefix[3] !== (channels - 1) << 4) {
      throw new Error('Malformed FLAC frame header');
    }
    const utfLen = prefix[4] < 128 ? 1 : prefix[4] >= 0xfe ? 7 : prefix[4] >= 0xfc ? 6 : prefix[4] >= 0xf8 ? 5 : prefix[4] >= 0xf0 ? 4 : prefix[4] >= 0xe0 ? 3 : 2;
    for (let k = 1; k < utfLen; k++) if ((prefix[4 + k] & 0xc0) !== 0x80) throw new Error('Invalid FLAC sample index');
    const blockIndex = 4 + utfLen;
    const blockFrames = (((prefix[blockIndex] << 8) | prefix[blockIndex + 1]) + 1);
    const headerSize = blockIndex + 3;
    if (blockFrames < 1 || blockFrames > BLOCK || sampleCount + blockFrames > frames) throw new Error('Invalid FLAC block duration');
    const bytes = new Uint8Array(await blob.slice(at, at + headerSize + channels * (1 + blockFrames * 2) + 2).arrayBuffer());
    if (bytes.length !== headerSize + channels * (1 + blockFrames * 2) + 2) throw new Error('Truncated FLAC frame');
    if (crc8(bytes.subarray(0, headerSize - 1)) !== bytes[headerSize - 1]) throw new Error('FLAC header CRC mismatch');
    for (let c = 0; c < channels; c++) if (bytes[headerSize + c * (1 + blockFrames * 2)] !== 0x02) throw new Error('Unexpected FLAC subframe type');
    const frameCrc = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
    if (crc16(bytes.subarray(0, bytes.length - 2)) !== frameCrc) throw new Error('FLAC frame CRC mismatch');
    at += bytes.length;
    sampleCount += blockFrames;
  }
  if (at !== blob.size || sampleCount !== frames) throw new Error('FLAC duration mismatch');
  if (checksum !== undefined && await crc32Blob(blob) !== checksum) throw new Error('FLAC checksum mismatch');
}
