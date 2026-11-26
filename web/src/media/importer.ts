import { assertNoPath, fileSha256, normalise } from './identity';
import { AUDIO_ID_PATTERN, fileIdentity } from './audioIdentity';
import { flagOn } from '../flags';
import { readFileTags } from './tags';
import { captureArt } from './art';
import { isQuotaError, MediaStore } from './store';
import { withSource, type DirectoryHandleLike, type FileHandleLike, type FileRef, type SongSource } from './store';
import type { ImportJournal } from './importJournal';
import { runJournalled } from './journalledImport';
import type { ImportFingerprints, ImportReuse } from './fingerprints';

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

/** The first registration flush fires after this many files, so the first songs land in Cloud
 * (and onboarding can unlock) within seconds instead of after a full batch of 50. */
export const FIRST_BATCH = 5;

export type SongRegistration = {
  content_sha256: string;
  title: string;
  artist: string;
  album?: string;
  duration_s?: number;
  codec?: string;
  sample_rate?: number;
  /** `library.audio_identity`: a hash of the audio alone (docs/engineering/audio-identity.md). */
  audio_id?: string;
};

export type RegisteredSong = { song_id: number; content_sha256: string; duplicate_of?: number };

export type ImportSummary = {
  imported: number;
  duplicates: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  paused: boolean;
  /** `cloud.content_cache`: how much of the fingerprinting this browser already had. */
  reuse?: ImportReuse;
};

export type ImportEvent =
  | { kind: 'file'; name: string; stage: 'hashing' | 'registering' }
  | { kind: 'file'; name: string; stage: 'done'; songId: number; duplicateOf?: number }
  | { kind: 'file'; name: string; stage: 'failed'; reason: string }
  | { kind: 'collected'; total: number; skipped: number }
  | { kind: 'batch'; registered: number }
  | { kind: 'paused'; paused: 'storage_full' }
  /** Journalled imports only: a file is fingerprinted and recorded on this device (or was
   * already, from an interrupted run: `resumed`). Counts what has been checked so far. */
  | { kind: 'checked'; name: string; resumed: boolean }
  /** Journalled imports only: sending is waiting (offline, service not answering, signed out);
   * null once it carries on. `retryAt` is when the next try happens by itself, if known. */
  | { kind: 'waiting'; wait: ImportWait | null }
  /** Journalled imports only: every file has been read; only sending may still be going on. */
  | { kind: 'read' }
  | ({ kind: 'finished' } & ImportSummary);

/** Reads display tags and duration from a file. The default parses the filename and probes
 * duration through an audio element; a real tag parser can be injected without touching the
 * pipeline. Must never return a path. */
export type TagReader = (file: File, known?: { duration_s?: number }) => Promise<{ title?: string; artist?: string; album?: string; duration_s?: number; codec?: string; sample_rate?: number }>;

export type ImportWait = { why: 'offline' | 'server' | 'signin'; retryAt: number | null };

/** Runs one request, waiting and trying again while the failure is one that passes (offline,
 * timeout, server error, rate limit, sign-in being renewed). Rejects with the original error for
 * a refusal that would only repeat, or with an AbortError when `signal` fires. */
export type RetryPolicy = <T>(work: () => Promise<T>, options: { signal?: AbortSignal; onWait?: (wait: ImportWait | null) => void }) => Promise<T>;

/** A watched folder's files already walked (`cloud.music_folders`): only the new and changed
 * ones, each at its place inside the folder, so a check reads nothing it already knows. */
export type WalkedFolder = { kind: 'walked'; name: string; files: { handle: FileHandleLike; path: string }[] };

