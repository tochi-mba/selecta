// Canonical track identity (ADR-0458, BF-0458-02).
//
// A track's identity is its content hash plus normalised metadata, computed locally. The same
// file imported on two devices resolves to one catalogue entry; two encodings of the same song
// hash differently and stay distinct. Identity never includes a raw path: paths differ per
// device, leak private structure, and break the moment a file moves. `assertNoPath` is run on
// every payload before it leaves the device, so a path can never ride along by accident.

import { breathe } from './breathe';

export type TrackIdentity = {
  content_sha256: string;
  title: string;
  artist: string;
  album?: string;
  duration_s?: number;
};

/** Files are hashed in slices this large, so a 100 MB file never sits in memory whole. */
export const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

/** A file up to this size is hashed by WebCrypto in one call. The JavaScript hash below costs about
 * 40 ms of the page's own time per megabyte on a slow laptop, so an import of thousands of songs
 * kept the page too busy to answer; WebCrypto hashes off the page in native code instead. Bigger
 * files keep the streamed hash, so a long WAV never sits in memory whole. */
export const WHOLE_DIGEST_MAX_BYTES = 64 * 1024 * 1024;
/** The streamed hash works in pieces this large (about 10 ms each) and hands the page back
 * between them, so even a very large file never holds the page for long. */
const UPDATE_SLICE_BYTES = 256 * 1024;

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The SHA-256 of a file's bytes, by WebCrypto where it exists and the file is not huge, else
 * streamed in slices. Both give the same digest; only where the work happens differs.
 * The streamed hash is loaded lazily, as the upload path does: nobody pays for it before an import. */
export async function fileSha256(file: Blob, options: { signal?: AbortSignal; chunkSize?: number } = {}): Promise<string> {
  const cancelled = () => {
    if (options.signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  };
  cancelled();
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  // a caller naming its own slice size asks for the streamed hash itself
  if (options.chunkSize === undefined && file.size <= WHOLE_DIGEST_MAX_BYTES && subtle?.digest) {
    let digest: ArrayBuffer | null = null;
    try {
      digest = await subtle.digest('SHA-256', await file.arrayBuffer());
    } catch {
      // a WebCrypto that refuses these bytes: the streamed hash below gives the same answer
    }
    cancelled();
    if (digest) return hex(new Uint8Array(digest));
  }
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const chunkSize = options.chunkSize ?? HASH_CHUNK_BYTES;
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    cancelled();
    const chunk = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
    for (let at = 0; at < chunk.length; at += UPDATE_SLICE_BYTES) {
      if (at > 0) await breathe();
      hash.update(chunk.subarray(at, at + UPDATE_SLICE_BYTES));
    }
  }
  return hex(hash.digest());
}

/** Normalised display metadata: trimmed, inner whitespace collapsed, case kept as written.
 * Case stays because "MF DOOM" and "Mf Doom" are a display choice, not two artists; the content
 * hash carries the identity either way. An empty album is omitted, not sent as ''. */
export function normalise(tagLike: { title?: string | null; artist?: string | null; album?: string | null }): { title: string; artist: string; album?: string } {
  const clean = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
  const title = clean(tagLike.title);
  const artist = clean(tagLike.artist);
  const album = clean(tagLike.album);
  return album ? { title, artist, album } : { title, artist };
}

/** Key names that would smuggle a local path into a payload. Checked case-insensitively. */
const PATH_KEYS = new Set([
  'path', 'paths', 'pathname', 'filepath', 'file_path', 'fullpath', 'full_path',
  'webkitrelativepath', 'relativepath', 'relative_path', 'directory', 'dir', 'folder',
]);

/** Walks a payload and throws if any key could carry a local path (ADR-0458: raw paths are
 * rejected outright; Cloud never sees them). Run before every request, cheap enough to keep on
 * in production. */
export function assertNoPath(payload: unknown, at = 'payload'): void {
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => assertNoPath(item, `${at}[${index}]`));
    return;
  }
  if (payload && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const compact = key.toLowerCase().replace(/[^a-z]/g, '');
      if (
        PATH_KEYS.has(key.toLowerCase())
        || compact.includes('path')
        || compact.includes('directory')
        || compact.includes('folder')
      ) {
        throw new Error(`A local path must never leave this device: found "${key}" at ${at}`);
      }
      assertNoPath(value, `${at}.${key}`);
    }
  }
}

/** The SHA-256 of bytes already in memory, without freezing the page: WebCrypto digests off the
 * main thread where it exists; otherwise the bytes are hashed in slices, yielding between them,
 * so a long WAV checked at play time never stalls a fade. */
export async function bytesSha256(bytes: ArrayBuffer): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (subtle?.digest) {
    try {
      const digest = await subtle.digest('SHA-256', bytes);
      return hex(new Uint8Array(digest));
    } catch {
      // fall through to the sliced hash
    }
  }
  return fileSha256(new Blob([bytes]), { chunkSize: HASH_CHUNK_BYTES });
}
