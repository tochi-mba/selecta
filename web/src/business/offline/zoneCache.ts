// The kiosk's saved horizon (ADR-0446 "The kiosk cache"). Files are keyed by artifact key plus
// checksum, never by URL, and live in IndexedDB; every access is wrapped so a browser without it
// (or one that throws in a private window) falls back to memory. The device cap is enforced by
// evicting played files oldest-played first, then the planned files furthest in the future;
// the committed window is never evicted.

export type Segment = {
  id: string;
  key: string;
  kind?: string;
  starts_at: number;
  duration_s: number;
  bytes: number;
  sha256: string;
  committed: boolean;
};

export type Manifest = {
  zone_id: string;
  version: string;
  segments: Segment[];
  schedule?: Record<string, unknown>;
  close_at?: number | null;
  [extra: string]: unknown;
};

export type Entry = {
  cacheKey: string;
  bytes: number;
  startsAt: number;
  committed: boolean;
  storedAt: number;
  playedAt: number | null;
};

export type BlobStore = {
  get(key: string): Promise<Blob | null>;
  put(key: string, blob: Blob): Promise<void>;
  delete(key: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | null>;
  putMeta(key: string, value: unknown): Promise<void>;
};

export const DEFAULT_CAP_BYTES = 4 * 1024 ** 3;
export const QUOTA_SHARE = 0.5;

/** The smaller of 4 GB and half the browser's reported quota. */
export function capFromEstimate(estimate?: { quota?: number } | null): number {
  const quota = estimate?.quota;
  if (!quota || quota <= 0) return DEFAULT_CAP_BYTES;
  return Math.min(DEFAULT_CAP_BYTES, Math.floor(quota * QUOTA_SHARE));
}

export function cacheKeyOf(segment: Pick<Segment, 'key' | 'sha256'>): string {
  return `${segment.key}:${segment.sha256}`;
}

export function memoryBlobStore(): BlobStore {
  const blobs = new Map<string, Blob>();
  const meta = new Map<string, unknown>();
  return {
    get: async (k) => blobs.get(k) ?? null,
    put: async (k, b) => { blobs.set(k, b); },
    delete: async (k) => { blobs.delete(k); },
    getMeta: async <T,>(k: string) => (meta.has(k) ? (meta.get(k) as T) : null),
    putMeta: async (k, v) => { meta.set(k, v); },
  };
}

const DB_NAME = 'selectadj-zone-cache';
const BLOBS = 'blobs';
const META = 'meta';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB when it opens, memory otherwise; a later failing call also falls back to memory. */
export async function openBlobStore(factory?: IDBFactory | null): Promise<BlobStore> {
  const memory = memoryBlobStore();
  let db: IDBDatabase;
  try {
    const idb = factory === undefined ? globalThis.indexedDB : factory;
    if (!idb) return memory;
    const open = idb.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(BLOBS);
      open.result.createObjectStore(META);
    };
    db = await request(open);
  } catch {
    return memory;
  }
  const run = async <T,>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    request(fn(db.transaction(store, mode).objectStore(store)));
  return {
    async get(k) {
      try { return ((await run(BLOBS, 'readonly', (s) => s.get(k))) as Blob | undefined) ?? null; } catch { return memory.get(k); }
    },
    async put(k, b) {
      try { await run(BLOBS, 'readwrite', (s) => s.put(b, k)); } catch { await memory.put(k, b); }
    },
    async delete(k) {
      try { await run(BLOBS, 'readwrite', (s) => s.delete(k)); } catch { /* ignore */ }
      await memory.delete(k);
    },
    async getMeta<T>(k: string) {
      try { return ((await run(META, 'readonly', (s) => s.get(k))) as T | undefined) ?? null; } catch { return memory.getMeta<T>(k); }
    },
    async putMeta(k, v) {
      try { await run(META, 'readwrite', (s) => s.put(v, k)); } catch { await memory.putMeta(k, v); }
    },
  };
}

async function subtleSha256(blob: Blob): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle || typeof blob.arrayBuffer !== 'function') return null;
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export type PutResult = { ok: true } | { ok: false; reason: 'checksum' | 'no_room' };

export type ZoneCacheOptions = {
  store?: BlobStore;
  capBytes?: number;
  /** Epoch seconds; used for stored and played times. */
  now?: () => number;
  /** Returns the hex SHA-256, or null when it cannot be computed (then the file is trusted). */
  hash?: (blob: Blob) => Promise<string | null>;
};

