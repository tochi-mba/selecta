import type { SongRegistration } from './importer';
import { deleteDatabase, MEDIA_DB_PREFIX, StorageFullError } from './store';

// The durable import journal (flag `cloud.resilient_import`).
//
// An import that is interrupted (connection lost, tab closed, computer asleep, sign-in expired)
// must never throw away work it has already done. Each file's fingerprint and tags are written
// here the moment they are computed, before any network call, and the file moves through
// `fingerprinted -> registered -> saved` as Cloud answers and the local index records it. A
// later run, after a reload or on reconnect, skips every file whose stable key (relative path,
// size, last-modified) is already here, and sends only what Cloud has not confirmed. Sending
// again is safe: Cloud's song registration is idempotent by fingerprint.
//
// The journal lives in its own IndexedDB database per workspace, named under the media prefix so
// "clear everything on this device" removes it too. It never holds a path beyond the relative
// path inside the folder the member picked, and nothing in it is sent anywhere. Where IndexedDB
// is missing or failing it keeps working in memory for this visit (`degraded`).

export type JournalState = 'fingerprinted' | 'registered' | 'saved';

export type JournalRow = {
  /** `fileKey(...)`: relative path, size and last-modified time. */
  key: string;
  /** The import that wrote this row (a resumed import keeps its id). */
  importId: string;
  /** The file's name, for progress rows; never a full path. */
  name: string;
  state: JournalState;
  entry: SongRegistration;
  songId?: number;
  duplicateOf?: number;
  at: number;
};

const JOURNAL_VERSION = 1;
const FILES = 'files';

export function journalDbName(workspaceId: string): string {
  if (!workspaceId) throw new Error('An import journal needs the workspace it belongs to.');
  return `${MEDIA_DB_PREFIX}-journal-ws-${encodeURIComponent(workspaceId)}`;
}

/** The stable key of one file: the same file picked again (same place in the folder, same size,
 * same modification time) has the same key, so a resumed import recognises it without reading
 * a byte of it. */
export function fileKey(relativePath: string, size: number, lastModified: number): string {
  return `${relativePath}\u0000${size}\u0000${lastModified}`;
}

function isQuota(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'QuotaExceededError';
}

function openDb(name: string): Promise<IDBDatabase | null> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
    const opening = indexedDB.open(name, JOURNAL_VERSION);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(FILES)) opening.result.createObjectStore(FILES, { keyPath: 'key' });
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

function readAll(db: IDBDatabase): Promise<JournalRow[]> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(FILES, 'readonly').objectStore(FILES).getAll();
      request.onsuccess = () => resolve((request.result as JournalRow[] | undefined) ?? []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export class ImportJournal {
  /** True where the journal lives only in memory for this visit. */
  degraded = false;
  readonly workspaceId: string;
  private db: IDBDatabase | null;
  private rows = new Map<string, JournalRow>();

  private constructor(workspaceId: string, db: IDBDatabase | null, rows: JournalRow[]) {
    this.workspaceId = workspaceId;
    this.db = db;
    this.degraded = db === null;
    for (const row of rows) if (row && typeof row.key === 'string') this.rows.set(row.key, row);
    if (db) db.onversionchange = () => { try { db.close(); } catch { /* closed */ } this.db = null; this.degraded = true; };
  }

  static async open(workspaceId: string): Promise<ImportJournal> {
    const db = await openDb(journalDbName(workspaceId));
    const rows = db ? await readAll(db) : [];
    return new ImportJournal(workspaceId, db, rows);
  }

  /** A journal that never touches storage, for tests and degraded browsers. */
  static inMemory(workspaceId: string): ImportJournal {
    return new ImportJournal(workspaceId, null, []);
  }

  get size(): number {
    return this.rows.size;
  }

  get(key: string): JournalRow | null {
    return this.rows.get(key) ?? null;
  }

  /** Rows Cloud has not confirmed as saved here yet. */
  unsent(): JournalRow[] {
    return [...this.rows.values()].filter((row) => row.state !== 'saved');
  }

  /** Records rows durably. The memory copy is updated first, so a failing store never loses them
   * for this visit; a full store is reported as `StorageFullError` so the import pauses. */
  async put(rows: JournalRow[]): Promise<void> {
    if (!rows.length) return;
    for (const row of rows) this.rows.set(row.key, row);
    const db = this.db;
    if (!db) return;
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(FILES, 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
        const store = transaction.objectStore(FILES);
        for (const row of rows) store.put(row);
      });
    } catch (error) {
      if (isQuota(error)) throw new StorageFullError();
      // any other failure: keep going from memory for this visit
      this.degraded = true;
    }
  }

  /** Forget every row: the import finished, or the member cancelled it on purpose. */
  async clear(): Promise<void> {
    this.rows.clear();
    const db = this.db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction(FILES, 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
        transaction.objectStore(FILES).clear();
      } catch {
        resolve();
      }
    });
  }

  close(): void {
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
  }
}

/** Remove a workspace's journal without opening it (Forget this, Cancel with no run active). */
export function deleteImportJournal(workspaceId: string): Promise<void> {
  return deleteDatabase(journalDbName(workspaceId));
}
