import { bytesSha256, type TrackIdentity } from './identity';

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

/** The pre-ADR-0469 index: one database for every account that ever signed in here. Its rows
 * cannot be attributed to a workspace, so the first scoped open deletes it (a cache, not a
 * second library: the cost is one re-import, never music). */
export const LEGACY_DB_NAME = 'selecta-media';
/** Every SelectaDJ media database starts with this; "clear everything" deletes them all. */
export const MEDIA_DB_PREFIX = 'selecta-media';
const DB_VERSION = 1;
const SONGS = 'songs';

/** One song index per workspace (ADR-0469). Song ids are per-workspace server ids, so a shared
 * index would let one account's rows (titles, file handles) answer another account's ids. */
export function mediaDbName(workspaceId: string): string {
  if (!workspaceId) throw new Error('A media index needs the workspace it belongs to.');
  return `${MEDIA_DB_PREFIX}-ws-${encodeURIComponent(workspaceId)}`;
}

/** Delete one IndexedDB database. Resolves once the browser says it is gone, or on error; a
 * "blocked" deletion still completes when the other tab lets go, so it resolves then too. */
export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(); return; }
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

let legacyDisposal: Promise<void> | null = null;
/** Drop the unscoped legacy index once per page. */
function disposeLegacyIndex(): Promise<void> {
  return (legacyDisposal ??= deleteDatabase(LEGACY_DB_NAME));
}

