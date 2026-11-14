/** Shared bounded binary helpers; all output is losslessly preserved as local bytes. */
export interface ByteSink { write(bytes: Uint8Array): Promise<void> }
export function pcm16(sample: number): number {
  if (!Number.isFinite(sample)) throw new Error('Non-finite PCM');
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}
export function writePcm16Interleaved(channels: readonly Float32Array[]): Uint8Array {
  if (!channels.length || channels.length > 2) throw new Error('Unsupported PCM channels');
  const frames = channels[0].length;
  if (channels.some(c => c.length !== frames)) throw new Error('Unaligned PCM channels');
  const data = new Uint8Array(frames * channels.length * 2);
  const view = new DataView(data.buffer);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels.length; c++) {
    view.setInt16((i * channels.length + c) * 2, pcm16(channels[c][i]), true);
  }
  return data;
}
export function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 255 : (crc << 1) & 255;
  }
  return crc;
}
export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x8005) & 65535 : (crc << 1) & 65535;
  }
  return crc;
}
export function crc32(bytes: Uint8Array, starting = 0): number {
  let crc = (starting ^ 0xffffffff) >>> 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function crc32Blob(blob: Blob, chunkBytes = 65536): Promise<number> {
  let crc = 0;
  for (let pos = 0; pos < blob.size; pos += chunkBytes) {
    crc = crc32(new Uint8Array(await blob.slice(pos, pos + chunkBytes).arrayBuffer()), crc);
  }
  return crc;
}
