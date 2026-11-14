import type { LocalRecording, LocalSource } from './types';

/** Origin-local IndexedDB metadata. Never store audio blobs, filesystem paths or file handles. */
export type SavedLocalIndex = { schema: 1; sources: LocalSource[]; recordings: LocalRecording[] };
const DB = 'selecta-browser-media-v1';
const STORE = 'workspace-index';
function openIndex(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
  });
}
export async function readLocalIndex(workspaceId: string): Promise<SavedLocalIndex | null> {
  let database: IDBDatabase | undefined;
  try {
    database = await openIndex();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = database!.transaction(STORE, 'readonly').objectStore(STORE).get(workspaceId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!value || typeof value !== 'object') return null;
    const entry = value as Partial<SavedLocalIndex>;
    if (entry.schema !== 1 || !Array.isArray(entry.sources) || !Array.isArray(entry.recordings)
      || entry.recordings.length > 20000 || entry.sources.length > 20000) return null;
    return { schema: 1, sources: entry.sources, recordings: entry.recordings };
  } catch { return null; } // Safari private mode, quota/denied storage and eviction
  finally { database?.close(); }
}
export async function writeLocalIndex(workspaceId: string, index: SavedLocalIndex): Promise<boolean> {
  let database: IDBDatabase | undefined;
  try {
    database = await openIndex();
    await new Promise<void>((resolve, reject) => {
      const tx = database!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(index, workspaceId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
  finally { database?.close(); }
}