/** Test seam: forget that the legacy index was already disposed this page. */
export function resetLegacyDisposalForTests(): void {
  legacyDisposal = null;
}

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
  /** The workspace this index belongs to; nothing here is ever read for another. */
  readonly workspaceId: string;
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

  private constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  static async open(workspaceId: string): Promise<MediaStore> {
    const store = new MediaStore(workspaceId);
    const name = mediaDbName(workspaceId);
    try {
      await disposeLegacyIndex();
      const opening = indexedDB.open(name, DB_VERSION);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore(SONGS, { keyPath: 'songId' });
      };
      store.db = await new Promise<IDBDatabase>((resolve, reject) => {
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error ?? new Error('IndexedDB would not open'));
        opening.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
      });
      // Another tab forgetting this workspace (or clearing the device) must not wait on this
      // connection: let go, and keep serving this visit from memory.
      store.db.onversionchange = () => store.release();
      const rows = await settled(store.db.transaction(SONGS).objectStore(SONGS).getAll() as IDBRequest<StoredSong[]>);
      for (const row of rows) store.memory.set(row.songId, row);
    } catch {
      store.db = null;
      store.degraded = true;
    }
    return store;
  }

  /** Close the database connection; the memory mirror keeps answering for this visit. */
  release(): void {
    try { this.db?.close(); } catch { /* already closed */ }
    if (this.db) this.degraded = true;
    this.db = null;
  }

  /** Wipe this workspace's index on this device (delete account, forget this device). Songs,
   * handles and session files go; the source files themselves are never touched. */
  static async forget(workspaceId: string): Promise<void> {
    await deleteDatabase(mediaDbName(workspaceId));
  }

  /** `availability`: the caller knows this write changes whether the song is reachable (a
   * re-grant writing the same row back), so the lapsed sweep must look again. */
  async put(song: StoredSong, options: { availability?: boolean } = {}): Promise<void> {
    const previous = this.memory.get(song.songId);
    this.memory.set(song.songId, song);
    // Only a re-link changes availability (a new handle, or a cleared or raised issue). A plain
    // import adds a song without invalidating the lapsed sweep, so an import of thousands of
    // songs does not make the next Library visit reopen every file.
    const relinked = previous !== undefined
      && (previous.ref !== song.ref || (previous.availabilityIssue ?? null) !== (song.availabilityIssue ?? null));
    if (relinked || options.availability) this.touchAvailability();
    const db = this.db;
    if (!db) return;
    try {
      await persistSong(db, song);
    } catch (error) {
      if (isQuotaError(error)) {
        // IndexedDB stores source pointers and identities, so its rows are never eviction
        // candidates. Free derived OPFS cache first, then retry the index write transaction.
        while (await evictOldestOpfsCacheEntry()) {
          try {
            await persistSong(db, song);
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
        // Full is not broken: the index still answers and keeps taking writes once space frees,
        // so this is a paused import, never the degraded memory-only state.
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
type OpfsFileHandle = { name?: string; kind?: 'file'; getFile: () => Promise<File>; createWritable: () => Promise<OpfsWritable> };
type OpfsEntry = (OpfsFileHandle & { name: string; kind: 'file' }) | { name: string; kind: 'directory' };
type OpfsDirectory = {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<OpfsFileHandle>;
  removeEntry: (name: string) => Promise<void>;
  values?: () => AsyncIterableIterator<OpfsEntry>;
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

/** Bumped whenever what is cached under a content key changes shape, so an old entry is a miss
 * (and evictable) rather than misread. */
export const CACHE_KEY_VERSION = 'v1';
const SHA256 = /^[0-9a-f]{64}$/;

/** Who may share a cache entry (ADR-0469). `shared` is the `cloud.content_cache` flag: on, the
 * key is the song's content hash, so the same bytes reuse one entry across workspaces and
 * titles on this device; off, the key is scoped to the workspace and nothing is shared. */
export type CacheScope = { workspaceId: string; shared: boolean };

/** The agreed key for a song's cached bytes, shared by the writer and the resolver. A content
 * key is used only for a well-formed hash; anything else falls back to the scoped key. */
export function cachedBytesKey(song: Pick<StoredSong, 'songId' | 'identity'>, scope: CacheScope): string {
  const sha = song.identity.content_sha256;
  if (scope.shared && SHA256.test(sha)) return `bytes-${CACHE_KEY_VERSION}-${sha}`;
  return `bytes-${encodeURIComponent(scope.workspaceId)}-${song.songId}`;
}

const sha256Hex = bytesSha256;

/** Possession proof for content keys: bytes enter a shared entry only when this device hashed
 * them to the song's hash itself. A hash from anywhere else (a server reply, another tab's
 * claim) is never trusted to name shared bytes. */
export async function cacheSongBytes(
  song: Pick<StoredSong, 'songId' | 'identity'>,
  bytes: ArrayBuffer,
  scope: CacheScope,
  write: (key: string, bytes: ArrayBuffer) => Promise<CacheWriteResult> = cacheWrite,
): Promise<CacheWriteResult | { ok: false; why: 'not_these_bytes' }> {
  if (await sha256Hex(bytes) !== song.identity.content_sha256) return { ok: false, why: 'not_these_bytes' };
  return write(cachedBytesKey(song, scope), bytes);
}

/** Read a song's cached bytes and prove they are the song before handing them over. A content
 * entry that does not hash to its name (corrupt, or written by something that skipped the
 * proof) is evicted and reported as a miss. */
export async function readSongBytes(
  song: Pick<StoredSong, 'songId' | 'identity'>,
  scope: CacheScope,
  read: (key: string) => Promise<ArrayBuffer | null> = cacheRead,
  evict: (key: string) => Promise<void> = cacheEvict,
): Promise<ArrayBuffer | null> {
  const key = cachedBytesKey(song, scope);
  const bytes = await read(key);
  if (!bytes) return null;
  if (await sha256Hex(bytes) !== song.identity.content_sha256) {
    await evict(key);
    return null;
  }
  return bytes;
}

/** Remove every derived cache entry this module wrote ("clear everything on this device"). */
export async function cacheClearAll(): Promise<void> {
  const root = await opfsRoot();
  if (!root) return;
  for (const entry of await opfsCacheEntries(root, '')) {
    try {
      await root.removeEntry(entry.name);
      cacheUse.delete(entry.name);
    } catch {
      // A locked entry is still derived data; the browser may evict it later.
    }
  }
}

export type CacheWriteResult = { ok: true } | { ok: false; why: 'storage_full' | 'unavailable' };

type CacheEntry = { name: string; lastUsed: number; size: number };
const cacheUse = new Map<string, number>();
let cacheClock = 0;

function cacheTouch(name: string): void {
  cacheClock = Math.max(Date.now(), cacheClock + 1);
  cacheUse.set(name, cacheClock);
}

function cacheByteLength(bytes: ArrayBuffer | Uint8Array | Blob): number {
  if (typeof Blob !== 'undefined' && bytes instanceof Blob) return bytes.size;
  return (bytes as ArrayBuffer | Uint8Array).byteLength;
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
  for (const candidate of await opfsCacheEntries(root, '')) {
    try {
      await root.removeEntry(candidate.name);
      cacheUse.delete(candidate.name);
      return true;
    } catch {
      // A locked cache entry cannot help with quota; try the next derived entry.
    }
  }
  return false;
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
