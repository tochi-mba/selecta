import { isQuotaError } from './store';
import type { ArtSize, MadeArt } from './artWorker';

// Covers from the person's own files, kept on this device (ADR-0478, FL-0478-01, flag
// `library.art_embedded`).
//
// Keyed by the song's content hash (`content_sha256`), the same identity the import registers
// and the device-wide derived store uses: a cover read from a file is a pure function of its
// bytes, so the same file imported by two accounts here is drawn once. Like the derived store it
// is read only for hashes a workspace's own index holds (through `bindArtIndex`), never listed.
// It holds only the two downscaled images, their type and a hue: no title, path or id.
//
// The images never leave the device: nothing here uploads, and the URLs handed out are local
// `blob:` URLs. Eviction-tolerant and quota-aware: a full store drops the least recently used
// covers, and a miss is simply the generated tile. Where IndexedDB is refused, covers live in
// memory for this visit.

/** Named under the media prefix, so "Clear everything in this browser" (cloud/deviceData.ts)
 * deletes it with the other media databases. */
export const ART_DB = 'selecta-media-art';
/** Bumped when what a stored cover is changes (sizes, encoding), so an old row is a miss. */
export const ART_VERSION = 'art-v1';
const DB_VERSION = 1;
const ART = 'art';
const SHA256 = /^[0-9a-f]{64}$/;
/** Re-stamp a cover's last use at most this often, so a scroll through the library is not a write per row. */
const TOUCH_EVERY_MS = 24 * 60 * 60 * 1000;
const EVICT_BATCH = 25;
/** Object URLs kept alive at once; the oldest is revoked when a new one would pass this. */
const URL_CACHE = 400;

type ArtRow = { sha: string; version: string; small: Blob; large: Blob; hue: number | null; at: number; used: number };

export type ArtImage = { src: string; type: string };

let db: IDBDatabase | null = null;
let opening: Promise<IDBDatabase | null> | null = null;
/** Rows read or written this visit (and every row, where IndexedDB is refused). */
const rows = new Map<string, ArtRow>();
/** Hashes known to have no cover, so a library of untagged files is not a read per row per render. */
const missing = new Set<string>();
const urls = new Map<string, ArtImage>();
const listeners = new Set<(sha: string | null) => void>();

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function release(): void {
  try { db?.close(); } catch { /* already closed */ }
  db = null;
  opening = null;
}

function openDb(): Promise<IDBDatabase | null> {
  return (opening ??= (async () => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return null;
      const request = indexedDB.open(ART_DB, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(ART)) request.result.createObjectStore(ART);
      };
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB would not open'));
        request.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
      });
      // "Clear everything" in any tab must not wait on this connection: let go, and forget what
      // this page was showing, since the rows are about to be gone.
      db.onversionchange = () => {
        release();
        forgetAll();
      };
      return db;
    } catch {
      db = null;
      return null;
    }
  })());
}

const rowKey = (sha: string) => `${ART_VERSION}|${sha}`;

function notify(sha: string | null): void {
  for (const listener of listeners) {
    try { listener(sha); } catch { /* one listener never stops the others */ }
  }
}

