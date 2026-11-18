import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** WAV encoding and validation for local export (ADR-0457, BF-0457-06).
 *
 * The encoder takes rendered PCM chunks (render.ts output, or anything with the same shape) and
 * writes one RIFF file in 16-bit or 24-bit PCM, with a sha256 checksum computed before anyone is
 * told the file exists. validateWav re-reads the finished bytes, so what is offered for download
 * was checked, not assumed. FLAC is written by flac.ts, a plain TypeScript encoder (WebCodecs
 * AudioEncoder does not produce FLAC), and checked by flacDecode.ts.
 */

export type WavBits = 16 | 24;

/** The slice of AudioBuffer the encoder reads; fakes in tests satisfy it too. */
export type PcmChunk = {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
};

export type EncodedWav = {
  bytes: Uint8Array;
  /** Hex sha256 of the whole file, computed before success is reported. */
  sha256: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bits: WavBits;
};

export type WavDetails = {
  ok: true;
  sampleRate: number;
  channels: number;
  bits: number;
  durationSeconds: number;
  dataBytes: number;
};
export type WavProblem = { ok: false; reason: string };

const HEADER_BYTES = 44;

const writeAscii = (view: DataView, at: number, text: string) => {
  for (let index = 0; index < text.length; index += 1) view.setUint8(at + index, text.charCodeAt(index));
};

const readAscii = (view: DataView, at: number, length: number): string => {
  let text = '';
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(view.getUint8(at + index));
  return text;
};

export function encodeWav(chunks: PcmChunk[], bits: WavBits = 16): EncodedWav {
  if (chunks.length === 0) throw new Error('There is no audio to encode.');
  const sampleRate = chunks[0].sampleRate;
  const channels = chunks[0].numberOfChannels;
  for (const chunk of chunks) {
    if (chunk.sampleRate !== sampleRate || chunk.numberOfChannels !== channels) {
      throw new Error('Every chunk must share one sample rate and channel count.');
    }
  }
  const frames = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytesPerSample = bits / 8;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  // RIFF sizes are 32-bit: a longer file would wrap its header and read back as garbage.
  if (HEADER_BYTES - 8 + dataBytes > 0xffffffff) throw new Error('The mix is too long for one WAV file.');
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let at = HEADER_BYTES;
  for (const chunk of chunks) {
    const data: Float32Array[] = [];
    for (let channel = 0; channel < channels; channel += 1) data.push(chunk.getChannelData(channel));
    for (let frame = 0; frame < chunk.length; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, data[channel][frame]));
        if (bits === 16) {
          view.setInt16(at, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
          at += 2;
        } else {
          const whole = Math.round(sample < 0 ? sample * 8388608 : sample * 8388607);
          view.setUint8(at, whole & 0xff);
          view.setUint8(at + 1, (whole >> 8) & 0xff);
          view.setUint8(at + 2, (whole >> 16) & 0xff);
          at += 3;
        }
      }
    }
  }

  return {
    bytes,
    sha256: bytesToHex(sha256(bytes)),
    durationSeconds: frames / sampleRate,
    sampleRate,
    channels,
    bits,
  };
}

/** Re-read a finished WAV: header, chunk walk, size consistency and (optionally) duration. */
export function validateWav(
  bytes: Uint8Array,
  expected?: { durationSeconds: number; toleranceSeconds?: number },
): WavDetails | WavProblem {
  if (bytes.length < HEADER_BYTES) return { ok: false, reason: 'The file is too short to be a WAV.' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF') return { ok: false, reason: 'The file is missing its RIFF header.' };
  if (readAscii(view, 8, 4) !== 'WAVE') return { ok: false, reason: 'The file is not a WAVE file.' };
  if (view.getUint32(4, true) !== bytes.length - 8) return { ok: false, reason: 'The RIFF size does not match the file.' };

  let at = 12;
  let format: { channels: number; sampleRate: number; bits: number; blockAlign: number } | null = null;
  let dataBytes: number | null = null;
  while (at + 8 <= bytes.length) {
    const id = readAscii(view, at, 4);
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > bytes.length) return { ok: false, reason: `The ${id.trim()} chunk runs past the end of the file.` };
    if (id === 'fmt ') {
      if (size < 16) return { ok: false, reason: 'The format chunk is too short.' };
      if (view.getUint16(at + 8, true) !== 1) return { ok: false, reason: 'Only PCM WAV files are made here.' };
      format = {
        channels: view.getUint16(at + 10, true),
        sampleRate: view.getUint32(at + 12, true),
        blockAlign: view.getUint16(at + 20, true),
        bits: view.getUint16(at + 22, true),
      };
    }
    if (id === 'data') dataBytes = size;
    at += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!format) return { ok: false, reason: 'The file has no format chunk.' };
  if (dataBytes === null) return { ok: false, reason: 'The file has no data chunk.' };
  if (format.bits !== 16 && format.bits !== 24) return { ok: false, reason: `Unexpected bit depth ${format.bits}.` };
  if (format.blockAlign !== format.channels * (format.bits / 8)) return { ok: false, reason: 'The block alignment does not match the format.' };
  if (format.sampleRate <= 0 || format.channels <= 0) return { ok: false, reason: 'The format chunk makes no sense.' };
  if (dataBytes % format.blockAlign !== 0) return { ok: false, reason: 'The audio data is not whole frames.' };

  const durationSeconds = dataBytes / format.blockAlign / format.sampleRate;
  if (expected) {
    const tolerance = expected.toleranceSeconds ?? 0.05;
    if (Math.abs(durationSeconds - expected.durationSeconds) > tolerance) {
      return { ok: false, reason: `The file lasts ${durationSeconds.toFixed(2)} s, not the expected ${expected.durationSeconds.toFixed(2)} s.` };
    }
  }
  return { ok: true, sampleRate: format.sampleRate, channels: format.channels, bits: format.bits, durationSeconds, dataBytes };
}

/** FLAC lives in flac.ts now; re-exported here so existing imports keep the true answer. */
export { flacSupported } from './flac';
