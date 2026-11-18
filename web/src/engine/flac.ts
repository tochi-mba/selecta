import { md5 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { BitWriter, crc16, crc8 } from './flacBits';
import type { PcmChunk } from './wav';

/** A lossless FLAC encoder in plain TypeScript (ADR-0457, BF-0457-06; behind cloud.local_export
 * at the caller).
 *
 * What it writes, per the FLAC format (RFC 9639): the `fLaC` marker, one STREAMINFO block with
 * the MD5 of the unencoded PCM, then fixed-blocksize frames. Each frame has a CRC-8 protected
 * header and a CRC-16 over the whole frame. Each channel becomes a CONSTANT subframe when every
 * sample is equal, otherwise the cheapest FIXED linear predictor of order 0 to 4 with
 * partitioned Rice coded residuals (RICE when every parameter fits 4 bits, RICE2 otherwise),
 * or VERBATIM when prediction would not save anything. Stereo frames pick the cheapest of
 * independent, left/side, right/side and mid/side. 16-bit and 24-bit only. No LPC, so files are
 * a little larger than libFLAC's, but every decoder reads them.
 *
 * Quantisation is the same as wav.ts encodeWav (clamp, then round against 32768/32767 or
 * 8388608/8388607), so a FLAC and a WAV export of one render hold identical samples.
 *
 * Long mixes never freeze the page: encodeFlac works in slices (at most 32 frames or about
 * 25 ms, whichever ends first), yields to the event loop between slices and between 1 MB
 * steps of the final sha256, checks its AbortSignal at every yield, and only returns bytes
 * once the whole stream, including STREAMINFO, is written. A cancel throws FlacCancelled and
 * leaves nothing behind.
 */

export type FlacBits = 16 | 24;

export const FLAC_IMPLEMENTATION = 'ts-flac-fixed-rice-v1';
export const FLAC_BLOCK_SIZE = 4096;
/** The largest Rice partition order tried (RFC 9639 allows 15; gains stop well before 8). */
const MAX_PARTITION_ORDER = 8;
/** At most this many frames (about 3 s of 44.1 kHz audio) between yields to the event loop. */
const FRAMES_PER_SLICE = 32;
/** A slice also ends once it has held the page this long, whatever the device's speed. */
const SLICE_BUDGET_MS = 25;
/** The finished file is hashed in steps of this size, yielding between them. */
const HASH_STEP_BYTES = 1 << 20;

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export type EncodedFlac = {
  bytes: Uint8Array;
  /** Hex sha256 of the whole file, computed before success is reported. */
  sha256: string;
  /** Hex MD5 of the unencoded PCM, as stored in STREAMINFO. */
  md5: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bits: FlacBits;
  totalSamples: number;
  frames: number;
  /** How each subframe was coded, so tests can prove every path is exercised. */
  subframes: { constant: number; verbatim: number; fixed: number };
};

export type EncodeFlacOptions = {
  signal?: AbortSignal;
  blockSize?: number;
  /** Called after every slice with the fraction of samples encoded. */
  onProgress?: (fraction: number) => void;
  /** Hands control back to the event loop between slices; a resolved promise in tests. */
  yieldToLoop?: () => Promise<void>;
};

export class FlacCancelled extends Error {
  constructor() {
    super('The FLAC encode was cancelled.');
    this.name = 'AbortError';
  }
}

/** FLAC is supported here: the encoder is part of the bundle. */
export function flacSupported(): { supported: true; implementation: string } {
  return { supported: true, implementation: FLAC_IMPLEMENTATION };
}

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The float-to-integer rule wav.ts uses, kept identical so both formats hold the same PCM. */
export function quantise(sample: number, bits: FlacBits): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  if (bits === 16) return Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767);
  return Math.round(clamped < 0 ? clamped * 8388608 : clamped * 8388607);
}

/** Reads integer blocks out of rendered chunks without ever holding the whole mix as integers. */
class BlockSource {
  private chunk = 0;
  private offset = 0;

  constructor(private readonly chunks: PcmChunk[], private readonly channels: number, private readonly bits: FlacBits) {}