export function createZoneCache(options: ZoneCacheOptions = {}) {
  let storePromise: Promise<BlobStore> | null = options.store ? Promise.resolve(options.store) : null;
  const store = () => (storePromise ??= openBlobStore());
  const now = options.now ?? (() => Date.now() / 1000);
  const hash = options.hash ?? subtleSha256;
  let cap = options.capBytes ?? DEFAULT_CAP_BYTES;
  let current: Manifest | null = null;
  const entries = new Map<string, Entry>();

  const saveIndex = async () => (await store()).putMeta('index', [...entries.values()]);
  const used = () => [...entries.values()].reduce((sum, e) => sum + e.bytes, 0);
  const inManifest = () => new Set((current?.segments ?? []).map(cacheKeyOf));
  const committedKeys = () => new Set((current?.segments ?? []).filter((s) => s.committed).map(cacheKeyOf));

  /** Eviction order: played (oldest played first), files no longer planned, then the furthest planned. */
  function evictionOrder(): Entry[] {
    const planned = inManifest();
    const committed = committedKeys();
    // A played file has left the committed window even if the manifest has not caught up yet.
    const candidates = [...entries.values()]
      .filter((e) => e.playedAt !== null || (!committed.has(e.cacheKey) && !e.committed));
    const played = candidates.filter((e) => e.playedAt !== null).sort((a, b) => (a.playedAt ?? 0) - (b.playedAt ?? 0));
    const stale = candidates.filter((e) => e.playedAt === null && !planned.has(e.cacheKey))
      .sort((a, b) => a.storedAt - b.storedAt);
    const future = candidates.filter((e) => e.playedAt === null && planned.has(e.cacheKey))
      .sort((a, b) => b.startsAt - a.startsAt);
    return [...played, ...stale, ...future];
  }

  async function evict(entry: Entry): Promise<void> {
    entries.delete(entry.cacheKey);
    await (await store()).delete(entry.cacheKey);
  }

  /** Free room for `needed` bytes; never touches the committed window or files nearer than `beforeStart`. */
  async function makeRoom(needed: number, beforeStart: number): Promise<boolean> {
    for (const entry of evictionOrder()) {
      if (used() + needed <= cap) break;
      if (entry.playedAt === null && entry.startsAt <= beforeStart && inManifest().has(entry.cacheKey)) continue;
      await evict(entry);
    }
    return used() + needed <= cap;
  }

  return {
    /** Restore the manifest and index after a reboot. */
    async load(): Promise<void> {
      const s = await store();
      current = (await s.getMeta<Manifest>('manifest')) ?? current;
      const index = (await s.getMeta<Entry[]>('index')) ?? [];
      for (const e of index) entries.set(e.cacheKey, e);
    },
    async setManifest(manifest: Manifest): Promise<void> {
      current = manifest;
      const byKey = new Map(manifest.segments.map((s) => [cacheKeyOf(s), s]));
      for (const e of entries.values()) {
        const seg = byKey.get(e.cacheKey);
        if (seg) { e.startsAt = seg.starts_at; e.committed = seg.committed; } else e.committed = false;
      }
      await (await store()).putMeta('manifest', manifest);
      await saveIndex();
    },
    manifest: () => current,
    setCap(bytes: number): void { cap = bytes; },
    cap: () => cap,
    usedBytes: used,
    has: (segment: Pick<Segment, 'key' | 'sha256'>) => entries.has(cacheKeyOf(segment)),
    async get(segment: Pick<Segment, 'key' | 'sha256'>): Promise<Blob | null> {
      if (!entries.has(cacheKeyOf(segment))) return null;
      return (await store()).get(cacheKeyOf(segment));
    },
    /** Verify then save a downloaded file, evicting to stay inside the cap. */
    async put(segment: Segment, blob: Blob): Promise<PutResult> {
      const digest = await hash(blob);
      if (digest !== null && segment.sha256 && digest.toLowerCase() !== segment.sha256.toLowerCase()) {
        return { ok: false, reason: 'checksum' };
      }
      const key = cacheKeyOf(segment);
      const bytes = segment.bytes || blob.size;
      const existing = entries.get(key);
      if (existing) entries.delete(key);
      if (!segment.committed && !(await makeRoom(bytes, segment.starts_at))) {
        if (existing) entries.set(key, existing);
        return { ok: false, reason: 'no_room' };
      }
      await (await store()).put(key, blob);
      entries.set(key, {
        cacheKey: key, bytes, startsAt: segment.starts_at, committed: segment.committed,
        storedAt: now(), playedAt: null,
      });
      await saveIndex();
      return { ok: true };
    },
    async markPlayed(segment: Pick<Segment, 'key' | 'sha256'>, at: number = now()): Promise<void> {
      const entry = entries.get(cacheKeyOf(segment));
      if (!entry) return;
      entry.playedAt = at;
      entry.committed = false;
      await saveIndex();
    },
    /** Evict until inside the cap (after a smaller cap or a new manifest). */
    async enforceCap(): Promise<number> {
      let evicted = 0;
      for (const entry of evictionOrder()) {
        if (used() <= cap) break;
        await evict(entry);
        evicted += 1;
      }
      if (evicted) await saveIndex();
      return evicted;
    },
    /** Segments of the manifest still to download, nearest first. */
    missing(manifest: Manifest | null = current): Segment[] {
      if (!manifest) return [];
      return manifest.segments.filter((s) => !entries.has(cacheKeyOf(s)))
        .sort((a, b) => a.starts_at - b.starts_at);
    },
    /** Seconds of contiguous saved music from `at`; a gap ends the coverage. */
    coverageSeconds(at: number = now()): number {
      if (!current) return 0;
      const ordered = [...current.segments].sort((a, b) => a.starts_at - b.starts_at);
      let end = at;
      for (const s of ordered) {
        const segEnd = s.starts_at + s.duration_s;
        if (segEnd <= at) continue;
        if (s.starts_at > end + 0.5 || !entries.has(cacheKeyOf(s))) break;
        end = segEnd;
      }
      return Math.max(0, end - at);
    },
    entries: (): Entry[] => [...entries.values()],
    /** Ask the browser to keep the cache under storage pressure; reported in health. */
    async requestPersistence(): Promise<boolean> {
      try {
        const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
        return storage && typeof storage.persist === 'function' ? await storage.persist() : false;
      } catch {
        return false;
      }
    },
  };
}

export type ZoneCache = ReturnType<typeof createZoneCache>;
