import type { TrackIdentity } from './identity';

// The local media index (ADR-0458, BF-0458-06): cache, not a second library.
//
// IndexedDB holds which songs this device has and how to reach their files again; OPFS holds
// derived bytes. Losing either loses time, never music: source files are never deleted, moved
// or copied wholesale into browser storage. Private mode and blocked storage degrade to a
// memory-only index with a `degraded` flag the UI can explain, and a cache miss is always a
// recompute, never an error. Every IndexedDB and OPFS touch sits in try/catch for that reason.

/** Structural handle types, so this code and its tests never depend on which File System
 * Access declarations a TypeScript lib version happens to ship. Real handles satisfy them. */
export type FileHandleLike = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
};

export type DirectoryHandleLike = {
  kind: 'directory';
  name: string;
  values: () => AsyncIterableIterator<FileHandleLike | DirectoryHandleLike>;
};

/** How this device reaches a song's file again: a durable handle where the browser gave one,
 * else a marker that the person must pick the file again (plain inputs give no handle). */
export type FileRef =
  | { kind: 'handle'; handle: FileHandleLike }
  | { kind: 'repick'; name: string; size: number };

export type StoredSong = {
  songId: number;
  identity: TrackIdentity;
  ref: FileRef;
  importedAt: number;
  /** Persistent handles whose current bytes no longer match the registered identity. */
  availabilityIssue?: 'changed';
};

/** Thrown where browser storage is full: the import pauses honestly instead of half-recording. */
export class StorageFullError extends Error {
  constructor() {
    super('SelectaDJ has run out of browser storage. Free some space or allow more, then carry on the import.');
    this.name = 'StorageFullError';
  }
}

export function isQuotaError(error: unknown): boolean {
  if (error instanceof StorageFullError) return true;
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'QuotaExceededError';
}

const DB_NAME = 'selecta-media';
const DB_VERSION = 1;
const SONGS = 'songs';

/** The tiny promise wrapper: one request, one promise, no dependency. */
function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** A write is only durable once its transaction commits. A full disk is reported at commit
 * (the transaction aborts with QuotaExceededError), after the request itself has succeeded, so
 * writes wait for this instead of the request. */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function persistSong(db: IDBDatabase, song: StoredSong): Promise<void> {
  const transaction = db.transaction(SONGS, 'readwrite');
  const done = committed(transaction);
  transaction.objectStore(SONGS).put(song);
  await done;
}

export class MediaStore {
  /** True where IndexedDB would not open or stopped taking writes: the index lives only in
   * memory for this visit, and the UI should say a re-import will be needed next time. */
  degraded = false;
  private db: IDBDatabase | null = null;
  /** Write-through mirror: reads come from here, so a mid-visit IndexedDB failure never makes
   * songs vanish from the page that imported them. */
  private memory = new Map<number, StoredSong>();
  /** Files handed over this visit (a re-pick, a lapsed-handle recovery). Memory only, on
   * purpose: copying picked files into browser storage would be the second library the ADR
   * rejects. */
  private session = new Map<number, File>();
  private revision = 0;

  /** Changes that affect which songs are locally reachable; used to cache handle sweeps. */
  get availabilityRevision(): number { return this.revision; }

  private touchAvailability(): void { this.revision += 1; }