export type ImportSource = FileList | File[] | FileHandleLike[] | DirectoryHandleLike | WalkedFolder;

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
  /** `cloud.resilient_import`: with a journal the import records each file before any network
   * call, skips files an interrupted run already did, keeps reading while offline, and sends
   * batches from the journal with `retry`. Without one, the import behaves as it always has. */
  journal?: ImportJournal;
  retry?: RetryPolicy;
  /** The registered playback device id for the availability report, or null while there is
   * none yet. Journalled imports never fail on the report; without a device it is left to the
   * shell's periodic reconcile. */
  reportDevice?: () => string | null;
  /** The import this run belongs to (kept across resumes), for the journal rows. */
  importId?: string;
  /** `cloud.content_cache` (ADR-0469 amendment): this browser's fingerprint memo and derived
   * store, so files hashed here before (by any account) are recognised without being read in
   * full. Without it every file is hashed, as before. */
  fingerprints?: ImportFingerprints | null;
  /** `cloud.music_folders`: the watched folder this import reads. Each song saved records it
   * (with the file's place inside it) in this browser's index only; never sent anywhere. */
  folderId?: string;
};

/** Where a file sits in the watched folder being imported, for the song's index row. */
export function sourceOf(folderId: string | undefined, path: string, file: File): SongSource | undefined {
  return folderId ? { folderId, path, size: file.size, modified: file.lastModified } : undefined;
}

/** The `sources` a saved row keeps: what the index already knew of the song, plus this file's
 * place. Empty (no field at all) for an import with no folder of a song with none, so the row is
 * exactly what it always was. */
export async function keptSources(store: MediaStore, songId: number, source: SongSource | undefined): Promise<{ sources?: SongSource[] }> {
  const prior = (await store.get(songId))?.sources;
  if (source) return { sources: withSource(prior, source) };
  return prior?.length ? { sources: prior } : {};
}

/** Record that an already-saved song was also found at `source`. */
export async function noteSource(store: MediaStore, songId: number, source: SongSource | undefined): Promise<void> {
  const row = await store.get(songId);
  if (!row || !source || row.sources?.some((one) => one.folderId === source.folderId && one.path === source.path && one.size === source.size && one.modified === source.modified)) return;
  await store.put({ ...row, sources: withSource(row.sources, source) });
}

/** Metadata-only JSON mutation through the injected client. FastAPI must see JSON; relying on
 * the browser's text/plain default would turn an otherwise valid import into a 422. */
export const postJson = <T>(request: Request, path: string, body: unknown): Promise<T> => request<T>(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isAudioName(name: string): boolean {
  return AUDIO_EXTENSIONS.has(extensionOf(name));
}

export function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Names from the filename alone: "Artist - Title" patterns, with a leading track number
 * ("01." or "001 - ") dropped from either slot, else the stem as the title. */
export function namesFromFilename(name: string): { artist: string; title: string } {
  const trackNumber = /^\s*\d{1,4}\s*[.)-]?\s*$/;
  const split = stemOf(name).split(' - ').filter((part) => part.trim());
  if (split.length && trackNumber.test(split[0])) split.shift();
  const title = (split.length >= 2 ? split.slice(1).join(' - ') : split[0] ?? '').replace(/^\s*\d{1,4}[.)]\s+/, '').trim();
  // "001. Morgan Wallen - Last Night": the number belongs to the file, not to the artist
  return split.length >= 2
    ? { artist: split[0].replace(/^\s*\d{1,4}[.)]\s+/, '').trim(), title }
    : { artist: 'Unknown artist', title };
}

/** An artist tag that names nobody: written by rippers and players when they did not know. */
const PLACEHOLDER_ARTIST = /^\s*(?:<?unknown(?:\s+artist)?>?|various(?:\s+artists?)?|artist|none|n\/a|-)?\s*$/i;

/** Title and artist to show, from the file's tags where they say something, else from an
 * "Artist - Title" name. A missing or placeholder artist ("Unknown Artist") with a title or file
 * name of that shape is split, so "Adekunle Gold - Call on Me.mp3" is Call on Me by Adekunle Gold
 * rather than the whole name by Unknown Artist. */
