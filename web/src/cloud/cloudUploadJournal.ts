// The upload queue's journal (`cloud.move_to_cloud`).
//
// One IndexedDB database per workspace, `selecta-cloud-uploads-<workspace>`, so a reload, a closed
// tab or a crash carries the queue on where it stopped: each song's state, its upload session and
// how many parts went, and the run's own answers (paused, mobile data allowed, why it stopped).
// It holds song ids, content hashes, titles and file names only: never a path, a handle or a
// byte of audio, and nothing in it is sent anywhere. Where IndexedDB is missing or failing it
// keeps working in memory for this visit (`degraded`).

/** What happened to one song. */
export type UploadOutcome =
  | 'uploaded'
  | 'in_cloud_library'
  | 'refused'
  | 'changed'
  | 'choose_again'
  | 'permission_again'
  | 'removed';

export type UploadRowState = 'waiting' | 'planned' | 'done';

export type UploadRow = {
  songId: number;
  /** The content hash the song was registered with: the file is re-hashed against it. */
  sha: string;
  /** The song's title for the queue's lines, never a path. */
  title: string;
  /** The file's own name (the server reads its kind from it), never a path. */
  fileName: string;
  size: number | null;
  /** Seconds, for the dry run's length check; null where unknown. */
  duration?: number | null;
  /** Its place in the queue: songs in the current and recent mixes first, then newest. */
  order: number;
  state: UploadRowState;
  sessionId: string | null;
  /** When the session was planned, and when its storage hold lapses (ms). */
  plannedAt: number | null;
  expiresAt: number | null;
  partsDone: number;
  partCount: number | null;
  /** The part size the server chose for the session. */
  partSize: number | null;
  outcome: UploadOutcome | null;
  /** The server's reason for a refusal, in its own words or code. */
  reason: string | null;
  /** The member chose "Keep playing them from this device too". */
  keepHere: boolean;
  /** Waiting for its file to be chosen again (a browser that cannot read a file twice). */
  choose: boolean;
  /** It now plays from the cloud library only on this device. */
  cloudOnly?: boolean;
};

export type UploadStopWhy = 'quota' | 'grant' | 'consent';

export type UploadMeta = {
  key: 'run';
  paused: boolean;
  /** "Upload now on mobile data" was pressed for this run. */
  meteredOk: boolean;
  /** "Wait for Wi-Fi" was pressed for this run. */
  wifiWait: boolean;
  stopped: UploadStopWhy | null;
  startedAt: number | null;
  cancelled: boolean;
};

export const EMPTY_META: UploadMeta = Object.freeze({ key: 'run', paused: false, meteredOk: false, wifiWait: false, stopped: null, startedAt: null, cancelled: false });

const VERSION = 1;
const SONGS = 'songs';
const META = 'meta';

export function uploadJournalName(workspaceId: string): string {
  if (!workspaceId) throw new Error('An upload journal needs the workspace it belongs to.');
  return `selecta-cloud-uploads-${encodeURIComponent(workspaceId)}`;
}

function openDb(name: string): Promise<IDBDatabase | null> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
    const opening = indexedDB.open(name, VERSION);
    opening.onupgradeneeded = () => {
      const made = opening.result;
      if (!made.objectStoreNames.contains(SONGS)) made.createObjectStore(SONGS, { keyPath: 'songId' });
      if (!made.objectStoreNames.contains(META)) made.createObjectStore(META, { keyPath: 'key' });
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

function readAll<T>(db: IDBDatabase, name: string): Promise<T[]> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(name, 'readonly').objectStore(name).getAll();
      request.onsuccess = () => resolve((request.result as T[] | undefined) ?? []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function write(db: IDBDatabase, name: string, change: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(name, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      change(transaction.objectStore(name));
    } catch (error) {
      reject(error);
    }
  });
}

