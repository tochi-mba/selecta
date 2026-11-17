import { assertNoPath, fileSha256, normalise } from './identity';
import { isQuotaError, MediaStore } from './store';
import type { DirectoryHandleLike, FileHandleLike, FileRef } from './store';

// The import pipeline (ADR-0458, BF-0458-01 and BF-0458-02).
//
// Files are hashed and registered incrementally, in batches, with honest per-file progress and
// a working cancel, because a 5,000-track library must neither freeze the page nor lie about
// what landed. The files themselves never leave the device: only identities go to Cloud, and
// `assertNoPath` guards every payload. A full browser store pauses the import with a typed
// event; everything registered before the pause is validly imported.

/** The same injected request shape the Cloud views use: never fetch directly. */
export type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'aiff', 'aif', 'wma']);

/** Registrations per POST: large enough that 5,000 tracks is 100 requests, small enough that a
 * batch reply never stalls the progress list for long. */
export const BATCH_SIZE = 50;

export type SongRegistration = {
  content_sha256: string;
  title: string;
  artist: string;
  album?: string;
  duration_s: number;
  codec?: string;
  sample_rate?: number;
};

export type RegisteredSong = { song_id: number; content_sha256: string; duplicate_of?: number };

export type ImportSummary = {
  imported: number;
  duplicates: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  paused: boolean;
};

export type ImportEvent =
  | { kind: 'file'; name: string; stage: 'hashing' | 'registering' }
  | { kind: 'file'; name: string; stage: 'done'; songId: number; duplicateOf?: number }
  | { kind: 'file'; name: string; stage: 'failed'; reason: string }
  | { kind: 'paused'; paused: 'storage_full' }
  | ({ kind: 'finished' } & ImportSummary);

/** Reads display tags and duration from a file. The default parses the filename and probes
 * duration through an audio element; a real tag parser can be injected without touching the
 * pipeline. Must never return a path. */
export type TagReader = (file: File) => Promise<{ title?: string; artist?: string; album?: string; duration_s?: number; codec?: string; sample_rate?: number }>;

export type ImportSource = FileList | File[] | FileHandleLike[] | DirectoryHandleLike;