  fill(into: Int32Array[], size: number): number {
    let filled = 0;
    while (filled < size && this.chunk < this.chunks.length) {
      const chunk = this.chunks[this.chunk];
      const take = Math.min(size - filled, chunk.length - this.offset);
      for (let channel = 0; channel < this.channels; channel += 1) {
        const data = chunk.getChannelData(channel);
        const out = into[channel];
        for (let index = 0; index < take; index += 1) out[filled + index] = quantise(data[this.offset + index], this.bits);
      }
      filled += take;
      this.offset += take;
      if (this.offset >= chunk.length) {
        this.chunk += 1;
        this.offset = 0;
      }
    }
    return filled;
  }
}

/** Fixed predictor residuals (RFC 9639 section 9.2.5), from sample `order` onwards. */
export function fixedResidual(samples: Int32Array, count: number, order: number, out: Float64Array): void {
  for (let index = order; index < count; index += 1) {
    const x = samples[index];
    let r: number;
    switch (order) {
      case 0: r = x; break;
      case 1: r = x - samples[index - 1]; break;
      case 2: r = x - 2 * samples[index - 1] + samples[index - 2]; break;
      case 3: r = x - 3 * samples[index - 1] + 3 * samples[index - 2] - samples[index - 3]; break;
      default: r = x - 4 * samples[index - 1] + 6 * samples[index - 2] - 4 * samples[index - 3] + samples[index - 4];
    }
    out[index - order] = r;
  }
}

const zigzag = (value: number) => (value >= 0 ? value * 2 : -value * 2 - 1);

type RicePlan = { partitionOrder: number; parameters: number[]; bits: number };

/** Best Rice parameter for a partition of `count` values whose zigzagged sum is `sum`, with its
 * estimated cost in bits. The estimate (count * (k + 1) + sum / 2^k) only steers the choice;
 * whatever is chosen is then written exactly, so an imperfect estimate costs size, never
 * correctness. */
function bestParameter(count: number, sum: number): { k: number; bits: number } {
  if (count === 0) return { k: 0, bits: 0 };
  const mean = sum / count;
  const guess = mean < 1 ? 0 : Math.min(30, Math.floor(Math.log2(mean)));
  let best = { k: guess, bits: Number.POSITIVE_INFINITY };
  for (let k = Math.max(0, guess - 1); k <= Math.min(30, guess + 1); k += 1) {
    const bits = count * (k + 1) + Math.floor(sum / 2 ** k);
    if (bits < best.bits) best = { k, bits };
  }
  return best;
}

/** Choose the partition order and parameters for one residual of blockSize - order values.
 * Sums are taken once at the finest partition order and merged upwards, so the whole search
 * costs one pass over the residual. */
function planRice(residual: Float64Array, blockSize: number, order: number, sums: Float64Array): RicePlan {
  const count = blockSize - order;
  let maxOrder = 0;
  while (
    maxOrder < MAX_PARTITION_ORDER
    && blockSize % (1 << (maxOrder + 1)) === 0
    && (blockSize >> (maxOrder + 1)) > order
  ) maxOrder += 1;
  const finest = 1 << maxOrder;
  const finestSpan = blockSize >> maxOrder;
  let at = 0;
  for (let partition = 0; partition < finest; partition += 1) {
    const end = partition === 0 ? finestSpan - order : at + finestSpan;
    let sum = 0;
    for (let index = at; index < end; index += 1) sum += zigzag(residual[index]);
    sums[partition] = sum;
    at = end;
  }
  if (at !== count) throw new Error('Rice partitions do not cover the residual.');
  let best: RicePlan | null = null;
  for (let partitionOrder = maxOrder; partitionOrder >= 0; partitionOrder -= 1) {
    const partitions = 1 << partitionOrder;
    const span = blockSize >> partitionOrder;
    if (partitionOrder < maxOrder) {
      for (let partition = 0; partition < partitions; partition += 1) sums[partition] = sums[2 * partition] + sums[2 * partition + 1];
    }
    const parameters: number[] = [];
    let bits = 0;
    for (let partition = 0; partition < partitions; partition += 1) {
      const chosen = bestParameter(partition === 0 ? span - order : span, sums[partition]);
      parameters.push(chosen.k);
      bits += chosen.bits;
    }
    const parameterBits = parameters.some((k) => k > 14) ? 5 : 4;
    bits += partitions * parameterBits + 2 + 4;
    if (!best || bits < best.bits) best = { partitionOrder, parameters, bits };
  }
  return best as RicePlan;
}