  static async open(): Promise<MediaStore> {
    const store = new MediaStore();
    try {
      const opening = indexedDB.open(DB_NAME, DB_VERSION);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore(SONGS, { keyPath: 'songId' });
      };
      store.db = await new Promise<IDBDatabase>((resolve, reject) => {
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error ?? new Error('IndexedDB would not open'));
        opening.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
      });
      const rows = await settled(store.db.transaction(SONGS).objectStore(SONGS).getAll() as IDBRequest<StoredSong[]>);
      for (const row of rows) store.memory.set(row.songId, row);
    } catch {
      store.db = null;
      store.degraded = true;
    }
    return store;
  }

  async put(song: StoredSong): Promise<void> {
    const previous = this.memory.get(song.songId);
    this.memory.set(song.songId, song);
    this.touchAvailability();
    if (!this.db) return;
    try {
      await persistSong(this.db, song);
    } catch (error) {
      if (isQuotaError(error)) {
        // IndexedDB stores source pointers and identities, so its rows are never eviction
        // candidates. Free derived OPFS cache first, then retry the index write transaction.
        while (await evictOldestOpfsCacheEntry()) {
          try {
            await persistSong(this.db, song);
            return;
          } catch (retryError) {
            if (!isQuotaError(retryError)) {
              this.degraded = true;
              return;
            }
          }
        }
        // Not recorded, so not claimed: the mirror goes back to what is really stored.
        if (previous) this.memory.set(song.songId, previous);
        else this.memory.delete(song.songId);
        this.touchAvailability();
        // The catalogue may still be readable, but this write did not reach durable storage.
        this.degraded = true;
        throw new StorageFullError();
      }
      this.degraded = true;
    }
  }

  async get(songId: number): Promise<StoredSong | null> {
    return this.memory.get(songId) ?? null;
  }

  async all(): Promise<StoredSong[]> {
    return [...this.memory.values()];
  }

  async remove(songId: number): Promise<void> {
    this.memory.delete(songId);
    this.session.delete(songId);
    this.touchAvailability();
    if (!this.db) return;
    try {
      const transaction = this.db.transaction(SONGS, 'readwrite');
      const done = committed(transaction);
      transaction.objectStore(SONGS).delete(songId);
      await done;
    } catch {
      this.degraded = true;
    }
  }

  /** Mark a source that no longer matches its registered content identity. Keep the row and
   * handle for the member's recovery action, but make availability consumers treat it as absent. */
  async markChanged(songId: number): Promise<void> {
    await this.setAvailabilityIssue(songId, 'changed');
  }

  /** Clear a prior mismatch only after the exact registered bytes were read again. */
  async clearChanged(songId: number): Promise<void> {
    await this.setAvailabilityIssue(songId, null);
  }

  private async setAvailabilityIssue(songId: number, issue: 'changed' | null): Promise<void> {
    const current = this.memory.get(songId);
    if (!current || issue === (current.availabilityIssue ?? null)) return;
    const next: StoredSong = { ...current };
    if (issue) next.availabilityIssue = issue;
    else delete next.availabilityIssue;
    // Update the mirror first so the current page never continues to advertise mismatched bytes
    // if persistence is blocked or full.
    this.memory.set(songId, next);
    this.touchAvailability();
    if (!this.db) return;
    try {
      const transaction = this.db.transaction(SONGS, 'readwrite');
      const done = committed(transaction);
      transaction.objectStore(SONGS).put(next);
      await done;
    } catch {
      this.degraded = true;
    }
  }

  /** Keep a freshly picked file reachable for this visit without copying it into storage. */
  attachSessionFile(songId: number, file: File): void {
    this.session.set(songId, file);
    this.touchAvailability();
  }

  detachSessionFile(songId: number): void {
    if (this.session.delete(songId)) this.touchAvailability();
  }

  sessionFile(songId: number): File | null {
    return this.session.get(songId) ?? null;
  }
}

// --- OPFS cache for derived data (prepared seams, analysis, decoded bytes). -----------------
// Quota-aware and eviction-tolerant: a failed write reports why without throwing, a missing or
// unreadable entry is a miss, and a miss means recompute.

type OpfsWritable = { write: (data: Blob | ArrayBuffer | Uint8Array) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> };
type OpfsFileHandle = { name?: string; kind?: string; getFile: () => Promise<File>; createWritable: () => Promise<OpfsWritable> };
type OpfsDirectory = {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<OpfsFileHandle>;
  removeEntry: (name: string) => Promise<void>;
  values?: () => AsyncIterableIterator<OpfsFileHandle | { name: string; kind: string }>;
};

async function opfsRoot(): Promise<OpfsDirectory | null> {
  try {
    const storage = typeof navigator !== 'undefined'
      ? (navigator.storage as (StorageManager & { getDirectory?: () => Promise<OpfsDirectory> }) | undefined)
      : undefined;
    if (!storage?.getDirectory) return null;
    return await storage.getDirectory() as unknown as OpfsDirectory;
  } catch {
    return null;
  }
}

function cacheEntryName(key: string): string {
  return `cache-${encodeURIComponent(key)}`;
}

/** The agreed key for a song's cached decoded bytes, shared by the writer and the resolver. */
export function cachedBytesKey(songId: number): string {
  return `bytes-${songId}`;
}

export type CacheWriteResult = { ok: true } | { ok: false; why: 'storage_full' | 'unavailable' };

type CacheEntry = { name: string; lastUsed: number; size: number };
const cacheUse = new Map<string, number>();
let cacheClock = 0;

function cacheTouch(name: string): void {
  cacheClock += 1;
  cacheUse.set(name, cacheClock);
}

function cacheByteLength(bytes: ArrayBuffer | Uint8Array | Blob): number {
  return typeof Blob !== 'undefined' && bytes instanceof Blob ? bytes.size : bytes.byteLength;
}

async function estimatedFreeBytes(): Promise<number | null> {
  try {
    const estimate = await (typeof navigator !== 'undefined' ? navigator.storage?.estimate?.() : undefined);
    if (estimate?.quota === undefined || estimate.usage === undefined) return null;
    return Math.max(0, estimate.quota - estimate.usage);
  } catch {
    return null;
  }
}