export type ImportOptions = {
  source: ImportSource;
  request: Request;
  store: MediaStore;
  /** This browser profile's stable id, for the availability report; never a path or a name. */
  deviceId: string;
  onProgress?: (event: ImportEvent) => void;
  signal?: AbortSignal;
  readTags?: TagReader;
  batchSize?: number;
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isAudioName(name: string): boolean {
  return AUDIO_EXTENSIONS.has(extensionOf(name));
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The fallback tag reader: "Artist - Title.mp3" patterns, else the stem as the title. Wrong
 * tags are fine by design (ADR-0458 "metadata lies"): identity rides on the content hash, and
 * display metadata stays editable. */
export const defaultTagReader: TagReader = async (file) => {
  const base = stemOf(file.name);
  const split = base.split(' - ');
  const names = split.length >= 2 ? { artist: split[0], title: split.slice(1).join(' - ') } : { artist: 'Unknown artist', title: base };
  return { ...names, duration_s: await probeDuration(file), codec: extensionOf(file.name) || undefined };
};

/** Duration through a metadata-only audio element, with a timeout so a codec the browser will
 * not touch resolves to 0 instead of hanging the import. */
function probeDuration(file: File): Promise<number> {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(0);
  return new Promise((resolve) => {
    let url = '';
    let settled = false;
    const finish = (seconds: number) => {
      if (settled) return;
      settled = true;
      if (url) URL.revokeObjectURL(url);
      resolve(seconds);
    };
    try {
      url = URL.createObjectURL(file);
      const probe = document.createElement('audio');
      const timer = setTimeout(() => finish(0), 3000);
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        clearTimeout(timer);
        finish(Number.isFinite(probe.duration) ? Math.round(probe.duration * 10) / 10 : 0);
      };
      probe.onerror = () => {
        clearTimeout(timer);
        finish(0);
      };
      probe.src = url;
    } catch {
      finish(0);
    }
  });
}

type Candidate = { name: string; ref: FileRef; open: () => Promise<File> };

function isDirectorySource(source: ImportSource): source is DirectoryHandleLike {
  return (source as { kind?: string }).kind === 'directory';
}

async function walk(dir: DirectoryHandleLike, add: (handle: FileHandleLike) => void, cancelled: () => boolean): Promise<void> {
  for await (const entry of dir.values()) {
    if (cancelled()) return;
    if (entry.kind === 'directory') await walk(entry, add, cancelled);
    else add(entry);
  }
}

async function collect(source: ImportSource, signal?: AbortSignal): Promise<{ candidates: Candidate[]; skipped: number }> {
  const candidates: Candidate[] = [];
  let skipped = 0;
  const addFile = (file: File) => {
    if (!isAudioName(file.name)) {
      skipped += 1;
      return;
    }
    candidates.push({ name: file.name, ref: { kind: 'repick', name: file.name, size: file.size }, open: async () => file });
  };
  const addHandle = (handle: FileHandleLike) => {
    if (!isAudioName(handle.name)) {
      skipped += 1;
      return;
    }
    candidates.push({ name: handle.name, ref: { kind: 'handle', handle }, open: () => handle.getFile() });
  };
  if (isDirectorySource(source)) {
    await walk(source, addHandle, () => signal?.aborted ?? false);
  } else {
    const items = Array.isArray(source) ? source : Array.from(source);
    for (const item of items as (File | FileHandleLike)[]) {
      if (typeof (item as FileHandleLike).getFile === 'function') addHandle(item as FileHandleLike);
      else addFile(item as File);
    }
  }
  return { candidates, skipped };
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

/** Runs one import. Resolves with an honest summary whatever happened: cancelled, paused on a
 * full store, or finished. Only a failing registration request itself rejects, so the caller
 * can show a retry; everything registered before the failure is already recorded. */
export async function runImport(options: ImportOptions): Promise<ImportSummary> {
  const { source, request, store, deviceId, signal } = options;
  const emit = options.onProgress ?? (() => {});
  const readTags = options.readTags ?? defaultTagReader;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const summary: ImportSummary = { imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false };
  const { candidates, skipped } = await collect(source, signal);
  summary.skipped = skipped;

  let batch: { name: string; ref: FileRef; entry: SongRegistration }[] = [];

  const flush = async () => {
    if (!batch.length) return;
    const sending = batch;
    batch = [];
    for (const item of sending) emit({ kind: 'file', name: item.name, stage: 'registering' });
    const payload = { songs: sending.map((item) => item.entry) };
    assertNoPath(payload);
    const reply = await request<{ songs: RegisteredSong[] }>('/api/local-media/songs', { method: 'POST', body: JSON.stringify(payload) });
    const byHash = new Map(reply.songs.map((song) => [song.content_sha256, song]));
    const present: number[] = [];
    for (const item of sending) {
      const song = byHash.get(item.entry.content_sha256);
      if (!song) {
        summary.failed += 1;
        emit({ kind: 'file', name: item.name, stage: 'failed', reason: 'SelectaDJ could not register this track. Try the import again.' });
        continue;
      }
      await store.put({
        songId: song.song_id,
        identity: {
          content_sha256: item.entry.content_sha256,
          title: item.entry.title,
          artist: item.entry.artist,
          ...(item.entry.album ? { album: item.entry.album } : {}),
          duration_s: item.entry.duration_s,
        },
        ref: item.ref,
        importedAt: Date.now(),
      });
      present.push(song.song_id);
      if (song.duplicate_of !== undefined) {
        summary.duplicates += 1;
        emit({ kind: 'file', name: item.name, stage: 'done', songId: song.song_id, duplicateOf: song.duplicate_of });
      } else {
        summary.imported += 1;
        emit({ kind: 'file', name: item.name, stage: 'done', songId: song.song_id });
      }
    }
    if (present.length) {
      const availability = { device_id: deviceId, present, absent: [] as number[] };
      assertNoPath(availability);
      await request('/api/local-media/availability', { method: 'POST', body: JSON.stringify(availability) });
    }
  };

  try {
    for (const candidate of candidates) {
      if (signal?.aborted) {
        summary.cancelled = true;
        break;
      }
      emit({ kind: 'file', name: candidate.name, stage: 'hashing' });
      let entry: SongRegistration;
      try {
        const file = await candidate.open();
        const content_sha256 = await fileSha256(file, { signal });
        const tags = await readTags(file);
        const names = normalise({ title: tags.title ?? stemOf(candidate.name), artist: tags.artist ?? 'Unknown artist', album: tags.album });
        const codec = tags.codec ?? (extensionOf(candidate.name) || undefined);
        entry = {
          content_sha256,
          ...names,
          duration_s: tags.duration_s ?? 0,
          ...(codec ? { codec } : {}),
          ...(tags.sample_rate ? { sample_rate: tags.sample_rate } : {}),
        };
      } catch (error) {
        if (isAbort(error)) {
          summary.cancelled = true;
          break;
        }
        summary.failed += 1;
        emit({ kind: 'file', name: candidate.name, stage: 'failed', reason: 'SelectaDJ could not read this file. It stays where it is; nothing was changed.' });
        continue;
      }
      batch.push({ name: candidate.name, ref: candidate.ref, entry });
      if (batch.length >= batchSize) await flush();
    }
    if (!summary.cancelled) await flush();
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    summary.paused = true;
    emit({ kind: 'paused', paused: 'storage_full' });
  }
  emit({ kind: 'finished', ...summary });
  return summary;
}