type SubframePlan =
  | { kind: 'constant'; bits: number }
  | { kind: 'verbatim'; bits: number }
  | { kind: 'fixed'; order: number; rice: RicePlan; bits: number };

const partitionSums = new Float64Array(1 << MAX_PARTITION_ORDER);

function planSubframe(samples: Int32Array, blockSize: number, bps: number, scratch: Float64Array): SubframePlan {
  let constant = true;
  for (let index = 1; index < blockSize; index += 1) {
    if (samples[index] !== samples[0]) {
      constant = false;
      break;
    }
  }
  if (constant) return { kind: 'constant', bits: 8 + bps };
  let best: SubframePlan = { kind: 'verbatim', bits: 8 + bps * blockSize };
  for (let order = 0; order <= 4 && order < blockSize; order += 1) {
    fixedResidual(samples, blockSize, order, scratch);
    const rice = planRice(scratch, blockSize, order, partitionSums);
    const bits = 8 + order * bps + rice.bits;
    if (bits < best.bits) best = { kind: 'fixed', order, rice, bits };
  }
  return best;
}

function writeSubframe(out: BitWriter, samples: Int32Array, blockSize: number, bps: number, plan: SubframePlan, scratch: Float64Array) {
  if (plan.kind === 'constant') {
    out.writeBits(0b00000000, 8);
    out.writeSigned(samples[0], bps);
    return;
  }
  if (plan.kind === 'verbatim') {
    out.writeBits(0b00000010, 8);
    for (let index = 0; index < blockSize; index += 1) out.writeSigned(samples[index], bps);
    return;
  }
  const { order, rice } = plan;
  out.writeBits(0, 1);
  out.writeBits(0b001000 | order, 6);
  out.writeBits(0, 1); // no wasted bits
  for (let index = 0; index < order; index += 1) out.writeSigned(samples[index], bps);
  fixedResidual(samples, blockSize, order, scratch);
  const wide = rice.parameters.some((k) => k > 14);
  out.writeBits(wide ? 1 : 0, 2);
  out.writeBits(rice.partitionOrder, 4);
  const span = blockSize >> rice.partitionOrder;
  let start = 0;
  rice.parameters.forEach((k, partition) => {
    const end = partition === 0 ? span - order : start + span;
    out.writeBits(k, wide ? 5 : 4);
    const scale = 2 ** k;
    for (let index = start; index < end; index += 1) {
      const value = zigzag(scratch[index]);
      out.writeUnary(Math.floor(value / scale));
      out.writeBits(value % scale, k);
    }
    start = end;
  });
}

/** The UTF-8 style frame number coding of RFC 9639 section 9.1.5. */
function writeCodedNumber(out: BitWriter, value: number) {
  if (value < 0x80) {
    out.writeBits(value, 8);
    return;
  }
  const limits = [0x800, 0x10000, 0x200000, 0x4000000, 0x80000000];
  const extra = limits.findIndex((limit) => value < limit) + 1;
  if (extra === 0) throw new Error('The mix has too many frames for one FLAC stream.');
  const lead = (0xff << (7 - extra)) & 0xff;
  out.writeBits(lead | Math.floor(value / 2 ** (6 * extra)), 8);
  for (let index = extra - 1; index >= 0; index -= 1) out.writeBits(0x80 | (Math.floor(value / 2 ** (6 * index)) & 0x3f), 8);
}

const SAMPLE_RATE_CODES: Record<number, number> = {
  88200: 0b0001, 176400: 0b0010, 192000: 0b0011, 8000: 0b0100, 16000: 0b0101, 22050: 0b0110,
  24000: 0b0111, 32000: 0b1000, 44100: 0b1001, 48000: 0b1010, 96000: 0b1011,
};

/** Channel assignment codes for stereo decorrelation (RFC 9639 section 9.1.3). */
const INDEPENDENT = -1;
const LEFT_SIDE = 0b1000;
const RIGHT_SIDE = 0b1001;
const MID_SIDE = 0b1010;

