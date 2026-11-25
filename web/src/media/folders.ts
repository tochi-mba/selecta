import type { DirectoryHandleLike } from './store';

// The folders this browser keeps (ADR-0463 BF-0463-02; `cloud.music_folders`).
//
// Two stores in their OWN IndexedDB database, so they never touch the `selecta-media` song index
// or its version:
// - `folders`: the folder the last import read, keyed by workspace. An interrupted import offers
//   to carry on with it (`rememberFolder`, `recallFolder`, `forgetFolder`), as it always has.
// - `watched` (version 2): every music folder a member connected, many per workspace, each under
//   its own local id. Nothing here ever goes to the server: names and handles stay in this
//   browser (ADR-0455, ADR-0458).
//
// Every call degrades quietly: where IndexedDB is missing, blocked or failing, a read answers
// "nothing remembered" (null) and a write answers false, so the member simply picks again and the
// page can say that folders will not be remembered.

export const FOLDERS_DB = 'selecta-media-folders';
export const FOLDERS_VERSION = 2;
const FOLDERS = 'folders';
const WATCHED = 'watched';
/** EDGE CASE (two tabs open): a tab still holding version 1 blocks the upgrade until it lets go.
 * Wait this long for it, then degrade to "nothing remembered" for this one call. */
const BLOCKED_WAIT_MS = 3_000;

/** A remembered directory handle: the structural directory plus the calls real File System
 * Access handles carry, so the caller can ask permission again, and tell whether two handles are
 * the same folder or one is inside the other, without reading either. */
export type StoredFolderHandle = DirectoryHandleLike & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
  isSameEntry?: (other: unknown) => Promise<boolean>;
  resolve?: (possibleDescendant: unknown) => Promise<string[] | null>;
};

/** How a watched folder stood when it was last looked at, in the member's words on the page:
 * Watching, Needs your permission, Not found, or not checked yet. */
export type FolderState = 'watching' | 'permission' | 'missing' | 'unchecked';

export type WatchedFolder = {
  kind: 'folder';
  /** A local id, never sent anywhere; songs record it to say which folder they came from. */
  id: string;
  workspaceId: string;
  handle: StoredFolderHandle;
  name: string;
  addedAt: number;
  checkedAt: number | null;
  /** Songs that came from this folder at the last check; null before the first one. */
  songs: number | null;
  /** How many of those were new at the last check. */
  lastNew: number;
  /** Files known from this folder that were not there at the last check. */
  missing: number;
  state: FolderState;
};

type Marker = { kind: 'migrated'; workspaceId: string };

function openFolders(): Promise<IDBDatabase | null> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
    const opening = indexedDB.open(FOLDERS_DB, FOLDERS_VERSION);
    opening.onupgradeneeded = () => {
      // The upgrade only adds a store; the single remembered folder stays where it was and is
      // copied into the list lazily (see `listWatchedFolders`), so an upgrade never loses it.
      const db = opening.result;
      if (!db.objectStoreNames.contains(FOLDERS)) db.createObjectStore(FOLDERS);
      if (!db.objectStoreNames.contains(WATCHED)) db.createObjectStore(WATCHED);
    };
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (db: IDBDatabase | null) => {
        if (settled) { try { db?.close(); } catch { /* already closed */ } return; }
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(db);
      };
      opening.onsuccess = () => {
        const db = opening.result;
        // another tab upgrading or clearing this database must never wait on this connection
        try { db.onversionchange = () => { try { db.close(); } catch { /* already closed */ } }; } catch { /* a test double */ }
        finish(db);
      };
      opening.onerror = () => finish(null);
      opening.onblocked = () => { timer ??= setTimeout(() => finish(null), BLOCKED_WAIT_MS); };
    });
  } catch {
    return Promise.resolve(null);
  }
}

/** One operation in one transaction; resolves with the request's result once committed, or
 * `failed` on any failure. */
