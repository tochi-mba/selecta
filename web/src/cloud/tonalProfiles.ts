import type { MediaResolver, MediaStore } from '../media';
import { TONAL_PROFILE_IMPLEMENTATION, type TonalProfile } from '../dsp/analysis/tonalProfile';
import { analyseInWorker, spawnAnalysisWorker } from '../dsp/workers/spawn';

/** Browser tonal profiles and harmonic-match answers (cloud.browser_harmonic).
 *
 * Each song this device can play is profiled once, in spare time, by the analysis worker: its
 * file is read here, decoded here and measured here, and only the small profile is kept, in this
 * browser. Nothing about the audio is sent anywhere. Profiles are keyed by the file's content hash
 * and the profile implementation, so a changed file or a new implementation measures again.
 *
 * The store is its OWN IndexedDB database per workspace (like the remembered import folder), so
 * it never touches the song index or its version, and a different account in this browser opens
 * its own. Every call degrades quietly: without IndexedDB nothing is remembered and the page says
 * nothing has been measured yet.
 */

const DB_PREFIX = 'selecta-tonal';
const DB_VERSION = 1;
const PROFILES = 'profiles';
const REVIEWS = 'reviews';
/** Decoding happens at this rate: plenty for chroma up to 5 kHz, and half the memory of 44.1k. */
const PROFILE_RATE = 22050;
/** A file this large or a recording this long is a DJ set or an album, not a song to pair. */
const MAX_BYTES = 120 * 1024 * 1024;
const MAX_SECONDS = 15 * 60;
/** Between songs while music plays, so decoding never crowds the player. */
const PLAYING_GAP_MS = 8000;
const IDLE_GAP_MS = 1500;
/** After a full pass, look again for newly connected songs this often. */
const RESWEEP_MS = 60_000;

export type ProfileRecord =
  | { sha: string; implementation: string; profile: TonalProfile }
  | { sha: string; implementation: string; unreadable: 'too_large' | 'too_long' | 'undecodable' };

export type Verdict = 'new' | 'approved' | 'rejected';

export type TonalStore = {
  /** Every record for the current implementation, by content hash. */
  records(): Promise<ReadonlyMap<string, ProfileRecord>>;
  put(record: ProfileRecord): Promise<void>;
  reviews(): Promise<ReadonlyMap<string, Verdict>>;
  review(pair: string, verdict: Verdict): Promise<void>;
};

function openDb(workspaceId: string): Promise<IDBDatabase | null> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
    const opening = indexedDB.open(`${DB_PREFIX}-${workspaceId}`, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains(PROFILES)) db.createObjectStore(PROFILES);
      if (!db.objectStoreNames.contains(REVIEWS)) db.createObjectStore(REVIEWS);
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

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** This workspace's profile and review store. Reads are served from memory after the first. */
export function tonalStore(workspaceId: string): TonalStore {
  let db: Promise<IDBDatabase | null> | null = null;
  const opened = () => (db ??= openDb(workspaceId));
  let profiles: Map<string, ProfileRecord> | null = null;
  let verdicts: Map<string, Verdict> | null = null;

  const readAll = async <T,>(name: string): Promise<Map<string, T>> => {
    const found = new Map<string, T>();
    const handle = await opened();
    if (!handle) return found;
    try {
      const store = handle.transaction(name, 'readonly').objectStore(name);
      const [keys, values] = await Promise.all([asPromise(store.getAllKeys()), asPromise(store.getAll())]);
      keys.forEach((key, index) => found.set(String(key), values[index] as T));
    } catch {
      // an unreadable store reads as empty; profiles are measured again
    }
    return found;
  };
  const write = async (name: string, key: string, value: unknown) => {
    const handle = await opened();
    if (!handle) return;
    try {
      const transaction = handle.transaction(name, 'readwrite');
      transaction.objectStore(name).put(value, key);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } catch {
      // storage full or unavailable: kept in memory for this visit only
    }
  };

  return {
    async records() {
      if (!profiles) {
        const all = await readAll<ProfileRecord>(PROFILES);
        profiles = new Map([...all.values()]
          .filter((record) => record?.implementation === TONAL_PROFILE_IMPLEMENTATION)
          .map((record) => [record.sha, record] as const));
      }
      return profiles;
    },
    async put(record) {
      (await this.records());
      profiles!.set(record.sha, record);
      await write(PROFILES, `${record.implementation}:${record.sha}`, record);
    },
    async reviews() {
      if (!verdicts) verdicts = await readAll<Verdict>(REVIEWS);
      return verdicts;
    },
    async review(pair, verdict) {
      (await this.reviews());
      verdicts!.set(pair, verdict);
      await write(REVIEWS, pair, verdict);
    },
  };
}

