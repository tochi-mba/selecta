import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { BitReader, crc16, crc8 } from './flacBits';

/** A small FLAC reader that checks the exporter's own files (ADR-0457, BF-0457-06).
 *
 * It decodes everything flac.ts writes (CONSTANT, VERBATIM and FIXED subframes, wasted bits,
 * RICE and RICE2 residuals with escapes, all stereo decorrelation modes) and refuses LPC
 * subframes, which the encoder never produces. validateFlac is what export.ts runs on the
 * finished bytes before offering them: every frame's CRC-8 and CRC-16, consecutive frame
 * numbers, the decoded sample count against STREAMINFO, and the MD5 of the decoded PCM against
 * the MD5 the encoder stored. A file that fails any of these is never presented as complete.
 * decodeFlac returns all samples and is meant for tests; tests also decode with libsndfile
 * (tests/test_bf_flac_decode.py), so this reader is not the only judge of its own encoder.
 */

export type FlacStreamInfo = {
  minBlockSize: number;
  maxBlockSize: number;
  minFrameSize: number;
  maxFrameSize: number;
  sampleRate: number;
  channels: number;
  bits: number;
  totalSamples: number;
  md5: string;
};

export type FlacDetails = {
  ok: true;
  sampleRate: number;
  channels: number;
  bits: number;
  durationSeconds: number;
  totalSamples: number;
  frames: number;
  md5: string;
};
export type FlacProblem = { ok: false; reason: string };

const RATES = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
const SIZES = [0, 8, 12, 0, 16, 20, 24, 32];

function readStreamInfo(bytes: Uint8Array): { info: FlacStreamInfo; audioStart: number } {
  if (bytes.length < 42 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'fLaC') {
    throw new Error('The file is missing its fLaC marker.');
  }
  let at = 4;
  let info: FlacStreamInfo | null = null;
  for (;;) {
    if (at + 4 > bytes.length) throw new Error('The metadata runs past the end of the file.');
    const header = new BitReader(bytes, at);
    const last = header.readBits(1) === 1;
    const type = header.readBits(7);
    const length = header.readBits(24);
    if (at + 4 + length > bytes.length) throw new Error('A metadata block runs past the end of the file.');
    if (type === 0) {
      if (length !== 34) throw new Error('STREAMINFO has the wrong length.');
      const read = new BitReader(bytes, at + 4);
      const minBlockSize = read.readBits(16);
      const maxBlockSize = read.readBits(16);
      const minFrameSize = read.readBits(24);
      const maxFrameSize = read.readBits(24);
      const sampleRate = read.readBits(20);
      const channels = read.readBits(3) + 1;
      const bits = read.readBits(5) + 1;
      const totalSamples = read.readBits(4) * 2 ** 32 + read.readBits(32);
      const sum = bytes.subarray(at + 4 + 18, at + 4 + 34);
      info = { minBlockSize, maxBlockSize, minFrameSize, maxFrameSize, sampleRate, channels, bits, totalSamples, md5: bytesToHex(sum) };
    } else if (!info) {
      throw new Error('STREAMINFO must be the first metadata block.');
    }
    at += 4 + length;
    if (last) break;
  }
  if (!info) throw new Error('The file has no STREAMINFO.');
  return { info, audioStart: at };
}

function readCodedNumber(read: BitReader): number {
  const first = read.readBits(8);
  if (first < 0x80) return first;
  let extra = 0;
  while (extra < 7 && first & (0x40 >> extra)) extra += 1;
  if (extra === 0 || extra > 6) throw new Error('A frame number is badly coded.');
  let value = first & (0x3f >> extra);
  for (let index = 0; index < extra; index += 1) {
    const next = read.readBits(8);
    if ((next & 0xc0) !== 0x80) throw new Error('A frame number is badly coded.');
    value = value * 64 + (next & 0x3f);
  }
  return value;
}

function readResidual(read: BitReader, blockSize: number, order: number, out: Int32Array) {
  const method = read.readBits(2);
  if (method > 1) throw new Error('A residual uses a reserved coding method.');
  const paramBits = method === 0 ? 4 : 5;
  const escape = method === 0 ? 15 : 31;
  const partitionOrder = read.readBits(4);
  const partitions = 1 << partitionOrder;
  const span = blockSize >> partitionOrder;
  if (span << partitionOrder !== blockSize || span < order) throw new Error('The residual partitions do not fit the block.');
  let at = order;
  for (let partition = 0; partition < partitions; partition += 1) {
    const count = partition === 0 ? span - order : span;
    const k = read.readBits(paramBits);
    if (k === escape) {
      const raw = read.readBits(5);
      for (let index = 0; index < count; index += 1) out[at++] = raw === 0 ? 0 : read.readSigned(raw);
      continue;
    }
    const scale = 2 ** k;
    for (let index = 0; index < count; index += 1) {
      const value = read.readUnary() * scale + read.readBits(k);
      out[at++] = value % 2 === 0 ? value / 2 : -(value + 1) / 2;
    }
  }
}

