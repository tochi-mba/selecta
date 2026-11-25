import { isQuotaError } from './store';

// The device-wide derived store (ADR-0469 amendment, flag `cloud.content_cache`).
//
// One IndexedDB database for this browser, shared by every account that signs in here, holding
// only deterministic machine derivations of a file's bytes, each keyed `(kind, version, sha256)`:
// a tonal profile, a waveform, a song's duration. No workspace id, no title, nothing a person
// typed or chose. Beside them, the fingerprint memo: from a file's identity on disk (a hash of
// its place, size and last-modified time) to the SHA-256 this device once computed from its
// bytes, so the same folder picked again (by any account) is not read in full again.
//
// The contract, as for the OPFS content cache:
// - Version-prefixed: every key carries its derivation's version, so a bump is a miss.
// - Possession-proven: a derivation is written only under a hash this device has just computed
//   from bytes it holds; nothing a server or another tab claims names a shared entry.
// - Read only through a workspace's own index: callers ask for hashes the signed-in account's
//   song index holds, never by listing this store (it has no "list" for that reason).
// - Eviction-tolerant and quota-aware: a full store evicts the least recently used derivations
//   (then old memo entries), never a song index; a miss is a recompute, never an error.
// - Degrades quietly: where IndexedDB is refused (private browsing, blocked storage) it is a
//   memory map for this visit, so import works and simply reuses nothing next time.

/** Named under the media prefix so "Clear everything in this browser" deletes it with the rest;
 * "Forget this account here" never does (it is not any one account's). */
export const DERIVED_DB = 'selecta-media-derived';
const DB_VERSION = 1;
const DERIVATIONS = 'derivations';
const MEMO = 'memo';

/** The kinds this store holds. Each is a pure function of the bytes. */
export type DerivedKind = 'tonal' | 'waveform' | 'facts' | 'audio';

/** The fingerprint memo's own version: bumped if what the identity key covers ever changes. */
export const MEMO_VERSION = 'fp-v1';

export type MemoEntry = {
  sha: string;
  /** When this device last computed `sha` from the file's bytes. */
  hashedAt: number;
  used: number;
};

type DerivationRow = { kind: DerivedKind; version: string; sha: string; value: unknown; at: number; used: number };

const SHA256 = /^[0-9a-f]{64}$/;
/** Keys that would carry something a person typed, chose or did. Refused at any depth, so a
 * derivation can never become a way to share a title or a rating between accounts. */
const USER_KEYS = /^(title|artist|album|name|names|filename|file_name|path|rating|ratings|stars|plays|play_count|history|played_at|note|notes|tags|comment|verdict|review|reviews|workspace|workspace_id|workspaceid|account|song_id|songid)$/i;

export function assertMachineDerived(value: unknown, at = 'value'): void {
  if (Array.isArray(value)) {
    // arrays of numbers (waveforms) are checked cheaply: only objects can carry keys
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (item && typeof item === 'object') assertMachineDerived(item, `${at}[${index}]`);
    }
    return;
  }
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (USER_KEYS.test(key)) throw new Error(`A shared derivation must hold only machine-derived data: found "${key}" at ${at}`);
      assertMachineDerived(inner, `${at}.${key}`);
    }
  }
}

const rowKey = (kind: DerivedKind, version: string, sha: string) => `${kind}|${version}|${sha}`;

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

/** Re-stamp an entry's last use at most this often, so reading 3,000 profiles is not 3,000 writes. */
const TOUCH_EVERY_MS = 24 * 60 * 60 * 1000;
/** How many entries one eviction round frees before trying the write again. */
const EVICT_BATCH = 25;

export class DerivedStore {
  /** True where nothing is kept beyond this visit (private browsing, storage refused). */
  degraded = false;
  private db: IDBDatabase | null = null;
  private memory = new Map<string, DerivationRow>();
  private memo = new Map<string, MemoEntry>();

  private constructor() {}

