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

export type StoredSong = { songId: number; identity: TrackIdentity; ref: FileRef; importedAt: number };

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
    if (!this.db) return;
    try {
      const transaction = this.db.transaction(SONGS, 'readwrite');
      const done = committed(transaction);
      transaction.objectStore(SONGS).put(song);
      await done;
    } catch (error) {
      if (isQuotaError(error)) {
        // Not recorded, so not claimed: the mirror goes back to what is really stored.
        if (previous) this.memory.set(song.songId, previous);
        else this.memory.delete(song.songId);
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

  /** Keep a freshly picked file reachable for this visit without copying it into storage. */
  attachSessionFile(songId: number, file: File): void {
    this.session.set(songId, file);
  }

  sessionFile(songId: number): File | null {
    return this.session.get(songId) ?? null;
  }
}

// --- OPFS cache for derived data (prepared seams, analysis, decoded bytes). -----------------
// Quota-aware and eviction-tolerant: a failed write reports why without throwing, a missing or
// unreadable entry is a miss, and a miss means recompute.

type OpfsWritable = { write: (data: Blob | ArrayBuffer | Uint8Array) => Promise<void>; close: () => Promise<void> };
type OpfsFileHandle = { getFile: () => Promise<File>; createWritable: () => Promise<OpfsWritable> };
type OpfsDirectory = {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<OpfsFileHandle>;
  removeEntry: (name: string) => Promise<void>;
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

export async function cacheWrite(key: string, bytes: ArrayBuffer | Uint8Array | Blob): Promise<CacheWriteResult> {
  const root = await opfsRoot();
  if (!root) return { ok: false, why: 'unavailable' };
  try {
    const handle = await root.getFileHandle(cacheEntryName(key), { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, why: isQuotaError(error) ? 'storage_full' : 'unavailable' };
  }
}

export async function cacheRead(key: string): Promise<ArrayBuffer | null> {
  const root = await opfsRoot();
  if (!root) return null;
  try {
    const handle = await root.getFileHandle(cacheEntryName(key));
    return await (await handle.getFile()).arrayBuffer();
  } catch {
    return null;
  }
}

export async function cacheEvict(key: string): Promise<void> {
  const root = await opfsRoot();
  if (!root) return;
  try {
    await root.removeEntry(cacheEntryName(key));
  } catch {
    // Already gone, or the browser evicted it first: either way the entry is absent now.
  }
}
