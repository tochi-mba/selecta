import { assertNoPath } from './identity';
import {
  BATCH_SIZE, collect, defaultTagReader, FIRST_BATCH, isAbort, keptSources, noteSource, postJson, registrationOf, settleFingerprints, sourceOf,
  type Candidate, type ImportOptions, type ImportSummary, type ImportWait, type RegisteredSong, type RetryPolicy, type SongRegistration,
} from './importer';
import { fileKey, type ImportJournal, type JournalRow } from './importJournal';
import { isQuotaError, type SongSource } from './store';

// The journalled import (flag `cloud.resilient_import`), the path `runImport` takes when given a
// journal. Reading and sending run side by side: each file is fingerprinted and written to the
// journal before anything goes over the network, so reading carries on while the connection is
// down, and batches are sent from what the journal holds, with patient retries. A file an
// interrupted run already fingerprinted is never read again.

/** Fired on `window` to make a waiting import try again at once ("Try now"). */
export const IMPORT_RETRY_NOW = 'selecta:import-retry-now';

export type FailureKind = 'offline' | 'server' | 'signin' | 'refused' | 'abort';

/** What kind of failure a request met, from what the error carries; no message is shown. */
export function failureKind(error: unknown): FailureKind {
  if (isAbort(error)) return 'abort';
  const named = (error as { name?: string; constructor?: { name?: string } } | null);
  if (named && (named.name === 'LoginRequiredError' || named.constructor?.name === 'LoginRequiredError')) return 'signin';
  const status = typeof (error as { status?: unknown } | null)?.status === 'number' ? (error as { status: number }).status : null;
  if (status === null) {
    // fetch rejects with a TypeError when there is no answer at all; anything else unknown is
    // treated the same way, since retrying a request that never arrived is harmless
    return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'server';
  }
  if (status === 401) return 'signin';
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'server';
  return 'refused';
}

const FIRST_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;
/** While offline, try anyway this often: `navigator.onLine` can be wrong in both directions. */
const OFFLINE_PROBE_MS = 30_000;

/** Resolves after `ms`, or sooner on reconnect, the page becoming visible, or "Try now";
 * rejects with an AbortError if `signal` fires. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('The import was stopped.', 'AbortError')); return; }
    const hasWindow = typeof window !== 'undefined';
    const done = () => { cleanup(); resolve(); };
    const visible = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') done(); };
    const aborted = () => { cleanup(); reject(new DOMException('The import was stopped.', 'AbortError')); };
    const timer = setTimeout(done, ms);
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      if (hasWindow) {
        window.removeEventListener('online', done);
        window.removeEventListener(IMPORT_RETRY_NOW, done);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
      }
    }
    signal?.addEventListener('abort', aborted);
    if (hasWindow) {
      window.addEventListener('online', done);
      window.addEventListener(IMPORT_RETRY_NOW, done);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
    }
  });
}

/** The import's own patient retry: capped exponential backoff with jitter, waiting for the
 * connection while offline, never giving up on a failure that passes. The member can always
 * cancel; a refusal that would only repeat (a 4xx) is rethrown at once. */
export const patientRetry: RetryPolicy = async (work, { signal, onWait } = {}) => {
  let attempt = 0;
  let waited = false;
  for (;;) {
    try {
      const result = await work();
      if (waited) onWait?.(null);
      return result;
    } catch (error) {
      const kind = failureKind(error);
      if (kind === 'abort' || kind === 'refused') throw error;
      if (signal?.aborted) throw new DOMException('The import was stopped.', 'AbortError');
      waited = true;
      if (kind === 'offline') {
        onWait?.({ why: 'offline', retryAt: null });
        await pause(OFFLINE_PROBE_MS, signal);
        continue;
      }
      const base = Math.min(MAX_DELAY_MS, FIRST_DELAY_MS * 2 ** attempt);
      const delay = Math.round(base * (0.75 + Math.random() * 0.5));
      attempt += 1;
      onWait?.({ why: kind === 'signin' ? 'signin' : 'server', retryAt: Date.now() + delay });
      await pause(delay, signal);
    }
  }
};

type Pending = { name: string; key: string; ref: Candidate['ref']; entry: SongRegistration; sessionFile?: File; source?: SongSource };