async function withStore<T>(name: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void, failed: T | null = null): Promise<T | null> {
  const db = await openFolders();
  if (!db) return failed;
  try {
    return await new Promise<T | null>((resolve) => {
      const transaction = db.transaction(name, mode);
      const request = run(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request ? ((request.result as T | undefined) ?? null) : (true as T));
      transaction.onerror = () => resolve(failed);
      transaction.onabort = () => resolve(failed);
    });
  } catch {
    return failed;
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

export async function rememberFolder(workspaceId: string, handle: StoredFolderHandle): Promise<void> {
  await withStore(FOLDERS, 'readwrite', (store) => store.put(handle, workspaceId));
}

export async function recallFolder(workspaceId: string): Promise<StoredFolderHandle | null> {
  const found = await withStore<StoredFolderHandle | undefined>(FOLDERS, 'readonly', (store) => store.get(workspaceId) as IDBRequest<StoredFolderHandle | undefined>);
  return found && (found as { kind?: string }).kind === 'directory' ? found : null;
}

export async function forgetFolder(workspaceId: string): Promise<void> {
  await withStore(FOLDERS, 'readwrite', (store) => store.delete(workspaceId));
}

// --- Watched folders (cloud.music_folders) ---------------------------------------------------

const markerKey = (workspaceId: string) => `migrated:${workspaceId}`;
/** The id the single remembered folder gets in the list: fixed, so two tabs migrating at once
 * write the same record once, never two copies of it. */
export const legacyFolderId = (workspaceId: string) => `remembered-${workspaceId}`;

export function newFolderId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isFolder(row: unknown): row is WatchedFolder {
  const folder = row as Partial<WatchedFolder> | null;
  return !!folder && folder.kind === 'folder' && typeof folder.id === 'string' && typeof folder.workspaceId === 'string'
    && !!folder.handle && (folder.handle as { kind?: string }).kind === 'directory';
}

/** Every folder this workspace watches in this browser, oldest first; null where this browser is
 * not keeping anything (IndexedDB missing, refused or failing). EDGE CASE (a second account in the
 * same browser): rows carry their workspace and only this workspace's are ever answered.
 *
 * The first read for a workspace copies the single remembered folder (version 1's only record)
 * into the list, once: a marker row says it was done, so a folder the member stopped watching is
 * never brought back by it. */
export async function listWatchedFolders(workspaceId: string): Promise<WatchedFolder[] | null> {
  const rows = await withStore<unknown[]>(WATCHED, 'readonly', (store) => store.getAll() as IDBRequest<unknown[]>);
  if (rows === null) return null;
  const mine = rows.filter((row): row is WatchedFolder => isFolder(row) && row.workspaceId === workspaceId);
  const migrated = rows.some((row) => (row as Marker | null)?.kind === 'migrated' && (row as Marker).workspaceId === workspaceId);
  if (!migrated) {
    const legacy = await recallFolder(workspaceId);
    const record: WatchedFolder | null = legacy && !mine.some((folder) => folder.id === legacyFolderId(workspaceId))
      ? { kind: 'folder', id: legacyFolderId(workspaceId), workspaceId, handle: legacy, name: legacy.name, addedAt: Date.now(), checkedAt: null, songs: null, lastNew: 0, missing: 0, state: 'unchecked' }
      : null;
    const wrote = await withStore(WATCHED, 'readwrite', (store) => {
      store.put({ kind: 'migrated', workspaceId } satisfies Marker, markerKey(workspaceId));
      if (record) store.put(record, record.id);
    });
    if (wrote && record) mine.push(record);
  }
  return mine.sort((a, b) => a.addedAt - b.addedAt);
}

/** Add or replace one folder record. False where it could not be kept (storage full or refused):
 * the caller keeps it for this visit and says so. */
export async function saveWatchedFolder(folder: WatchedFolder): Promise<boolean> {
  return (await withStore(WATCHED, 'readwrite', (store) => store.put(folder, folder.id), null)) !== null;
}

export async function removeWatchedFolder(id: string): Promise<boolean> {
  return (await withStore(WATCHED, 'readwrite', (store) => { store.delete(id); })) !== null;
}