export function displayNames(tags: { title?: string; artist?: string }, fileName: string): { title: string; artist: string } {
  const fromName = namesFromFilename(fileName);
  const tagArtist = tags.artist && !PLACEHOLDER_ARTIST.test(tags.artist) ? tags.artist : undefined;
  if (tagArtist) return { title: tags.title ?? fromName.title, artist: tagArtist };
  // the title tag itself may be "Artist - Title" (a tag copied from the file name)
  const fromTitle = tags.title ? namesFromFilename(`${tags.title}.tag`) : null;
  if (fromTitle && fromTitle.artist !== 'Unknown artist') return fromTitle;
  if (fromName.artist !== 'Unknown artist') {
    const stem = stemOf(fileName).trim();
    // a title tag that only repeats the file name is replaced by the split one
    const title = tags.title && tags.title.trim() !== stem ? tags.title : fromName.title;
    return { title, artist: fromName.artist };
  }
  return { title: tags.title ?? fromName.title, artist: 'Unknown artist' };
}

/** The default tag reader: the file's own tags (ID3v2/v1, FLAC, M4A) first, the filename as
 * the fallback. Wrong tags are fine by design (ADR-0458 "metadata lies"): identity rides on
 * the content hash, and display metadata stays editable. */
export const defaultTagReader: TagReader = async (file, known) => {
  const tags = (await readFileTags(file)) ?? {};
  const { title, artist } = displayNames(tags, file.name);
  return {
    title,
    artist,
    ...(tags.album ? { album: tags.album } : {}),
    duration_s: known?.duration_s ?? await probeDuration(file),
    codec: extensionOf(file.name) || undefined,
  };
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

/** `path` is the file's place inside what the member picked (never a full path), for the
 * journal's stable key. */
export type Candidate = {
  name: string;
  path: string;
  /** The file's place including the picked folder's own name, for the fingerprint memo: the same
   * folder picked by a handle or by a plain folder input gives the same place. */
  place: string;
  ref: FileRef;
  open: () => Promise<File>;
  sessionFile?: File;
};

function isDirectorySource(source: ImportSource): source is DirectoryHandleLike {
  return (source as { kind?: string }).kind === 'directory';
}

function isWalkedSource(source: ImportSource): source is WalkedFolder {
  return (source as { kind?: string }).kind === 'walked';
}

async function walk(dir: DirectoryHandleLike, add: (handle: FileHandleLike, path: string) => void, cancelled: () => boolean, prefix = ''): Promise<void> {
  for await (const entry of dir.values()) {
    if (cancelled()) return;
    if (entry.kind === 'directory') await walk(entry, add, cancelled, `${prefix}${entry.name}/`);
    else add(entry, `${prefix}${entry.name}`);
  }
}

export async function collect(source: ImportSource, signal?: AbortSignal): Promise<{ candidates: Candidate[]; skipped: number }> {
  const candidates: Candidate[] = [];
  let skipped = 0;
  const addFile = (file: File) => {
    if (!isAudioName(file.name)) {
      skipped += 1;
      return;
    }
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    candidates.push({ name: file.name, path, place: path, ref: { kind: 'repick', name: file.name, size: file.size }, open: async () => file, sessionFile: file });
  };
  const root = isDirectorySource(source) || isWalkedSource(source) ? `${source.name}/` : '';
  const addHandle = (handle: FileHandleLike, path = handle.name) => {
    if (!isAudioName(handle.name)) {
      skipped += 1;
      return;
    }
    candidates.push({ name: handle.name, path, place: `${root}${path}`, ref: { kind: 'handle', handle }, open: () => handle.getFile() });
  };
  if (isDirectorySource(source)) {
    await walk(source, addHandle, () => signal?.aborted ?? false);
  } else if (isWalkedSource(source)) {
    for (const entry of source.files) addHandle(entry.handle, entry.path);
  } else {
    const items = Array.isArray(source) ? source : Array.from(source);
    for (const item of items as (File | FileHandleLike)[]) {
      if (typeof (item as FileHandleLike).getFile === 'function') addHandle(item as FileHandleLike);
      else addFile(item as File);
    }
  }
  return { candidates, skipped };
}

export function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

/** One file's registration: its content fingerprint and display tags, with blanks recovered
 * locally. Shared by both import paths. */
export async function registrationOf(
  file: File, name: string, readTags: TagReader, signal?: AbortSignal,
  reuse?: { fingerprints: ImportFingerprints; candidate: Pick<Candidate, 'place' | 'open'> },
): Promise<SongRegistration> {
  const fingerprints = reuse?.fingerprints;
  // `library.audio_identity`: the audio id comes from the same read as the file hash
  const audio = flagOn('library.audio_identity');
  const found = fingerprints
    ? await fingerprints.identify(file, reuse.candidate.place, name, reuse.candidate.open, signal, audio)
    : null;
  const direct = found || !audio ? null : await fileIdentity(file, { signal });
  const content_sha256 = found ? found.sha : direct ? direct.sha : await fileSha256(file, { signal });
  const audioId = audio ? (found ? found.audioId : direct?.audioId) : undefined;
  // `library.art_embedded`: the file's own picture becomes its cover later, at idle, on this
  // device only. Queued, never awaited, and it can never fail or slow this import.
  captureArt(file, content_sha256);
  // A duration measured here before for these bytes saves probing the file again; tags are
  // always the account's own, read from its own file (titles never travel by fingerprint).
  const knownDuration = fingerprints ? await fingerprints.knownDuration(content_sha256) : undefined;
  const tagsStarted = Date.now();
  const tags = await readTags(file, knownDuration !== undefined ? { duration_s: knownDuration } : undefined);
  const tagsMs = Date.now() - tagsStarted;
  if (fingerprints && found) {
    const measured = knownDuration === undefined ? tags.duration_s : undefined;
    if (found.how === 'computed') await fingerprints.keepDuration(content_sha256, measured);
    await fingerprints.log(name, file, found, tagsMs, knownDuration !== undefined ? 'reused' : measured && measured > 0 ? 'measured' : 'unknown');
  }
  const normalised = normalise({
    title: tags.title ?? stemOf(name),
    artist: tags.artist ?? 'Unknown artist',
    album: tags.album,
  });
  // Tag readers are allowed to return blank or whitespace-only values. Cloud requires
  // non-empty display metadata, so recover locally instead of turning a readable file
  // into a 422 that rejects its whole registration batch.
  const names = {
    ...normalised,
    title: normalised.title || stemOf(name) || 'Untitled track',
    artist: normalised.artist || 'Unknown artist',
  };
  const codec = tags.codec ?? (extensionOf(name) || undefined);
  const duration = tags.duration_s;
  return {
    content_sha256,
    ...names,
    // A codec the browser cannot probe has an unknown duration, represented by an
    // omitted field. Sending zero would violate the API/DB > 0 invariant and make the
    // otherwise valid import fail.
    ...(duration !== undefined && Number.isFinite(duration) && duration > 0
      ? { duration_s: duration }
      : {}),
    ...(codec ? { codec } : {}),
    ...(tags.sample_rate ? { sample_rate: tags.sample_rate } : {}),
    // a hash, like the file hash: no audio, path or name leaves the device
    ...(audioId && AUDIO_ID_PATTERN.test(audioId) ? { audio_id: audioId } : {}),
  };
}

/** Runs one import. Resolves with an honest summary whatever happened: cancelled, paused on a
 * full store, or finished. Only a failing registration request itself rejects, so the caller
 * can show a retry; everything registered before the failure is already recorded. */
export async function runImport(options: ImportOptions): Promise<ImportSummary> {
  if (options.journal) return runJournalled(options as ImportOptions & { journal: ImportJournal });
  const { source, request, store, deviceId, signal } = options;
  const emit = options.onProgress ?? (() => {});
  const readTags = options.readTags ?? defaultTagReader;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const fingerprints = options.fingerprints ?? null;
  const summary: ImportSummary = { imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false };
  const { candidates, skipped } = await collect(source, signal);
  summary.skipped = skipped;
  emit({ kind: 'collected', total: candidates.length, skipped });
  let flushedOnce = false;

  let batch: { name: string; ref: FileRef; entry: SongRegistration; sessionFile?: File; source?: SongSource }[] = [];

  const flush = async () => {
    if (!batch.length) return;
    const sending = batch;
    batch = [];
    flushedOnce = true;
    for (const item of sending) emit({ kind: 'file', name: item.name, stage: 'registering' });
    const payload = { songs: sending.map((item) => item.entry) };
    assertNoPath(payload);
    const reply = await postJson<{ songs: RegisteredSong[] }>(request, '/api/local-media/songs', payload);
    const byHash = new Map(reply.songs.map((song) => [song.content_sha256, song]));
    const present: number[] = [];
    // A full store stops the batch, but what was recorded before it is still reported as
    // present on this device, so Cloud's availability matches the local index.
    let stopped: unknown = null;
    for (const item of sending) {
      const song = byHash.get(item.entry.content_sha256);
      fingerprints?.landed(item.entry.content_sha256, song?.song_id ?? null, song?.duplicate_of !== undefined);
      if (!song) {
        summary.failed += 1;
        emit({ kind: 'file', name: item.name, stage: 'failed', reason: 'SelectaDJ could not register this track. Try the import again.' });
        continue;
      }
      try {
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
          ...(fingerprints?.isRemembered(item.entry.content_sha256) ? { fingerprint: 'remembered' as const } : {}),
          ...(await keptSources(store, song.song_id, item.source)),
        });
        // Plain inputs and webkitdirectory return File objects, not durable handles. Keep that
        // object reachable for this visit only: it is never written to IndexedDB or sent to Cloud.
        if (item.sessionFile) store.attachSessionFile(song.song_id, item.sessionFile);
      } catch (error) {
        stopped = error;
        break;
      }
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
      await postJson(request, '/api/local-media/availability', availability);
      emit({ kind: 'batch', registered: present.length });
    }
    if (stopped !== null) throw stopped;
  };

  try {
    for (const candidate of candidates) {
      if (signal?.aborted) {
        summary.cancelled = true;
        break;
      }
      emit({ kind: 'file', name: candidate.name, stage: 'hashing' });
      let entry: SongRegistration;
      let source: SongSource | undefined;
      try {
        const file = await candidate.open();
        source = sourceOf(options.folderId, candidate.path, file);
        entry = await registrationOf(file, candidate.name, readTags, signal, fingerprints ? { fingerprints, candidate } : undefined);
      } catch (error) {
        if (isAbort(error)) {
          summary.cancelled = true;
          break;
        }
        summary.failed += 1;
        emit({ kind: 'file', name: candidate.name, stage: 'failed', reason: 'SelectaDJ could not read this file. It stays where it is; nothing was changed.' });
        continue;
      }
      batch.push({ name: candidate.name, ref: candidate.ref, entry, ...(candidate.sessionFile ? { sessionFile: candidate.sessionFile } : {}), ...(source ? { source } : {}) });
      if (batch.length >= (flushedOnce ? batchSize : Math.min(FIRST_BATCH, batchSize))) await flush();
    }
    if (!summary.cancelled) await flush();
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    summary.paused = true;
    emit({ kind: 'paused', paused: 'storage_full' });
  }
  settleFingerprints(fingerprints, summary, store);
  emit({ kind: 'finished', ...summary });
  return summary;
}

/** The end of an import's fingerprint run: the reuse counts for the summary, the log's totals,
 * and the background sample check of remembered files (the memo rule). */
export function settleFingerprints(fingerprints: ImportFingerprints | null, summary: ImportSummary, store: MediaStore): void {
  if (!fingerprints) return;
  summary.reuse = fingerprints.reuse();
  fingerprints.finish();
  void fingerprints.sampleCheck(store).catch(() => undefined);
}

/** Starts loading the fingerprinting code now, so an import begun later (or carried on while
 * offline) never waits on a network fetch for it. Safe to call any number of times. */
export function preloadImportCode(): void {
  void import('@noble/hashes/sha2.js').catch(() => undefined);
}
