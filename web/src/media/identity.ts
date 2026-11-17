// Canonical track identity (ADR-0458, BF-0458-02).
//
// A track's identity is its content hash plus normalised metadata, computed locally. The same
// file imported on two devices resolves to one catalogue entry; two encodings of the same song
// hash differently and stay distinct. Identity never includes a raw path: paths differ per
// device, leak private structure, and break the moment a file moves. `assertNoPath` is run on
// every payload before it leaves the device, so a path can never ride along by accident.

export type TrackIdentity = {
  content_sha256: string;
  title: string;
  artist: string;
  album?: string;
  duration_s?: number;
};

/** Files are hashed in slices this large, so a 100 MB file never sits in memory whole. */
export const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

/** The SHA-256 of a file's bytes, streamed in slices.
 * The hash is loaded lazily, as the upload path does: nobody pays for it before an import. */
export async function fileSha256(file: Blob, options: { signal?: AbortSignal; chunkSize?: number } = {}): Promise<string> {
  const cancelled = () => {
    if (options.signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  };
  cancelled();
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const chunkSize = options.chunkSize ?? HASH_CHUNK_BYTES;
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    cancelled();
    hash.update(new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer()));
  }
  return Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
      if (PATH_KEYS.has(key.toLowerCase())) throw new Error(`A local path must never leave this device: found "${key}" at ${at}`);
      assertNoPath(value, `${at}.${key}`);
    }
  }
}