type Frame = { assignment: number; signals: Int32Array[]; widths: number[]; plans: SubframePlan[] };

function planFrame(block: Int32Array[], size: number, bits: number, mid: Int32Array, side: Int32Array, scratch: Float64Array): Frame {
  const independent = block.map((channel) => planSubframe(channel, size, bits, scratch));
  const independentFrame: Frame = { assignment: INDEPENDENT, signals: block, widths: block.map(() => bits), plans: independent };
  if (block.length !== 2) return independentFrame;
  const [left, right] = block;
  for (let index = 0; index < size; index += 1) {
    side[index] = left[index] - right[index];
    mid[index] = (left[index] + right[index]) >> 1;
  }
  const sidePlan = planSubframe(side, size, bits + 1, scratch);
  const midPlan = planSubframe(mid, size, bits, scratch);
  const options: Frame[] = [
    independentFrame,
    { assignment: LEFT_SIDE, signals: [left, side], widths: [bits, bits + 1], plans: [independent[0], sidePlan] },
    { assignment: RIGHT_SIDE, signals: [side, right], widths: [bits + 1, bits], plans: [sidePlan, independent[1]] },
    { assignment: MID_SIDE, signals: [mid, side], widths: [bits, bits + 1], plans: [midPlan, sidePlan] },
  ];
  const cost = (frame: Frame) => frame.plans.reduce((sum, plan) => sum + plan.bits, 0);
  return options.reduce((best, next) => (cost(next) < cost(best) ? next : best));
}

function writeStreamInfo(info: {
  blockSize: number; minFrame: number; maxFrame: number; sampleRate: number; channels: number;
  bits: number; totalSamples: number; md5: Uint8Array;
}): Uint8Array {
  const out = new BitWriter(64);
  out.writeBits(1, 1); // last metadata block
  out.writeBits(0, 7); // STREAMINFO
  out.writeBits(34, 24);
  out.writeBits(info.blockSize, 16);
  out.writeBits(info.blockSize, 16);
  out.writeBits(info.minFrame, 24);
  out.writeBits(info.maxFrame, 24);
  out.writeBits(info.sampleRate, 20);
  out.writeBits(info.channels - 1, 3);
  out.writeBits(info.bits - 1, 5);
  out.writeBits(Math.floor(info.totalSamples / 2 ** 32), 4);
  out.writeBits(info.totalSamples % 2 ** 32, 32);
  out.writeBytes(info.md5);
  return out.finish();
}

/** Encode rendered PCM chunks as one FLAC file. Throws FlacCancelled on abort and Error on bad
 * input; resolves only with a complete stream. */
