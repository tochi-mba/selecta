import { type ByteSink, crc32, crc32Blob, writePcm16Interleaved } from './pcm';

export const WAV_MAX_PCM_BYTES = 0xffffffff - 36;
export function wavExpectedBytes(frames: number, channels: number): number {
  if (!Number.isSafeInteger(frames) || frames < 1 || ![1, 2].includes(channels)) throw new Error('Invalid WAV length');
  const bytes = frames * channels * 2;
  if (!Number.isSafeInteger(bytes) || bytes > WAV_MAX_PCM_BYTES) throw new Error('WAV exceeds RIFF 4 GiB limit; split the mix');
  return bytes;
}
export function wavHeader(frames: number, channels: number, rate: number): Uint8Array {
  const pcmBytes = wavExpectedBytes(frames, channels);
  if (!Number.isSafeInteger(rate) || rate < 8000 || rate > 192000) throw new Error('Invalid WAV sample rate');
  const data = new Uint8Array(44);
  const view = new DataView(data.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) data[offset + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + pcmBytes, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcmBytes, true);
  return data;
}
export class WavWriter {
  readonly format = 'wav' as const;
  private framesWritten = 0;
  private checksum = 0;
  private constructor(private sink: ByteSink, readonly totalFrames: number, readonly channels: 1 | 2, readonly rate: number, readonly expectedBytes: number) {}
  static async open(sink: ByteSink, frames: number, channels: 1 | 2, rate: number): Promise<WavWriter> {
    const header = wavHeader(frames, channels, rate);
    await sink.write(header);
    const writer = new WavWriter(sink, frames, channels, rate, 44 + wavExpectedBytes(frames, channels));
    writer.checksum = crc32(header);
    return writer;
  }
  async push(channels: readonly Float32Array[]): Promise<void> {
    if (channels.length !== this.channels || this.framesWritten + channels[0].length > this.totalFrames) throw new Error('Unexpected PCM stream length');
    const bytes = writePcm16Interleaved(channels);
    await this.sink.write(bytes);
    this.framesWritten += channels[0].length;
    this.checksum = crc32(bytes, this.checksum);
  }
  finish(): { expectedBytes: number; crc32: number; frames: number } {
    if (this.framesWritten !== this.totalFrames) throw new Error('Truncated WAV source');
    return { expectedBytes: this.expectedBytes, crc32: this.checksum, frames: this.framesWritten };
  }
}
export async function validateWav(blob: Blob, frames: number, channels: 1 | 2, rate: number, checksum?: number): Promise<void> {
  if (blob.size !== 44 + wavExpectedBytes(frames, channels)) throw new Error('WAV file truncated or overlong');
  const head = new Uint8Array(await blob.slice(0, 44).arrayBuffer());
  if (head.some((v, i) => v !== wavHeader(frames, channels, rate)[i])) throw new Error('WAV header invalid');
  if (checksum !== undefined && await crc32Blob(blob) !== checksum) throw new Error('WAV checksum mismatch');
}