/** Told whenever a cover is added or removed (`null`: all of them). Returns a way to stop. */
export function subscribeArt(listener: (sha: string | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function revoke(key: string): void {
  const image = urls.get(key);
  if (!image) return;
  urls.delete(key);
  try { URL.revokeObjectURL(image.src); } catch { /* nothing to free */ }
}

function forgetAll(): void {
  for (const key of [...urls.keys()]) revoke(key);
  rows.clear();
  missing.clear();
  songKeys.clear();
}

function forgetOne(sha: string): void {
  revoke(`${sha}|small`);
  revoke(`${sha}|large`);
  rows.delete(sha);
}

async function write(key: string, row: ArtRow): Promise<boolean> {
  const open = await openDb();
  if (!open) return false;
  for (let round = 0; round < 40; round += 1) {
    try {
      const transaction = open.transaction(ART, 'readwrite');
      const done = committed(transaction);
      transaction.objectStore(ART).put(row, key);
      await done;
      return true;
    } catch (error) {
      if (!isQuotaError(error) || !(await evictOldest())) return false;
    }
  }
  return false;
}

/** Free the least recently used covers. Only this database is touched; song indexes never are. */
async function evictOldest(count = EVICT_BATCH): Promise<boolean> {
  const open = await openDb();
  if (!open) return false;
  try {
    const store = open.transaction(ART, 'readonly').objectStore(ART);
    const [keys, values] = await Promise.all([settled(store.getAllKeys()), settled(store.getAll() as IDBRequest<ArtRow[]>)]);
    if (!keys.length) return false;
    const order = keys.map((key, index) => ({ key, row: values[index] }))
      .sort((a, b) => (a.row?.used ?? 0) - (b.row?.used ?? 0))
      .slice(0, count);
    const transaction = open.transaction(ART, 'readwrite');
    const done = committed(transaction);
    for (const { key, row } of order) {
      transaction.objectStore(ART).delete(key);
      if (row?.sha) forgetOne(row.sha);
    }
    await done;
    for (const { row } of order) if (row?.sha) notify(row.sha);
    return true;
  } catch {
    return false;
  }
}

async function readRow(sha: string): Promise<ArtRow | null> {
  if (!SHA256.test(sha) || missing.has(sha)) return null;
  const kept = rows.get(sha);
  if (kept) return kept;
  const open = await openDb();
  let row: ArtRow | null = null;
  if (open) {
    try {
      row = ((await settled(open.transaction(ART, 'readonly').objectStore(ART).get(rowKey(sha)))) as ArtRow | undefined) ?? null;
    } catch {
      row = null;
    }
  }
  if (!row || row.version !== ART_VERSION || row.sha !== sha) {
    missing.add(sha);
    return null;
  }
  rows.set(sha, row);
  const now = Date.now();
  if (now - row.used > TOUCH_EVERY_MS) {
    row.used = now;
    void write(rowKey(sha), row);
  }
  return row;
}

/** Keep a cover made from a file whose bytes this device just hashed to `sha`. False when it
 * could not be kept beyond this visit (it still shows for this visit). */
export async function putArt(sha: string, art: MadeArt): Promise<boolean> {
  if (!SHA256.test(sha)) return false;
  const now = Date.now();
  const row: ArtRow = { sha, version: ART_VERSION, small: art.small, large: art.large, hue: art.hue, at: now, used: now };
  forgetOne(sha);
  missing.delete(sha);
  rows.set(sha, row);
  const kept = await write(rowKey(sha), row);
  notify(sha);
  return kept;
}

export async function hasArt(sha: string): Promise<boolean> {
  return (await readRow(sha)) !== null;
}

/** A local `blob:` URL and type for one size of a song's cover, or null. The URL stays valid
 * until the cover is evicted from this page's small cache or removed; ask again rather than
 * keeping it. */
export async function getArtImage(sha: string, size: ArtSize): Promise<ArtImage | null> {
  const key = `${sha}|${size}`;
  const cached = urls.get(key);
  if (cached) {
    // most recently used last, so the oldest is revoked first
    urls.delete(key);
    urls.set(key, cached);
    return cached;
  }
  const row = await readRow(sha);
  if (!row || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const blob = size === 'large' ? row.large : row.small;
  const again = urls.get(key);
  if (again) return again; // another caller made it while this one read
  const image = { src: URL.createObjectURL(blob), type: blob.type || 'image/jpeg' };
  urls.set(key, image);
  while (urls.size > URL_CACHE) {
    const oldest = urls.keys().next().value;
    if (oldest === undefined) break;
    revoke(oldest);
  }
  return image;
}

export async function getArtUrl(sha: string, size: ArtSize): Promise<string | null> {
  return (await getArtImage(sha, size))?.src ?? null;
}

/** The URL already made for this size, without waiting: for a first render. */
export function peekArtUrl(sha: string, size: ArtSize): string | null {
  return urls.get(`${sha}|${size}`)?.src ?? null;
}

export async function getArtHue(sha: string): Promise<number | null> {
  return (await readRow(sha))?.hue ?? null;
}

/** Remove one song's cover, or every cover on this device when no hash is given. */
export async function clearArt(sha?: string): Promise<void> {
  if (sha !== undefined) forgetOne(sha);
  else forgetAll();
  const open = await openDb();
  if (open) {
    try {
      const transaction = open.transaction(ART, 'readwrite');
      const done = committed(transaction);
      if (sha !== undefined) transaction.objectStore(ART).delete(rowKey(sha));
      else transaction.objectStore(ART).clear();
      await done;
    } catch { /* gone or unreachable: a stale cover is evicted in time */ }
  }
  notify(sha ?? null);
}

// ---------- from a workspace's song id to the content hash ----------
// (declared below the helpers above that clear `songKeys`; it is only touched at run time)

/** Song ids are per-workspace server ids; only the open workspace's own index may turn one into a
 * hash (ADR-0469). The shell binds its index here; without a binding, an id has no cover. */
type ArtIndex = (songId: number) => Promise<string | null>;
let index: ArtIndex | null = null;
const songKeys = new Map<number, Promise<string | null>>();

/** Bind the open workspace's song index (id to content hash). Returns a way to unbind. */
export function bindArtIndex(lookup: ArtIndex | null): () => void {
  index = lookup;
  songKeys.clear();
  notify(null);
  return () => {
    if (index !== lookup) return;
    index = null;
    songKeys.clear();
    notify(null);
  };
}

/** The content hash for a song id in the bound workspace, or null. */
export function songKeyFor(songId: number): Promise<string | null> {
  const bound = index;
  if (!bound || !Number.isFinite(songId)) return Promise.resolve(null);
  let found = songKeys.get(songId);
  if (!found) {
    found = bound(songId).then((sha) => (sha && SHA256.test(sha) ? sha : null), () => null).then((sha) => {
      // only a found hash is remembered: a song indexed a moment later is looked up again
      if (!sha) songKeys.delete(songId);
      return sha;
    });
    songKeys.set(songId, found);
  }
  return found;
}

/** Test seam: forget this page's connection and caches. */
export function resetArtStoreForTests(): void {
  release();
  forgetAll();
  index = null;
}