export async function encodeFlac(chunks: PcmChunk[], bits: FlacBits = 16, options: EncodeFlacOptions = {}): Promise<EncodedFlac> {
  if (chunks.length === 0) throw new Error('There is no audio to encode.');
  if (bits !== 16 && bits !== 24) throw new Error('FLAC export writes 16-bit or 24-bit audio only.');
  const sampleRate = chunks[0].sampleRate;
  const channels = chunks[0].numberOfChannels;
  for (const chunk of chunks) {
    if (chunk.sampleRate !== sampleRate || chunk.numberOfChannels !== channels) {
      throw new Error('Every chunk must share one sample rate and channel count.');
    }
  }
  if (channels < 1 || channels > 8) throw new Error('FLAC holds one to eight channels.');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate >= 2 ** 20) throw new Error('The sample rate cannot be stored in FLAC.');
  const blockSize = options.blockSize ?? FLAC_BLOCK_SIZE;
  if (!Number.isInteger(blockSize) || blockSize < 16 || blockSize > 65535) throw new Error('The FLAC block size must be 16 to 65535.');
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalSamples === 0) throw new Error('There is no audio to encode.');
  const yieldToLoop = options.yieldToLoop ?? defaultYield;
  const checkCancel = () => {
    if (options.signal?.aborted) throw new FlacCancelled();
  };
  checkCancel();

  const out = new BitWriter(Math.min(1 << 26, Math.max(1 << 16, Math.ceil(totalSamples * channels * (bits / 8) * 0.7))));
  out.writeBytes(new Uint8Array([0x66, 0x4c, 0x61, 0x43])); // fLaC
  const infoAt = out.bytePosition;
  out.writeBytes(new Uint8Array(38)); // STREAMINFO, filled in at the end

  const source = new BlockSource(chunks, channels, bits);
  const block = Array.from({ length: channels }, () => new Int32Array(blockSize));
  const mid = new Int32Array(blockSize);
  const side = new Int32Array(blockSize);
  const scratch = new Float64Array(blockSize);
  const bytesPerSample = bits / 8;
  const pcm = new Uint8Array(blockSize * channels * bytesPerSample);
  const digest = md5.create();
  const rateCode = SAMPLE_RATE_CODES[sampleRate] ?? 0;
  const sizeCode = bits === 16 ? 0b100 : 0b110;
  const counts = { constant: 0, verbatim: 0, fixed: 0 };
  let minFrame = Number.POSITIVE_INFINITY;
  let maxFrame = 0;
  let frameNumber = 0;
  let encoded = 0;

  while (encoded < totalSamples) {
    const sliceStarted = clock();
    for (let slice = 0; slice < FRAMES_PER_SLICE && encoded < totalSamples && (slice === 0 || clock() - sliceStarted < SLICE_BUDGET_MS); slice += 1) {
      const size = source.fill(block, blockSize);
      if (size === 0) throw new Error('The audio ended before its stated length.');

      // MD5 of the unencoded audio: interleaved, little-endian, signed, whole bytes per sample.
      let at = 0;
      for (let index = 0; index < size; index += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const value = block[channel][index];
          pcm[at] = value & 0xff;
          pcm[at + 1] = (value >> 8) & 0xff;
          if (bytesPerSample === 3) pcm[at + 2] = (value >> 16) & 0xff;
          at += bytesPerSample;
        }
      }
      digest.update(pcm.subarray(0, at));

      const frame = planFrame(block, size, bits, mid, side, scratch);
      const start = out.bytePosition;
      out.writeBits(0xfff8, 16); // sync, reserved, fixed blocking
      out.writeBits(size === blockSize && blockSize === 4096 ? 0b1100 : 0b0111, 4);
      out.writeBits(rateCode, 4);
      out.writeBits(frame.assignment === INDEPENDENT ? channels - 1 : frame.assignment, 4);
      out.writeBits(sizeCode, 3);
      out.writeBits(0, 1);
      writeCodedNumber(out, frameNumber);
      if (!(size === blockSize && blockSize === 4096)) out.writeBits(size - 1, 16);
      out.writeBits(crc8(out.view(), start, out.bytePosition), 8);
      frame.plans.forEach((plan, channel) => {
        counts[plan.kind] += 1;
        writeSubframe(out, frame.signals[channel], size, frame.widths[channel], plan, scratch);
      });
      out.alignToByte();
      out.writeBits(crc16(out.view(), start, out.bytePosition), 16);
      const length = out.bytePosition - start;
      minFrame = Math.min(minFrame, length);
      maxFrame = Math.max(maxFrame, length);
      frameNumber += 1;
      encoded += size;
    }
    options.onProgress?.(encoded / totalSamples);
    checkCancel();
    if (encoded < totalSamples) {
      await yieldToLoop();
      checkCancel();
    }
  }

  const sum = digest.digest();
  out.patch(infoAt, writeStreamInfo({ blockSize, minFrame, maxFrame, sampleRate, channels, bits, totalSamples, md5: sum }));
  const bytes = out.finish();
  checkCancel();
  // A long mix is tens of megabytes: hash it in steps so the page keeps breathing.
  const fileHash = sha256.create();
  for (let at = 0; at < bytes.length; at += HASH_STEP_BYTES) {
    fileHash.update(bytes.subarray(at, at + HASH_STEP_BYTES));
    if (at + HASH_STEP_BYTES < bytes.length) {
      await yieldToLoop();
      checkCancel();
    }
  }
  checkCancel();
  return {
    bytes,
    sha256: bytesToHex(fileHash.digest()),
    md5: bytesToHex(sum),
    durationSeconds: totalSamples / sampleRate,
    sampleRate,
    channels,
    bits,
    totalSamples,
    frames: frameNumber,
    subframes: counts,
  };
}