/** Enumerate only this module's derived cache. Catalogue rows and user source handles are never
 * eviction candidates; they are not stored in OPFS and their names do not use this prefix. */
async function opfsCacheEntries(root: OpfsDirectory, except: string): Promise<CacheEntry[]> {
  if (!root.values) return [];
  const entries: CacheEntry[] = [];
  try {
    for await (const handle of root.values()) {
      if (handle.kind !== 'file' || !handle.name?.startsWith('cache-') || handle.name === except) continue;
      try {
        const file = await handle.getFile();
        entries.push({ name: handle.name, lastUsed: cacheUse.get(handle.name) ?? file.lastModified, size: file.size });
      } catch {
        // A cache entry that cannot be inspected is still derived data; put it first to evict.
        entries.push({ name: handle.name, lastUsed: cacheUse.get(handle.name) ?? 0, size: 0 });
      }
    }
  } catch {
    // Enumeration is not supported in some test doubles/browser versions. A failed write then
    // reports storage_full instead of guessing at names and risking unrelated files.
  }
  return entries.sort((a, b) => a.lastUsed - b.lastUsed);
}

async function evictOldestOpfsCacheEntry(): Promise<boolean> {
  const root = await opfsRoot();
  if (!root) return false;
  const [oldest] = await opfsCacheEntries(root, '');
  if (!oldest) return false;
  try {
    await root.removeEntry(oldest.name);
    cacheUse.delete(oldest.name);
    return true;
  } catch {
    return false;
  }
}

/** Write one cache object atomically. Keep an older good object if its replacement fails. */
async function writeCacheEntry(root: OpfsDirectory, name: string, bytes: ArrayBuffer | Uint8Array | Blob): Promise<unknown | null> {
  let existed = false;
  let writable: OpfsWritable | null = null;
  try {
    try {
      await root.getFileHandle(name);
      existed = true;
    } catch { /* create below */ }
    const handle = await root.getFileHandle(name, { create: true });
    writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return null;
  } catch (error) {
    // Abort the pending replacement. Only remove a newly-created target; an older good cache
    // entry remains readable if replacing it failed.
    try { await writable?.abort?.(); } catch { /* already closed */ }
    if (!existed) {
      try { await root.removeEntry(name); } catch { /* no partial entry was committed */ }
    }
    return error;
  }
}

export async function cacheWrite(key: string, bytes: ArrayBuffer | Uint8Array | Blob): Promise<CacheWriteResult> {
  const root = await opfsRoot();
  if (!root) return { ok: false, why: 'unavailable' };
  const name = cacheEntryName(key);
  let failure = await writeCacheEntry(root, name, bytes);
  if (failure === null) {
    cacheTouch(name);
    return { ok: true };
  }
  if (!isQuotaError(failure)) return { ok: false, why: 'unavailable' };

  // On actual quota pressure, evict least-recently-used derived cache objects one at a time,
  // retrying after each deletion. This preserves as much useful cache as possible and never
  // evicts catalogue rows, source handles, or any OPFS entry outside our cache namespace.
  const entries = await opfsCacheEntries(root, name);
  const needed = cacheByteLength(bytes);
  let free = await estimatedFreeBytes();
  for (const entry of entries) {
    try {
      await root.removeEntry(entry.name);
      cacheUse.delete(entry.name);
    } catch {
      continue;
    }
    if (free !== null) free += entry.size;
    // Wait until the browser's estimate says the incoming object can fit. When estimates are
    // unavailable, retry after each deletion and let the actual quota response decide.
    if (free !== null && free < needed) continue;
    failure = await writeCacheEntry(root, name, bytes);
    if (failure === null) {
      cacheTouch(name);
      return { ok: true };
    }
    if (!isQuotaError(failure)) return { ok: false, why: 'unavailable' };
  }
  return { ok: false, why: 'storage_full' };
}

export async function cacheRead(key: string): Promise<ArrayBuffer | null> {
  const root = await opfsRoot();
  if (!root) return null;
  try {
    const name = cacheEntryName(key);
    const handle = await root.getFileHandle(name);
    const bytes = await (await handle.getFile()).arrayBuffer();
    cacheTouch(name);
    return bytes;
  } catch {
    return null;
  }
}

export async function cacheEvict(key: string): Promise<void> {
  const root = await opfsRoot();
  if (!root) return;
  try {
    const name = cacheEntryName(key);
    await root.removeEntry(name);
    cacheUse.delete(name);
  } catch {
    // Already gone, or the browser evicted it first: either way the entry is absent now.
  }
}