/** Wait for spare time: an idle callback where the browser has one, a timer otherwise. */
function spareTime(gapMs: number, stopped: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (stopped()) { resolve(); return; }
      const idle = (window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idle(() => resolve(), { timeout: 10_000 });
      else resolve();
    }, gapMs);
  });
}

/** One mono channel at PROFILE_RATE, in an array made only for the worker (so it is moved). */
async function decodeMono(bytes: ArrayBuffer): Promise<Float32Array> {
  const decoded = await new OfflineAudioContext(1, 1, PROFILE_RATE).decodeAudioData(bytes);
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const data = decoded.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) mono[index] += data[index] / decoded.numberOfChannels;
  }
  return mono;
}

export type ProfilerOptions = {
  store: TonalStore;
  openMedia: () => Promise<MediaStore>;
  resolve: MediaResolver;
  /** True while the mix is playing: songs are then measured further apart. */
  playing: () => boolean;
  /** Told after each song is measured, so an open page can show it. */
  onProfiled?: () => void;
  workerFactory?: () => Worker;
};

/** Measure, one song at a time in spare time, every song on this device without a current
 * profile. Returns the stop function. Nothing here runs on the audio path: decoding is the
 * browser's own, the measurement is the analysis worker's, and both wait for idle time. */
export function startTonalProfiler(options: ProfilerOptions): () => void {
  let stopped = false;
  let worker = null as Worker | null;
  const isStopped = () => stopped;
  // a song whose file can't be read this visit (not connected, permission lapsed) waits for the next pass
  const unreachable = new Set<number>();
  // a song the worker failed on twice is set aside as unreadable rather than retried forever
  const failures = new Map<string, number>();

  const measure = async (songId: number, sha: string) => {
    const track = await options.resolve(songId).catch(() => null);
    if (!track) { unreachable.add(songId); return; }
    let bytes: ArrayBuffer;
    try { bytes = await track.data(); } catch { unreachable.add(songId); return; }
    if (stopped) return;
    const base = { sha, implementation: TONAL_PROFILE_IMPLEMENTATION };
    if (bytes.byteLength > MAX_BYTES) { await options.store.put({ ...base, unreadable: 'too_large' }); return; }
    let pcm: Float32Array;
    try { pcm = await decodeMono(bytes); } catch { await options.store.put({ ...base, unreadable: 'undecodable' }); return; }
    if (pcm.length / PROFILE_RATE > MAX_SECONDS) { await options.store.put({ ...base, unreadable: 'too_long' }); return; }
    if (stopped) return;
    worker ??= (options.workerFactory ?? spawnAnalysisWorker)();
    const answer = await analyseInWorker(worker, pcm, PROFILE_RATE, ['profile'], { owned: true, timeoutMs: 120_000 });
    if (answer.profile && !answer.error) await options.store.put({ ...base, profile: answer.profile });
    else await options.store.put({ ...base, unreadable: 'undecodable' });
  };

  void (async () => {
    while (!stopped) {
      try {
        const media = await options.openMedia();
        const known = await options.store.records();
        const waiting = (await media.all()).filter((song) => !known.has(song.identity.content_sha256) && !unreachable.has(song.songId));
        for (const song of waiting) {
          await spareTime(options.playing() ? PLAYING_GAP_MS : IDLE_GAP_MS, isStopped);
          if (stopped) break;
          try {
            await measure(song.songId, song.identity.content_sha256);
            options.onProfiled?.();
          } catch {
            // a worker that timed out or failed is replaced; this song is tried again next pass
            (worker as Worker | null)?.terminate();
            worker = null;
            const sha = song.identity.content_sha256;
            const times = (failures.get(sha) ?? 0) + 1;
            failures.set(sha, times);
            if (times >= 2) await options.store.put({ sha, implementation: TONAL_PROFILE_IMPLEMENTATION, unreadable: 'undecodable' });
            else unreachable.add(song.songId);
          }
        }
      } catch {
        // the song index is not open yet; try again on the next pass
      }
      unreachable.clear();
      await new Promise((resolve) => window.setTimeout(resolve, RESWEEP_MS));
    }
  })();

  return () => {
    stopped = true;
    worker?.terminate();
    worker = null;
  };
}

/** Each song this device holds with its profile, by song id, for the discoveries family. */
export async function profilesBySong(store: TonalStore, media: MediaStore): Promise<{ profiles: Map<number, TonalProfile>; songs: number; unreadable: number }> {
  const known = await store.records();
  const profiles = new Map<number, TonalProfile>();
  let unreadable = 0;
  const songs = await media.all();
  for (const song of songs) {
    const record = known.get(song.identity.content_sha256);
    if (!record) continue;
    if ('profile' in record) profiles.set(song.songId, record.profile);
    else unreadable += 1;
  }
  return { profiles, songs: songs.length, unreadable };
}