export class UploadJournal {
  degraded = false;
  readonly workspaceId: string;
  private db: IDBDatabase | null = null;
  private rows = new Map<number, UploadRow>();
  private run: UploadMeta = { ...EMPTY_META };
  /** Writes of this tab still on their way, by song id (and for the run's answers): a reload
   * that lands meanwhile keeps what this tab already holds for them. */
  private writing = new Map<number, number>();
  private metaWriting = 0;
  private clearing = 0;

  private constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  static async open(workspaceId: string): Promise<UploadJournal> {
    const journal = new UploadJournal(workspaceId);
    journal.db = await openDb(uploadJournalName(workspaceId));
    if (!journal.db) journal.degraded = true;
    else journal.db.onversionchange = () => journal.close();
    await journal.reload();
    return journal;
  }

  /** Read again what another tab may have written (it added songs, or ran the queue). */
  async reload(): Promise<void> {
    const db = this.db;
    if (!db) return;
    const rows = await readAll<UploadRow>(db, SONGS);
    const [meta] = await readAll<UploadMeta>(db, META);
    if (this.clearing) return;
    const next = new Map(rows.map((row) => [row.songId, row]));
    for (const id of this.writing.keys()) {
      const mine = this.rows.get(id);
      if (mine) next.set(id, mine);
      else next.delete(id);
    }
    this.rows = next;
    if (!this.metaWriting) this.run = { ...EMPTY_META, ...(meta ?? {}) };
  }

  private async writingRows<T>(ids: readonly number[], work: () => Promise<T>): Promise<T> {
    for (const id of ids) this.writing.set(id, (this.writing.get(id) ?? 0) + 1);
    try {
      return await work();
    } finally {
      for (const id of ids) {
        const left = (this.writing.get(id) ?? 1) - 1;
        if (left > 0) this.writing.set(id, left);
        else this.writing.delete(id);
      }
    }
  }

  /** Every song, in queue order. */
  all(): UploadRow[] {
    return [...this.rows.values()].sort((one, other) => one.order - other.order);
  }

  get(songId: number): UploadRow | null {
    return this.rows.get(songId) ?? null;
  }

  get meta(): UploadMeta {
    return this.run;
  }

  /** The next free place at the end of the queue. */
  nextOrder(): number {
    let last = -1;
    for (const row of this.rows.values()) last = Math.max(last, row.order);
    return last + 1;
  }

  async put(...rows: UploadRow[]): Promise<void> {
    for (const row of rows) this.rows.set(row.songId, row);
    const db = this.db;
    if (!db || !rows.length) return;
    await this.writingRows(rows.map((row) => row.songId), async () => {
      try {
        await write(db, SONGS, (store) => { for (const row of rows) store.put(row); });
      } catch {
        // kept in memory: this visit carries on, a reload starts those songs again
        this.degraded = true;
      }
    });
  }

  async setMeta(change: Partial<Omit<UploadMeta, 'key'>>): Promise<UploadMeta> {
    this.run = { ...this.run, ...change, key: 'run' };
    const db = this.db;
    if (db) {
      const next = this.run;
      this.metaWriting += 1;
      try { await write(db, META, (store) => { store.put(next); }); } catch { this.degraded = true; } finally { this.metaWriting -= 1; }
    }
    return this.run;
  }

  /** Forget songs (a cancel drops what had not gone yet). */
  async drop(songIds: readonly number[]): Promise<void> {
    for (const id of songIds) this.rows.delete(id);
    const db = this.db;
    if (!db || !songIds.length) return;
    await this.writingRows(songIds, async () => {
      try { await write(db, SONGS, (store) => { for (const id of songIds) store.delete(id); }); } catch { this.degraded = true; }
    });
  }

  /** Start afresh: every song and the run's answers go. */
  async clear(): Promise<void> {
    this.rows.clear();
    this.run = { ...EMPTY_META };
    const db = this.db;
    if (!db) return;
    this.clearing += 1;
    try {
      await write(db, SONGS, (store) => { store.clear(); });
      await write(db, META, (store) => { store.clear(); });
    } catch {
      this.degraded = true;
    } finally {
      this.clearing -= 1;
    }
  }

  close(): void {
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
  }
}