  static async open(): Promise<DerivedStore> {
    const store = new DerivedStore();
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('no IndexedDB');
      const opening = indexedDB.open(DERIVED_DB, DB_VERSION);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains(DERIVATIONS)) db.createObjectStore(DERIVATIONS);
        if (!db.objectStoreNames.contains(MEMO)) db.createObjectStore(MEMO);
      };
      store.db = await new Promise<IDBDatabase>((resolve, reject) => {
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error ?? new Error('IndexedDB would not open'));
        opening.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
      });
      // "Clear everything" in another tab must not wait on this connection.
      store.db.onversionchange = () => store.release();
    } catch {
      store.db = null;
      store.degraded = true;
    }
    return store;
  }

  release(): void {
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
    this.degraded = true;
    if (shared === this) sharedOpening = null;
  }

  private async read<T>(name: string, key: string): Promise<T | null> {
    if (!this.db) return null;
    try {
      return ((await settled(this.db.transaction(name, 'readonly').objectStore(name).get(key))) as T | undefined) ?? null;
    } catch {
      return null;
    }
  }

  /** One write, evicting old derivations on a full store. False when it could not be kept. */
  private async write(name: string, key: string, value: unknown): Promise<boolean> {
    if (!this.db) return false;
    for (let round = 0; round < 40; round += 1) {
      try {
        const transaction = this.db.transaction(name, 'readwrite');
        const done = committed(transaction);
        transaction.objectStore(name).put(value, key);
        await done;
        return true;
      } catch (error) {
        if (!isQuotaError(error)) return false;
        if (!(await this.evictOldest())) return false;
      }
    }
    return false;
  }

  /** Free the least recently used derivations, then the oldest memo entries (a memo miss only
   * costs one re-hash). Song indexes live in other databases and are never candidates. */
  async evictOldest(count = EVICT_BATCH): Promise<boolean> {
    if (!this.db) return false;
    for (const name of [DERIVATIONS, MEMO]) {
      try {
        const store = this.db.transaction(name, 'readonly').objectStore(name);
        const [keys, values] = await Promise.all([settled(store.getAllKeys()), settled(store.getAll())]);
        if (!keys.length) continue;
        const order = keys.map((key, index) => ({ key, used: Number((values[index] as { used?: number } | undefined)?.used ?? 0) }))
          .sort((a, b) => a.used - b.used)
          .slice(0, count);
        const transaction = this.db.transaction(name, 'readwrite');
        const done = committed(transaction);
        for (const { key } of order) {
          transaction.objectStore(name).delete(key);
          if (name === DERIVATIONS) this.memory.delete(String(key));
          else this.memo.delete(String(key));
        }
        await done;
        return true;
      } catch {
        // try the next store
      }
    }
    return false;
  }

  async get<T>(kind: DerivedKind, version: string, sha: string): Promise<T | null> {
    if (!SHA256.test(sha)) return null;
    const key = rowKey(kind, version, sha);
    const row = this.memory.get(key) ?? await this.read<DerivationRow>(DERIVATIONS, key);
    if (!row || row.version !== version || row.sha !== sha) return null;
    this.memory.set(key, row);
    const now = Date.now();
    if (now - row.used > TOUCH_EVERY_MS) {
      row.used = now;
      void this.write(DERIVATIONS, key, row);
    }
    return row.value as T;
  }

  /** The entries for exactly these hashes (the caller's own index), never more. */
  async getMany<T>(kind: DerivedKind, version: string, shas: Iterable<string>): Promise<Map<string, T>> {
    const found = new Map<string, T>();
    for (const sha of shas) {
      const value = await this.get<T>(kind, version, sha);
      if (value !== null) found.set(sha, value);
    }
    return found;
  }

  /** Keep a derivation. The caller must have just hashed the bytes it derived from to `sha`
   * itself (possession proof); values carrying user-entered keys are refused outright. */
  async put(kind: DerivedKind, version: string, sha: string, value: unknown): Promise<boolean> {
    if (!SHA256.test(sha)) return false;
    assertMachineDerived(value);
    const now = Date.now();
    const row: DerivationRow = { kind, version, sha, value, at: now, used: now };
    const key = rowKey(kind, version, sha);
    this.memory.set(key, row);
    return this.write(DERIVATIONS, key, row);
  }

  /** Where this browser keeps nothing, the memo keeps nothing either, even for the visit: a
   * hint must come from a store that outlives the page, or it is not this browser's memory. */
  async memoGet(identity: string): Promise<MemoEntry | null> {
    if (this.degraded) return null;
    const entry = this.memo.get(identity) ?? await this.read<MemoEntry>(MEMO, identity);
    if (!entry || !SHA256.test(entry.sha)) return null;
    this.memo.set(identity, entry);
    return entry;
  }

  async memoPut(identity: string, sha: string): Promise<void> {
    if (!SHA256.test(sha) || this.degraded) return;
    const now = Date.now();
    const entry: MemoEntry = { sha, hashedAt: now, used: now };
    this.memo.set(identity, entry);
    await this.write(MEMO, identity, entry);
  }

  async memoDrop(identity: string): Promise<void> {
    this.memo.delete(identity);
    if (!this.db) return;
    try {
      const transaction = this.db.transaction(MEMO, 'readwrite');
      const done = committed(transaction);
      transaction.objectStore(MEMO).delete(identity);
      await done;
    } catch { /* gone or unreachable: a stale hint costs a re-hash at most */ }
  }
}

let shared: DerivedStore | null = null;
let sharedOpening: Promise<DerivedStore> | null = null;

/** This page's one connection to the device-wide store. */
export function derivedStore(): Promise<DerivedStore> {
  return (sharedOpening ??= DerivedStore.open().then((store) => { shared = store; return store; }));
}

/** Test seam: forget this page's connection. */
export function resetDerivedStoreForTests(): void {
  try { shared?.release(); } catch { /* closed */ }
  shared = null;
  sharedOpening = null;
}

type Locks = { request: <T>(name: string, run: () => Promise<T>) => Promise<T> };

/** One writer per hash across this browser's tabs (the Web Locks pattern in devices/audioTab):
 * a second tab asking for the same work waits, then finds it done. Without Web Locks the work
 * simply runs; writes are idempotent, so the cost is doing it twice. */
export async function withHashLock<T>(scope: string, sha: string, run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator as unknown as { locks: Locks }).locks : null;
  if (!locks) return run();
  try {
    return await locks.request(`selecta-derive:${scope}:${sha}`, run);
  } catch (error) {
    // a lock manager that refuses (a sandboxed frame) must not stop the work
    if ((error as { name?: string } | null)?.name === 'SecurityError') return run();
    throw error;
  }
}
