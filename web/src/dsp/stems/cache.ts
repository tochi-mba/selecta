/** Stem windows in the derived OPFS cache (media/store.ts cacheWrite/cacheRead/cacheEvict).
 *
 * Key: `stems-v1-<id>-<implementation>-<startMs>-<endMs>-44100`, where <id> is the song's content
 * hash when `cloud.content_cache` sharing is on and the hash is well formed, else
 * `<workspace>:<songId>` (ADR-0469 scoping, as cachedBytesKey). A new splitter implementation
 * changes the key, so stems from an older splitter are never served as the new one's.
 *
 * Encoding (little endian): magic 'STM1', u32 sampleRate, u32 frames, u8 planes, u8 format
 * (1 = int16), u16 reserved, then one f32 peak per plane, then the planes as int16 scaled by
 * their own peak. 16-bit halves the storage of float and is transparent for mixing.
 */

import { cacheEvict, cacheRead, cacheWrite, type CacheScope, type CacheWriteResult } from '../../media/store';
import { STEM_MODEL, type StemName } from './model';
import type { StemSongRef, StemWindow } from './windows';

const SHA256 = /^[0-9a-f]{64}$/;
const MAGIC = 0x314d5453; // 'STM1'
const HEADER_BYTES = 16;
const FORMAT_INT16 = 1;
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function stemCacheKey(
  song: Pick<StemSongRef, 'songId' | 'contentSha256'>,
  window: Pick<StemWindow, 'startMs' | 'endMs'>,
  scope: CacheScope,
  implementation = STEM_MODEL.implementation,
): string {
  const sha = song.contentSha256 ?? '';
  const id = scope.shared && SHA256.test(sha) ? sha : `${scope.workspaceId}:${song.songId}`;
  return `stems-v1-${id}-${implementation}-${window.startMs}-${window.endMs}-${STEM_MODEL.sampleRate}`;
}

export function encodeStems(planes: Float32Array[], sampleRate: number): Uint8Array {
  const frames = planes[0]?.length ?? 0;
  if (planes.some((plane) => plane.length !== frames)) throw new Error('Every stem channel must be the same length.');
  if (planes.length > 255) throw new Error('Too many stem channels.');
  const bytes = new Uint8Array(HEADER_BYTES + planes.length * 4 + planes.length * frames * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, sampleRate, true);
  view.setUint32(8, frames, true);
  view.setUint8(12, planes.length);
  view.setUint8(13, FORMAT_INT16);
  let offset = HEADER_BYTES;
  const peaks = planes.map((plane) => {
    let peak = 0;
    for (let index = 0; index < plane.length; index += 1) {
      const value = Math.abs(plane[index]);
      if (value > peak && Number.isFinite(value)) peak = value;
    }
    return peak;
  });
  for (const peak of peaks) {
    view.setFloat32(offset, peak, true);
    offset += 4;
  }
  planes.forEach((plane, index) => {
    const scale = peaks[index] > 0 ? 32767 / peaks[index] : 0;
    const samples = LITTLE_ENDIAN ? new Int16Array(bytes.buffer, offset, frames) : null;
    for (let frame = 0; frame < frames; frame += 1) {
      const value = Number.isFinite(plane[frame]) ? plane[frame] : 0;
      const quantised = Math.max(-32767, Math.min(32767, Math.round(value * scale)));
      if (samples) samples[frame] = quantised;
      else view.setInt16(offset + frame * 2, quantised, true);
    }
    offset += frames * 2;
  });
  return bytes;
}

export interface DecodedStems {
  sampleRate: number;
  planes: Float32Array[];
}

/** Decode, or null for anything that is not a well-formed entry (treated as a miss). */
export function decodeStems(buffer: ArrayBuffer): DecodedStems | null {
  if (buffer.byteLength < HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC || view.getUint8(13) !== FORMAT_INT16) return null;
  const sampleRate = view.getUint32(4, true);
  const frames = view.getUint32(8, true);
  const count = view.getUint8(12);
  if (buffer.byteLength !== HEADER_BYTES + count * 4 + count * frames * 2) return null;
  let offset = HEADER_BYTES;
  const peaks: number[] = [];
  for (let index = 0; index < count; index += 1) {
    peaks.push(view.getFloat32(offset, true));
    offset += 4;
  }
  const planes = peaks.map((peak) => {
    const plane = new Float32Array(frames);
    const scale = peak / 32767;
    const samples = LITTLE_ENDIAN ? new Int16Array(buffer, offset, frames) : null;
    for (let frame = 0; frame < frames; frame += 1) {
      plane[frame] = (samples ? samples[frame] : view.getInt16(offset + frame * 2, true)) * scale;
    }
    offset += frames * 2;
    return plane;
  });
  return { sampleRate, planes };
}

/** One separated window, ready for the seam provider. */
export interface StemSet {
  implementation: string;
  sampleRate: number;
  startMs: number;
  endMs: number;
  /** Stereo channels per stem. */
  stems: Record<StemName, [Float32Array, Float32Array]>;
}

export function toStemSet(planes: Float32Array[], sampleRate: number, window: Pick<StemWindow, 'startMs' | 'endMs'>, implementation = STEM_MODEL.implementation): StemSet | null {
  if (planes.length !== STEM_MODEL.stems.length * 2) return null;
  const stems = {} as Record<StemName, [Float32Array, Float32Array]>;
  STEM_MODEL.stems.forEach((name, index) => {
    stems[name] = [planes[index * 2], planes[index * 2 + 1]];
  });
  return { implementation, sampleRate, startMs: window.startMs, endMs: window.endMs, stems };
}

export interface StemCacheIo {
  write: (key: string, bytes: Uint8Array) => Promise<CacheWriteResult>;
  read: (key: string) => Promise<ArrayBuffer | null>;
  evict: (key: string) => Promise<void>;
}

export const defaultStemCacheIo: StemCacheIo = { write: cacheWrite, read: cacheRead, evict: cacheEvict };

export async function writeStemWindow(
  song: Pick<StemSongRef, 'songId' | 'contentSha256'>,
  window: Pick<StemWindow, 'startMs' | 'endMs'>,
  scope: CacheScope,
  planes: Float32Array[],
  io: StemCacheIo = defaultStemCacheIo,
): Promise<CacheWriteResult> {
  return io.write(stemCacheKey(song, window, scope), encodeStems(planes, STEM_MODEL.sampleRate));
}

/** Cache read only: never separates. A malformed entry is evicted and reported as a miss. */
export async function readStemWindow(
  song: Pick<StemSongRef, 'songId' | 'contentSha256'>,
  window: Pick<StemWindow, 'startMs' | 'endMs'>,
  scope: CacheScope,
  io: StemCacheIo = defaultStemCacheIo,
): Promise<StemSet | null> {
  const key = stemCacheKey(song, window, scope);
  const bytes = await io.read(key);
  if (!bytes) return null;
  const decoded = decodeStems(bytes);
  const set = decoded && decoded.sampleRate === STEM_MODEL.sampleRate ? toStemSet(decoded.planes, decoded.sampleRate, window) : null;
  if (!set) await io.evict(key);
  return set;
}
