/** Only fetch signed-off, pinned, same-origin model artifacts. This is not a model distributor. */
export interface VerifiedCheckpoint {
  path: string;
  sha256: string;
  maxBytes: number;
}
export class CheckpointError extends Error {
  constructor(public readonly code: "invalid_manifest" | "network" | "integrity" |
    "too_large" | "cancelled", message: string) { super(message); this.name = "CheckpointError"; }
}
export interface BinaryCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}
function verifyManifest(m: VerifiedCheckpoint): void {
  if (!m.path.startsWith("/") || m.path.startsWith("//") ||
      m.path.includes("?") || m.path.includes("#") || m.path.includes("\\") ||
      m.path.split("/").includes("..") ||
      !/^[a-f0-9]{64}$/i.test(m.sha256) ||
      !Number.isSafeInteger(m.maxBytes) || m.maxBytes < 1 || m.maxBytes > 512 * 1024 * 1024) {
    throw new CheckpointError("invalid_manifest", "Checkpoint must have an absolute same-origin path, pinned digest and bounded size");
  }
}
const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new CheckpointError("cancelled", "Model request cancelled");
};
async function digest(bytes: Uint8Array): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new CheckpointError("integrity", "SubtleCrypto SHA-256 unavailable");
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}
async function verified(bytes: Uint8Array, m: VerifiedCheckpoint, signal?: AbortSignal): Promise<boolean> {
  aborted(signal);
  if (bytes.byteLength > m.maxBytes) return false;
  const ok = (await digest(bytes)) === m.sha256.toLowerCase();
  aborted(signal);
  return ok;
}
export async function loadCheckpoint(
  manifest: VerifiedCheckpoint,
  options: { signal?: AbortSignal; cache?: BinaryCache; fetcher?: typeof fetch } = {}
): Promise<Uint8Array> {
  verifyManifest(manifest);
  const {signal, cache, fetcher = fetch} = options;
  aborted(signal);
  const key = manifest.sha256.toLowerCase();
  try {
    const saved = await cache?.get(key);
    if (saved && await verified(saved, manifest, signal)) return saved;
  } catch (err) {
    if (err instanceof CheckpointError && err.code === "cancelled") throw err;
    // IndexedDB/OPFS may have been evicted; retry via a pinned same-origin request.
  }
  aborted(signal);
  let response: Response;
  try {
    response = await fetcher(manifest.path, {signal, credentials: "same-origin", redirect: "error", cache: "no-store"});
  } catch (err) {
    if (signal?.aborted) throw new CheckpointError("cancelled", "Model request cancelled");
    throw new CheckpointError("network", "Model file unavailable");
  }
  if (!response.ok || response.type === "opaque" || !response.body) throw new CheckpointError("network", "Invalid checkpoint response");
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (+contentLength > manifest.maxBytes || !Number.isFinite(+contentLength))) {
    await response.body.cancel(); throw new CheckpointError("too_large", "Checkpoint exceeds memory budget");
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      aborted(signal);
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > manifest.maxBytes) throw new CheckpointError("too_large", "Checkpoint exceeds memory budget");
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    if (signal?.aborted) throw new CheckpointError("cancelled", "Model request cancelled");
    throw err;
  } finally { reader.releaseLock(); }
  aborted(signal);
  const bytes = new Uint8Array(size);
  let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!await verified(bytes, manifest, signal)) throw new CheckpointError("integrity", "Checkpoint digest mismatch");
  try { await cache?.put(key, bytes); } catch { /* quota/eviction: inference may proceed without cache */ }
  aborted(signal);
  return bytes;
}