function readSubframe(read: BitReader, blockSize: number, bps: number, out: Int32Array) {
  if (read.readBits(1) !== 0) throw new Error('A subframe has a bad padding bit.');
  const type = read.readBits(6);
  let wasted = 0;
  if (read.readBits(1) === 1) wasted = read.readUnary() + 1;
  const width = bps - wasted;
  if (type === 0) {
    const value = read.readSigned(width);
    out.fill(value, 0, blockSize);
  } else if (type === 1) {
    for (let index = 0; index < blockSize; index += 1) out[index] = read.readSigned(width);
  } else if (type >= 8 && type <= 12) {
    const order = type - 8;
    for (let index = 0; index < order; index += 1) out[index] = read.readSigned(width);
    readResidual(read, blockSize, order, out);
    for (let index = order; index < blockSize; index += 1) {
      const r = out[index];
      switch (order) {
        case 0: break;
        case 1: out[index] = r + out[index - 1]; break;
        case 2: out[index] = r + 2 * out[index - 1] - out[index - 2]; break;
        case 3: out[index] = r + 3 * out[index - 1] - 3 * out[index - 2] + out[index - 3]; break;
        default: out[index] = r + 4 * out[index - 1] - 6 * out[index - 2] + 4 * out[index - 3] - out[index - 4];
      }
    }
  } else if (type >= 32) {
    throw new Error('This reader does not decode LPC subframes; SelectaDJ never writes them.');
  } else {
    throw new Error('A subframe uses a reserved type.');
  }
  if (wasted > 0) for (let index = 0; index < blockSize; index += 1) out[index] *= 2 ** wasted;
}

export type FlacFrame = { number: number; blockSize: number; channels: Int32Array[] };

/** Walks the frames of one FLAC stream, checking every CRC as it goes. */
export class FlacReader {
  readonly info: FlacStreamInfo;
  private at: number;
  private nextNumber = 0;

  constructor(private readonly bytes: Uint8Array) {
    const { info, audioStart } = readStreamInfo(bytes);
    if (info.sampleRate === 0) throw new Error('STREAMINFO gives no sample rate.');
    this.info = info;
    this.at = audioStart;
  }

  get done(): boolean {
    return this.at >= this.bytes.length;
  }

  next(): FlacFrame | null {
    if (this.done) return null;
    const start = this.at;
    const read = new BitReader(this.bytes, start);
    if (read.readBits(15) !== 0x7ffc) throw new Error(`Frame ${this.nextNumber} has no sync code.`);
    if (read.readBits(1) !== 0) throw new Error('Variable block size streams are not made here.');
    const sizeCode = read.readBits(4);
    const rateCode = read.readBits(4);
    const assignment = read.readBits(4);
    const bitsCode = read.readBits(3);
    if (read.readBits(1) !== 0) throw new Error('A frame header has a reserved bit set.');
    const number = readCodedNumber(read);
    let blockSize: number;
    if (sizeCode === 1) blockSize = 192;
    else if (sizeCode >= 2 && sizeCode <= 5) blockSize = 576 * 2 ** (sizeCode - 2);
    else if (sizeCode === 6) blockSize = read.readBits(8) + 1;
    else if (sizeCode === 7) blockSize = read.readBits(16) + 1;
    else if (sizeCode >= 8) blockSize = 256 * 2 ** (sizeCode - 8);
    else throw new Error('A frame header uses a reserved block size.');
    let sampleRate = this.info.sampleRate;
    if (rateCode >= 1 && rateCode <= 11) sampleRate = RATES[rateCode];
    else if (rateCode === 12) sampleRate = read.readBits(8) * 1000;
    else if (rateCode === 13) sampleRate = read.readBits(16);
    else if (rateCode === 14) sampleRate = read.readBits(16) * 10;
    else if (rateCode === 15) throw new Error('A frame header uses an invalid sample rate.');
    if (sampleRate !== this.info.sampleRate) throw new Error('A frame changes the sample rate.');
    const bits = bitsCode === 0 ? this.info.bits : SIZES[bitsCode];
    if (!bits || bits !== this.info.bits) throw new Error('A frame changes the bit depth.');
    const headerEnd = read.bytePosition;
    if (read.readBits(8) !== crc8(this.bytes, start, headerEnd)) throw new Error(`Frame ${number} fails its header CRC-8.`);
    if (number !== this.nextNumber) throw new Error(`Frame ${this.nextNumber} is missing; found frame ${number}.`);

    const channelCount = assignment <= 7 ? assignment + 1 : 2;
    if (assignment > 10) throw new Error('A frame uses a reserved channel assignment.');
    if (channelCount !== this.info.channels) throw new Error('A frame changes the channel count.');
    const channels = Array.from({ length: channelCount }, () => new Int32Array(blockSize));
    for (let channel = 0; channel < channelCount; channel += 1) {
      const isSide = (assignment === 8 && channel === 1) || (assignment === 9 && channel === 0) || (assignment === 10 && channel === 1);
      readSubframe(read, blockSize, bits + (isSide ? 1 : 0), channels[channel]);
    }
    read.alignToByte();
    const bodyEnd = read.bytePosition;
    if (read.readBits(16) !== crc16(this.bytes, start, bodyEnd)) throw new Error(`Frame ${number} fails its CRC-16.`);
    this.at = read.bytePosition;

    if (assignment >= 8) {
      const [a, b] = channels;
      for (let index = 0; index < blockSize; index += 1) {
        if (assignment === 8) {
          b[index] = a[index] - b[index]; // left, side -> right
        } else if (assignment === 9) {
          a[index] = a[index] + b[index]; // side, right -> left
        } else {
          const side = b[index];
          const mid = a[index] * 2 + (side & 1);
          a[index] = (mid + side) >> 1;
          b[index] = (mid - side) >> 1;
        }
      }
    }
    this.nextNumber += 1;
    return { number, blockSize, channels };
  }
}