function newImportId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function runJournalled(options: ImportOptions & { journal: ImportJournal }): Promise<ImportSummary> {
  const { source, request, store, journal, signal } = options;
  const emit = options.onProgress ?? (() => {});
  const readTags = options.readTags ?? defaultTagReader;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const retry = options.retry ?? patientRetry;
  const importId = options.importId ?? newImportId();
  const fingerprints = options.fingerprints ?? null;
  const reportDevice = options.reportDevice ?? (() => options.deviceId);
  const summary: ImportSummary = { imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false };
  const { candidates, skipped } = await collect(source, signal);
  summary.skipped = skipped;
  emit({ kind: 'collected', total: candidates.length, skipped });

  const pending: Pending[] = [];
  let producing = true;
  let flushedOnce = false;
  let fatal: unknown = null;
  let stopped = false;
  let sender: Promise<void> | null = null;
  /** Songs saved here whose availability report has not reached Cloud yet. */
  const unreported = new Set<number>();
  let waitingNow: ImportWait | null = null;
  const onWait = (wait: ImportWait | null) => {
    waitingNow = wait;
    emit({ kind: 'waiting', wait });
  };

  const done = (name: string, song: { song_id: number; duplicate_of?: number }) => {
    if (song.duplicate_of !== undefined) {
      summary.duplicates += 1;
      emit({ kind: 'file', name, stage: 'done', songId: song.song_id, duplicateOf: song.duplicate_of });
    } else {
      summary.imported += 1;
      emit({ kind: 'file', name, stage: 'done', songId: song.song_id });
    }
  };

  /** Never fatal: availability waits for a registered device and is retried after each batch;
   * whatever is left is reconciled by the shell's own periodic report. */
  const reportAvailability = async () => {
    const device = reportDevice();
    if (!device || !unreported.size) return;
    const present = [...unreported];
    const availability = { device_id: device, present, absent: [] as number[] };
    assertNoPath(availability);
    try {
      await postJson(request, '/api/local-media/availability', availability);
      for (const id of present) unreported.delete(id);
    } catch { /* tried again after the next batch */ }
  };

  const saveLocally = async (item: Pending, song: RegisteredSong) => {
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
    if (item.sessionFile) store.attachSessionFile(song.song_id, item.sessionFile);
  };

  const sendBatch = async (sending: Pending[]) => {
    flushedOnce = true;
    for (const item of sending) emit({ kind: 'file', name: item.name, stage: 'registering' });
    const payload = { songs: sending.map((item) => item.entry) };
    assertNoPath(payload);
    const reply = await retry(() => postJson<{ songs: RegisteredSong[] }>(request, '/api/local-media/songs', payload), { signal, onWait });
    if (waitingNow) onWait(null);
    const byHash = new Map(reply.songs.map((song) => [song.content_sha256, song]));
    const at = Date.now();
    await journal.put(sending.flatMap((item): JournalRow[] => {
      const song = byHash.get(item.entry.content_sha256);
      return song ? [{ key: item.key, importId, name: item.name, state: 'registered', entry: item.entry, songId: song.song_id, ...(song.duplicate_of !== undefined ? { duplicateOf: song.duplicate_of } : {}), at }] : [];
    }));
    const saved: JournalRow[] = [];
    let full: unknown = null;
    for (const item of sending) {
      const song = byHash.get(item.entry.content_sha256);
      fingerprints?.landed(item.entry.content_sha256, song?.song_id ?? null, song?.duplicate_of !== undefined);
      if (!song) {
        summary.failed += 1;
        emit({ kind: 'file', name: item.name, stage: 'failed', reason: 'SelectaDJ could not add this song to your library. Try the import again.' });
        continue;
      }
      try {
        await saveLocally(item, song);
      } catch (error) {
        full = error;
        break;
      }
      saved.push({ key: item.key, importId, name: item.name, state: 'saved', entry: item.entry, songId: song.song_id, ...(song.duplicate_of !== undefined ? { duplicateOf: song.duplicate_of } : {}), at });
      unreported.add(song.song_id);
      done(item.name, song);
    }
    try { await journal.put(saved); } catch (error) { full ??= error; }
    if (saved.length) {
      await reportAvailability();
      emit({ kind: 'batch', registered: saved.length });
    }
    if (full !== null) throw full;
  };

  const sendLoop = async () => {
    while (!stopped && !fatal && !signal?.aborted) {
      const threshold = flushedOnce ? batchSize : Math.min(FIRST_BATCH, batchSize);
      if (!pending.length || (producing && pending.length < threshold)) return;
      const sending = pending.slice(0, batchSize);
      try {
        await sendBatch(sending);
      } catch (error) {
        // a stop may carry its own reason (a pause for sign-in) rather than an AbortError
        if (isAbort(error) || signal?.aborted) return;
        if (isQuotaError(error)) stopped = true;
        fatal = error;
        return;
      }
      pending.splice(0, sending.length);
    }
  };
  const kick = () => {
    if (!sender) sender = sendLoop().finally(() => { sender = null; });
  };
  const drain = async () => {
    for (;;) {
      kick();
      const running = sender;
      if (!running) return;
      await running;
      if (stopped || fatal || signal?.aborted || !pending.length) return;
    }
  };

  // Keys already queued this run, so a file listed twice is sent once.
  const owed = new Set<string>();
  const queue = (key: string, name: string, entry: SongRegistration, candidate: Candidate, source: SongSource | undefined) => {
    owed.add(key);
    pending.push({ name, key, ref: candidate.ref, entry, ...(candidate.sessionFile ? { sessionFile: candidate.sessionFile } : {}), ...(source ? { source } : {}) });
  };

  try {
    for (const candidate of candidates) {
      if (signal?.aborted) { summary.cancelled = true; break; }
      if (stopped || fatal) break;
      emit({ kind: 'file', name: candidate.name, stage: 'hashing' });
      let file: File;
      try {
        file = await candidate.open();
      } catch (error) {
        if (isAbort(error)) { summary.cancelled = true; break; }
        summary.failed += 1;
        emit({ kind: 'file', name: candidate.name, stage: 'failed', reason: 'SelectaDJ could not read this file. It stays where it is; nothing was changed.' });
        emit({ kind: 'checked', name: candidate.name, resumed: false });
        continue;
      }
      const key = fileKey(candidate.path, file.size, file.lastModified);
      const source = sourceOf(options.folderId, candidate.path, file);
      const known = journal.get(key);
      if (known?.state === 'saved' && known.songId !== undefined && (await store.get(known.songId))) {
        // done by an earlier run: nothing to read or send; a re-picked file is reachable again
        if (candidate.sessionFile) store.attachSessionFile(known.songId, candidate.sessionFile);
        await noteSource(store, known.songId, source);
        unreported.add(known.songId);
        emit({ kind: 'checked', name: candidate.name, resumed: true });
        done(candidate.name, { song_id: known.songId, ...(known.duplicateOf !== undefined ? { duplicate_of: known.duplicateOf } : {}) });
        continue;
      }
      if (owed.has(key)) continue;
      if (known) {
        // fingerprinted by an earlier run but not confirmed (Cloud's registration is idempotent
        // by fingerprint): send it again without reading the file again
        queue(key, candidate.name, known.entry, candidate, source);
        emit({ kind: 'checked', name: candidate.name, resumed: true });
        kick();
        continue;
      }
      let entry: SongRegistration;
      try {
        entry = await registrationOf(file, candidate.name, readTags, signal, fingerprints ? { fingerprints, candidate } : undefined);
      } catch (error) {
        if (isAbort(error)) { summary.cancelled = true; break; }
        summary.failed += 1;
        emit({ kind: 'file', name: candidate.name, stage: 'failed', reason: 'SelectaDJ could not read this file. It stays where it is; nothing was changed.' });
        emit({ kind: 'checked', name: candidate.name, resumed: false });
        continue;
      }
      // written down before any network call: an interruption from here on loses nothing
      await journal.put([{ key, importId, name: candidate.name, state: 'fingerprinted', entry, at: Date.now() }]);
      queue(key, candidate.name, entry, candidate, source);
      emit({ kind: 'checked', name: candidate.name, resumed: false });
      kick();
    }
    producing = false;
    emit({ kind: 'read' });
    if (!summary.cancelled) await drain();
    if (signal?.aborted) summary.cancelled = true;
    if (fatal !== null) throw fatal;
    await reportAvailability();
  } catch (error) {
    producing = false;
    if (sender) await sender;
    if (isAbort(error) || signal?.aborted) summary.cancelled = true;
    else if (!isQuotaError(error)) throw error;
    else {
      summary.paused = true;
      emit({ kind: 'paused', paused: 'storage_full' });
    }
  }
  settleFingerprints(fingerprints, summary, store);
  emit({ kind: 'finished', ...summary });
  return summary;
}
