import type { DirectoryHandleLike } from './store';

// The remembered import folder (ADR-0463 BF-0463-02).
//
// An interrupted import offers to carry on, which needs the folder the member picked. The
// handle lives in its OWN IndexedDB database, keyed by workspace, so it never touches the
// `selecta-media` song index or its version. Every call degrades quietly: where IndexedDB is
// missing, blocked or failing, recall answers null and the member simply picks again.

export const FOLDERS_DB = 'selecta-media-folders';
const FOLDERS_VERSION = 1;
const FOLDERS = 'folders';

/** A remembered directory handle: the structural directory plus the permission calls real
 * File System Access handles carry, so the caller can ask again before re-walking it. */
export type StoredFolderHandle = DirectoryHandleLike & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
};

function openFolders(): Promise<IDBDatabase | null> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
    const opening = indexedDB.open(FOLDERS_DB, FOLDERS_VERSION);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(FOLDERS)) opening.result.createObjectStore(FOLDERS);
    };
    return new Promise((resolve) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => resolve(null);
      opening.onblocked = () => resolve(null);
    });
  } catch {
    return Promise.resolve(null);
  }
}

/** One operation in one transaction; resolves with the request's result once committed, or
 * null on any failure. */
async function withFolders<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openFolders();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const transaction = db.transaction(FOLDERS, mode);
      const request = run(transaction.objectStore(FOLDERS));
      transaction.oncomplete = () => resolve((request.result as T | undefined) ?? null);
      transaction.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

export async function rememberFolder(workspaceId: string, handle: StoredFolderHandle): Promise<void> {
  await withFolders('readwrite', (store) => store.put(handle, workspaceId));
}

export async function recallFolder(workspaceId: string): Promise<StoredFolderHandle | null> {
  const found = await withFolders<StoredFolderHandle | undefined>('readonly', (store) => store.get(workspaceId) as IDBRequest<StoredFolderHandle | undefined>);
  return found && (found as { kind?: string }).kind === 'directory' ? found : null;
}

export async function forgetFolder(workspaceId: string): Promise<void> {
  await withFolders('readwrite', (store) => store.delete(workspaceId));
}