function pcmBytes(frame: FlacFrame, bits: number, into: Uint8Array): Uint8Array {
  const bytesPerSample = Math.ceil(bits / 8);
  const size = frame.blockSize * frame.channels.length * bytesPerSample;
  const out = into.length >= size ? into : new Uint8Array(size);
  let at = 0;
  for (let index = 0; index < frame.blockSize; index += 1) {
    for (const channel of frame.channels) {
      const value = channel[index];
      for (let byte = 0; byte < bytesPerSample; byte += 1) out[at++] = (value >> (8 * byte)) & 0xff;
    }
  }
  return out.subarray(0, size);
}

/** Decode a whole file to integer samples per channel (tests and small files). */
export function decodeFlac(bytes: Uint8Array): { info: FlacStreamInfo; channels: Int32Array[]; md5: string } {
  const reader = new FlacReader(bytes);
  const { info } = reader;
  const channels = Array.from({ length: info.channels }, () => new Int32Array(info.totalSamples));
  const digest = md5.create();
  let buffer: Uint8Array = new Uint8Array(0);
  let at = 0;
  for (let frame = reader.next(); frame; frame = reader.next()) {
    if (at + frame.blockSize > info.totalSamples) throw new Error('The file holds more samples than STREAMINFO says.');
    frame.channels.forEach((channel, index) => channels[index].set(channel, at));
    at += frame.blockSize;
    buffer = pcmBytes(frame, info.bits, buffer);
    digest.update(buffer);
  }
  if (at !== info.totalSamples) throw new Error('The file holds fewer samples than STREAMINFO says.');
  return { info, channels, md5: bytesToHex(digest.digest()) };
}

/** Re-read a finished FLAC end to end and check it, yielding between slices so a long mix does
 * not freeze the page. Never throws: problems come back as reasons. */
export async function validateFlac(
  bytes: Uint8Array,
  expected?: { durationSeconds: number; toleranceSeconds?: number },
  options: { signal?: AbortSignal; yieldToLoop?: () => Promise<void> } = {},
): Promise<FlacDetails | FlacProblem> {
  const yieldToLoop = options.yieldToLoop ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  try {
    const reader = new FlacReader(bytes);
    const { info } = reader;
    if (info.bits !== 16 && info.bits !== 24) return { ok: false, reason: `Unexpected bit depth ${info.bits}.` };
    const digest = md5.create();
    let buffer: Uint8Array = new Uint8Array(0);
    let samples = 0;
    let frames = 0;
    for (let frame = reader.next(); frame; frame = reader.next()) {
      samples += frame.blockSize;
      frames += 1;
      if (frame.blockSize > info.maxBlockSize) return { ok: false, reason: 'A frame is larger than STREAMINFO allows.' };
      buffer = pcmBytes(frame, info.bits, buffer);
      digest.update(buffer);
      if (frames % 64 === 0) {
        if (options.signal?.aborted) return { ok: false, reason: 'The check was cancelled.' };
        await yieldToLoop();
      }
    }
    if (samples !== info.totalSamples) return { ok: false, reason: `The file holds ${samples} samples, not the ${info.totalSamples} it states.` };
    const sum = bytesToHex(digest.digest());
    if (sum !== info.md5) return { ok: false, reason: 'The decoded audio does not match the MD5 stored in the file.' };
    const durationSeconds = samples / info.sampleRate;
    if (expected) {
      const tolerance = expected.toleranceSeconds ?? 0.05;
      if (Math.abs(durationSeconds - expected.durationSeconds) > tolerance) {
        return { ok: false, reason: `The file lasts ${durationSeconds.toFixed(2)} s, not the expected ${expected.durationSeconds.toFixed(2)} s.` };
      }
    }
    return { ok: true, sampleRate: info.sampleRate, channels: info.channels, bits: info.bits, durationSeconds, totalSamples: samples, frames, md5: sum };
  } catch (error) {
    return { ok: false, reason: (error as Error | null)?.message || 'The file could not be read.' };
  }
}
