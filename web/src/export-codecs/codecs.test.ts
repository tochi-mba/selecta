import { describe, expect, it } from 'vitest';
import { type ByteSink } from './pcm';
import { WavWriter, validateWav } from './wav';
import { FlacWriter, validateFlac } from './flac';
class Sink implements ByteSink {
  chunks: Uint8Array[] = [];
  async write(bytes: Uint8Array) { this.chunks.push(bytes.slice()); }
  blob() { return new Blob(this.chunks.map(b => b.slice().buffer)); }
}
describe('genuine local PCM formats', () => {
  it('encodes, validates and detects truncated WAV', async () => {
    const sink = new Sink();
    const writer = await WavWriter.open(sink, 1001, 2, 44100);
    await writer.push([new Float32Array(600).fill(0.5), new Float32Array(600).fill(-0.5)]);
    await writer.push([new Float32Array(401), new Float32Array(401)]);
    const result = writer.finish();
    const blob = sink.blob();
    expect(blob.size).toBe(44 + 1001 * 4);
    await validateWav(blob, 1001, 2, 44100, result.crc32);
    await expect(validateWav(blob.slice(0, -1), 1001, 2, 44100)).rejects.toThrow();
  });
  it('writes FLAC magic, STREAMINFO and verified lossless verbatim frames', async () => {
    const sink = new Sink();
    const writer = await FlacWriter.open(sink, 8193, 1, 48000);
    await writer.push([Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 100))]);
    await writer.push([Float32Array.from({ length: 3193 }, (_, i) => Math.sin((i + 5000) / 100))]);
    const result = await writer.finish();
    const blob = sink.blob();
    expect(new TextDecoder().decode(await blob.slice(0, 4).arrayBuffer())).toBe('fLaC');
    await validateFlac(blob, 8193, 1, 48000, result.crc32);
    const corrupted = new Uint8Array(await blob.arrayBuffer());
    corrupted[100] ^= 1;
    await expect(validateFlac(new Blob([corrupted]), 8193, 1, 48000)).rejects.toThrow(/CRC|checksum/);
  });
  it('does not accept a WAV renamed to FLAC', async () => {
    const wav = new Sink();
    const writer = await WavWriter.open(wav, 64, 1, 44100);
    await writer.push([new Float32Array(64)]); writer.finish();
    await expect(validateFlac(wav.blob(), 64, 1, 44100)).rejects.toThrow();
  });
  it('rejects unsafe WAV >4GiB and FLAC impossible header counts', async () => {
    expect(() => WavWriter.open(new Sink(), 0x80000000, 2, 44100)).not.toThrow(); // asynchronous validation
    await expect(WavWriter.open(new Sink(), 0x80000000, 2, 44100)).rejects.toThrow(/4 GiB/);
    await expect(FlacWriter.open(new Sink(), 5, 1, 44100)).rejects.toThrow(/duration/);
  });
});
