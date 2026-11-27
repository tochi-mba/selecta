import { flagOn } from '../flags';
import { fileSha256 } from '../media/identity';
import type { MediaStore, StoredSong } from '../media/store';
import type { Api } from './api';
import { notify, showTitle } from './backgroundImport';
import { bindCloudOnly, switchToCloudOnly } from './cloudOnly';
import { UploadJournal, type UploadOutcome, type UploadRow, type UploadStopWhy } from './cloudUploadJournal';
import { batteryLow, browserPacing, guardUnload, heldElsewhere, holdScreen, metered, watchDevice, type Pacing } from './cloudUploadPacing';
import { uploadWords } from './cloudUploadWords';
import { RESUMABLE, resumableFor, sendParts, unfinishedUploads, type UploadDone, type UploadEntry, type UploadSession, type UploadStatus } from './uploadParts';

// Uploading songs from this device to the cloud library (`cloud.move_to_cloud`, plan 6b).
//
// The queue lives outside React, as the device import does (importSession.ts): the consent sheet
// and the entry points call `startUpload`, the chip subscribes, and a journal in IndexedDB carries
// it on after a reload. One tab runs it under a Web Lock; the others follow over a BroadcastChannel
// and take over when that tab closes. One file at a time, up to three parts in flight (one after a
// failed part, or while this device plays music). Songs are read and planned in batches of at
// most 100, so the storage holds a plan makes are used well inside their two days.
//
// For each song: its file is read and hashed again (different bytes: "changed on this device
// since it was added", nothing is sent), the batch is previewed, planned with the song's id, its
// parts sent and the upload completed. Only when the server accepted it for this very song, and
// the member chose cloud only (the default), does the song leave this device's list
// (cloudOnly.ts); the member's file is never touched. Nothing is previewed, planned or sent
// before the consent module says the member agreed to the statement (`hasUploadConsent`).

export const PLAN_BATCH = 100;
export const PARTS_IN_FLIGHT = 3;
/** A plan's storage hold lasts two days (storage/uploads.py SESSION_TTL). */
export const HOLD_MS = 2 * 24 * 3600_000;
/** A hold this close to lapsing is planned again rather than raced. */
const HOLD_MARGIN_MS = 30 * 60_000;
/** How often a wait for the battery, the network or Wi-Fi looks again by itself. */
const DEVICE_POLL_MS = 60_000;
/** The availability report after songs switch to cloud only goes at most this often. */
const REPORT_EVERY_MS = 15_000;
/** A song planned again this many times is refused rather than tried for ever. */
const PLAN_AGAIN_MAX = 4;
/** An upload that ran this long is worth a notification when it finishes out of sight. */
export const LONG_UPLOAD_MS = 60_000;

export type UploadQueueParts = {
  storageRevision?: number;
  workspaceId: string;
  api: Api;
  openStore: () => Promise<MediaStore>;
  /** The consent module's answer (plan 6c): the member agreed to the upload statement for this
   * workspace. Injected, so this module never draws or records consent itself. */
  hasUploadConsent: (workspaceId: string) => Promise<boolean>;
  /** Song ids of the current and recent mixes, most important first: they upload first. */
  mixSongs?: () => readonly number[];
  /** Whether this device is playing music now: parts then go one at a time. */
  playing?: () => boolean;
  /** Tell the account what this device holds now (a fresh availability report). */
  onAvailabilityChanged?: () => void | Promise<void>;
  /** The presigned part PUTs; the browser's fetch by default. */
  fetchImpl?: typeof fetch;
  hash?: (file: Blob) => Promise<string>;
  pacing?: Partial<Pacing>;
  /** How long to wait before trying a failed song again, by its count of tries. */
  retryDelay?: (tries: number) => number;
};

export type UploadPhase = 'idle' | 'running' | 'paused' | 'asking' | 'stopped' | 'finished';
/** Why the queue waits: the member paused it, the battery is low, there is no connection, it
 * waits for Wi-Fi, or a failed part is being tried again. */
export type UploadWait = 'member' | 'battery' | 'offline' | 'wifi' | 'server';

export type UploadSnapshot = {
  workspaceId: string | null;
  phase: UploadPhase;
  /** Another tab of this browser runs the queue; this one follows it. */
  elsewhere: boolean;
  total: number;
  settled: number;
  counts: Readonly<Record<UploadOutcome, number>>;
  /** Waiting for their files to be chosen again (browsers that cannot read a file twice). */
  choose: readonly { songId: number; name: string; size: number | null }[];
  current: { songId: number; title: string; stage: 'checking' | 'sending'; partsDone: number; partCount: number | null } | null;
  /** Bytes still to send, as far as they are known. */
  bytesLeft: number;
  waiting: UploadWait | null;
  stop: UploadStopWhy | null;
  /** The one question: send over mobile data now, or wait for Wi-Fi. */
  ask: { kind: 'mobile_data'; bytes: number } | null;
  cancelled: boolean;
  /** The queue's state in plain words, for the chip. */
  words: string;
};

const NO_COUNTS: Record<UploadOutcome, number> = Object.freeze({ uploaded: 0, in_cloud_library: 0, refused: 0, changed: 0, choose_again: 0, permission_again: 0, removed: 0 });

export const IDLE_UPLOADS: UploadSnapshot = Object.freeze({
  workspaceId: null, phase: 'idle', elsewhere: false, total: 0, settled: 0, counts: NO_COUNTS, choose: [], current: null,
  bytesLeft: 0, waiting: null, stop: null, ask: null, cancelled: false, words: '',
});

// --- the queue's state ----------------------------------------------------------------------

let parts: UploadQueueParts | null = null;
let journal: UploadJournal | null = null;
let snapshot: UploadSnapshot = IDLE_UPLOADS;
const listeners = new Set<() => void>();
/** What only this tab knows while it runs the queue. */
let live: { waiting: UploadWait | null; ask: UploadSnapshot['ask']; current: UploadSnapshot['current'] } = { waiting: null, ask: null, current: null };
let running: { controller: AbortController; sending: AbortController | null } | null = null;
let claiming: Promise<void> | null = null;
let claimStop: AbortController | null = null;
let following: (() => void) | null = null;
let line: BroadcastChannel | null = null;
/** Files read and hashed to the song this visit, by song id: never kept past the visit. */
const verified = new Map<number, File>();
const tries = new Map<number, number>();
const plannedAgain = new Map<number, number>();
let hadError = false;
let nudgeNow: (() => void) | null = null;
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let startedAt = 0;

const pace = (): Pacing => ({ ...browserPacing, ...(parts?.pacing ?? {}) });
function queueScope(own: UploadQueueParts): string {
  return own.storageRevision === undefined ? own.workspaceId : `${own.workspaceId}/${own.storageRevision}`;
}

const lockName = (workspaceId: string) => `selecta-cloud-uploads:${workspaceId}`;

export function uploadSnapshot(): UploadSnapshot {
  return snapshot;
}

export function subscribeUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Every song in the queue, in order, for View. */
export function uploadRows(): readonly UploadRow[] {
  return journal?.all() ?? [];
}

/** Songs this device uploaded and kept playing from here too: the other-devices question
 * (cloudOnly.ts) leaves them out. */
export function uploadedHereKeepingCopies(): ReadonlySet<number> {
  return new Set(uploadRows().filter((row) => row.keepHere && (row.outcome === 'uploaded' || row.outcome === 'in_cloud_library')).map((row) => row.songId));
}

function publish(next: UploadSnapshot): void {
  snapshot = next;
  if (running && line && !next.elsewhere) share(next);
  for (const listen of listeners) listen();
}

/** Work the snapshot out again from the journal and what this tab knows. */
function refresh(change: Partial<typeof live> = {}): void {
  live = { ...live, ...change };
  const j = journal;
  if (!j || following) return;
  const rows = j.all();
  const counts = { ...NO_COUNTS };
  let bytesLeft = 0;
  for (const row of rows) {
    if (row.outcome) counts[row.outcome] += 1;
    if (row.state !== 'done') bytesLeft += Math.max(0, (row.size ?? 0) - row.partsDone * (row.partSize ?? 0));
  }
  const choose = rows.filter((row) => row.state !== 'done' && row.choose).map((row) => ({ songId: row.songId, name: row.fileName, size: row.size }));
  const left = rows.filter((row) => row.state !== 'done' && !row.choose).length;
  const meta = j.meta;
  const phase: UploadPhase = !rows.length ? 'idle'
    : meta.cancelled ? 'finished'
      : meta.stopped ? 'stopped'
        : live.ask && running ? 'asking'
          : meta.paused || (live.waiting && live.waiting !== 'server') ? 'paused'
            : left === 0 ? 'finished'
              : 'running';
  const next: UploadSnapshot = {
    workspaceId: j.workspaceId, phase, elsewhere: false, total: rows.length, settled: rows.filter((row) => row.state === 'done').length,
    counts, choose, current: phase === 'running' ? live.current : null, bytesLeft,
    waiting: meta.paused ? 'member' : live.waiting, stop: meta.stopped, ask: phase === 'asking' ? live.ask : null, cancelled: meta.cancelled, words: '',
  };
  publish({ ...next, words: uploadWords(next) });
}

// --- tabs ---------------------------------------------------------------------------------------

type Message =
  | { type: 'snapshot'; snapshot: UploadSnapshot }
  | { type: 'hello' }
  | { type: 'command'; command: Command }
  | { type: 'files'; files: File[] }
  | { type: 'reload' };
type Command = 'pause' | 'resume' | 'cancel' | 'mobile_now' | 'wifi';

function openLine(workspaceId: string): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(lockName(workspaceId)) : null;
  } catch {
    return null;
  }
}

let lastShared = 0;
let shareTimer: ReturnType<typeof setTimeout> | null = null;
function share(next: UploadSnapshot): void {
  const send = () => {
    shareTimer = null;
    lastShared = Date.now();
    try { line?.postMessage({ type: 'snapshot', snapshot } satisfies Message); } catch { /* a closed channel */ }
  };
  if (next.phase !== 'running' || Date.now() - lastShared >= 250) send();
  else shareTimer ??= setTimeout(send, 250);
}

function post(message: Message): void {
  const own = parts;
  if (!own) return;
  const out = openLine(queueScope(own));
  try { out?.postMessage(message); } catch { /* closed */ }
  try { out?.close(); } catch { /* closed */ }
}

/** Follow the tab that runs the queue: its snapshots arrive here. */
function follow(workspaceId: string): void {
  if (following) return;
  const heard = openLine(workspaceId);
  if (!heard) return;
  heard.onmessage = (event: MessageEvent<Message>) => {
    if (event.data?.type === 'snapshot' && !running) {
      snapshot = { ...event.data.snapshot, elsewhere: true };
      for (const listen of listeners) listen();
    }
  };
  try { heard.postMessage({ type: 'hello' } satisfies Message); } catch { /* closed */ }
  following = () => { try { heard.close(); } catch { /* closed */ } };
}

function stopFollowing(): void {
  following?.();
  following = null;
}

/** The runner's ears: a follower's press, files chosen there, songs it added. */
function hear(own: UploadQueueParts): void {
  line = openLine(queueScope(own));
  if (!line) return;
  line.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (message?.type === 'hello') share(snapshot);
    else if (message?.type === 'command') void obey(message.command);
    else if (message?.type === 'files') void chooseFilesAgain(message.files);
    else if (message?.type === 'reload') void journal?.reload().then(() => { refresh(); nudge(); });
  };
}

/** Become the tab that uploads for this workspace, following another tab until it lets go. */
function claim(): Promise<void> {
  const own = parts;
  if (!own) return Promise.resolve();
  if (claiming) return claiming;
  const manager = pace().locks();
  claiming = (async () => {
    if (!manager) { await runHeld(own); return; }
    const stop = new AbortController();
    claimStop = stop;
    if (await heldElsewhere(manager, lockName(queueScope(own)))) follow(queueScope(own));
    try {
      await manager.request(lockName(queueScope(own)), { signal: stop.signal }, async () => {
        stopFollowing();
        if (parts === own) await runHeld(own);
      });
    } catch { /* stopped waiting: the shell went away */ }
  })().finally(() => {
    claiming = null;
    claimStop = null;
    // songs that arrived as the run was ending (files chosen again, say) get a run of their own
    if (again && parts === own) { again = false; void claim(); }
  });
  return claiming;
}

/** Set when a run ended with songs still to do that were not stopped, paused or cancelled. */
let again = false;

// --- running ------------------------------------------------------------------------------------

/** Nudges so far: a wait that began after a look at the device misses none that came between. */
let nudges = 0;

function nudge(): void {
  nudges += 1;
  nudgeNow?.();
}

/** Wait until nudged (since `since`), `ms` passes or the run stops. */
function rest(signal: AbortSignal, ms: number, since = nudges): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || nudges !== since) { resolve(); return; }
    const done = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', done);
      if (nudgeNow === done) nudgeNow = null;
      resolve();
    };
    const timer = Number.isFinite(ms) ? setTimeout(done, ms) : undefined;
    nudgeNow = done;
    signal.addEventListener('abort', done);
  });
}

async function runHeld(own: UploadQueueParts): Promise<void> {
  if (parts !== own || running) return;
  const j = journal;
  if (!j) return;
  await j.reload();
  const controller = new AbortController();
  running = { controller, sending: null };
  hadError = false;
  startedAt = Date.now();
  hear(own);
  const stops = [
    guardUnload(() => snapshot.phase === 'running' && running?.controller === controller),
    holdScreen(pace()),
    watchDevice(pace(), nudge),
  ];
  let ended = false;
  try {
    await loop(own, j, controller.signal);
    ended = true;
  } catch {
    // every song settles its own trouble; anything else simply ends this run
  } finally {
    for (const stop of stops) stop();
    const meta = j.meta;
    again = ended && parts === own && !controller.signal.aborted && !meta.stopped && !meta.cancelled && !meta.paused
      && j.all().some((row) => row.state !== 'done' && !row.choose);
    running = null;
    try { line?.close(); } catch { /* closed */ }
    line = null;
    reportNow(own);
    refresh({ waiting: null, ask: null, current: null });
  }
}

/** Nothing is planned or sent before the member agreed to the statement: asked when a run
 * starts and again before each batch is planned. */
async function consented(own: UploadQueueParts, j: UploadJournal): Promise<boolean> {
  if (await own.hasUploadConsent(own.workspaceId).catch(() => false)) return true;
  await stopRun(j, 'consent');
  return false;
}

async function loop(own: UploadQueueParts, j: UploadJournal, signal: AbortSignal): Promise<void> {
  if (!(await consented(own, j))) return;
  while (!signal.aborted && parts === own) {
    if (j.meta.stopped || j.meta.cancelled) { refresh(); return; }
    if (!flagOn('cloud.move_to_cloud')) { await stopRun(j, 'grant'); return; }
    const next = j.all().find((row) => row.state !== 'done' && !row.choose);
    if (!next) { await finish(own, j); return; }
    const since = nudges;
    const wait = await waitFor(own, j);
    if (wait) {
      refresh({ waiting: wait.why, ask: wait.ask ?? null, current: null });
      await rest(signal, wait.ms, since);
      continue;
    }
    if (live.waiting || live.ask) refresh({ waiting: null, ask: null });
    if (next.state !== 'waiting') await sendOne(own, j, next, signal);
    else if (await consented(own, j)) await planBatch(own, j, signal);
    else return;
  }
}

async function waitFor(own: UploadQueueParts, j: UploadJournal): Promise<{ why: UploadWait; ms: number; ask?: UploadSnapshot['ask'] } | null> {
  const meta = j.meta;
  const pacing = pace();
  if (meta.paused) return { why: 'member', ms: Number.POSITIVE_INFINITY };
  if (!pacing.online()) return { why: 'offline', ms: DEVICE_POLL_MS };
  if (batteryLow(await pacing.battery())) return { why: 'battery', ms: DEVICE_POLL_MS };
  if (metered(pacing.connection()) && !meta.meteredOk) {
    if (meta.wifiWait) return { why: 'wifi', ms: DEVICE_POLL_MS };
    return { why: 'wifi', ms: DEVICE_POLL_MS, ask: { kind: 'mobile_data', bytes: await bytesToSend(own, j) } };
  }
  return null;
}

/** The bytes still to send, reading a file's size (never its bytes) where it is not known yet. */
async function bytesToSend(own: UploadQueueParts, j: UploadJournal): Promise<number> {
  const store = await own.openStore();
  let total = 0;
  for (const row of j.all()) {
    if (row.state === 'done') continue;
    let size = row.size;
    if (size === null) {
      const song = await store.get(row.songId);
      if (song?.ref.kind === 'handle') size = await song.ref.handle.getFile().then((file) => file.size, () => null);
    }
    total += Math.max(0, (size ?? 0) - row.partsDone * (row.partSize ?? 0));
  }
  return total;
}

type Read = { kind: 'ready'; file: File; row: UploadRow } | { kind: 'settled' } | { kind: 'choose' };

const denied = (error: unknown) => ['NotAllowedError', 'SecurityError'].includes((error as { name?: string } | null)?.name ?? '');

/** Read the song's file and hash it against the song: the same bytes, or the song settles. */
async function readChecked(own: UploadQueueParts, j: UploadJournal, store: MediaStore, row: UploadRow): Promise<Read> {
  const song = await store.get(row.songId);
  if (!song) {
    // taken out of SelectaDJ while it waited (its hold is let go), or already cloud only
    await settle(own, j, row, store.isCloudOnly(row.songId) ? 'in_cloud_library' : 'removed', null);
    return { kind: 'settled' };
  }
  const known = verified.get(row.songId);
  if (known) return { kind: 'ready', file: known, row };
  let file: File;
  const given = store.sessionFile(row.songId);
  if (given) file = given;
  else if (song.ref.kind === 'repick') {
    await j.put({ ...row, choose: true });
    refresh();
    return { kind: 'choose' };
  } else {
    try {
      file = await song.ref.handle.getFile();
    } catch (error) {
      await settle(own, j, row, denied(error) ? 'permission_again' : 'choose_again', null);
      return { kind: 'settled' };
    }
  }
  let sha: string;
  try {
    sha = await (own.hash ?? fileSha256)(file);
  } catch (error) {
    await settle(own, j, row, denied(error) ? 'permission_again' : 'choose_again', null);
    return { kind: 'settled' };
  }
  if (sha !== row.sha) {
    await settle(own, j, row, 'changed', null);
    return { kind: 'settled' };
  }
  verified.set(row.songId, file);
  const next = row.size === file.size ? row : { ...row, size: file.size };
  if (next !== row) await j.put(next);
  return { kind: 'ready', file, row: next };
}

type PreviewAnswer = { files: { index: number; song_id: number | null; status: 'ok' | 'in_cloud_library' | 'refused'; reason: string | null }[] };

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Read, preview and plan the next songs, at most PLAN_BATCH of them. */
async function planBatch(own: UploadQueueParts, j: UploadJournal, signal: AbortSignal): Promise<void> {
  const store = await own.openStore();
  const batch = j.all().filter((row) => row.state === 'waiting' && !row.choose).slice(0, PLAN_BATCH);
  const ready: { row: UploadRow; file: File }[] = [];
  for (const [at, row] of batch.entries()) {
    if (signal.aborted || j.meta.paused) return;
    refresh({ current: { songId: row.songId, title: row.title, stage: 'checking', partsDone: at, partCount: batch.length } });
    const read = await readChecked(own, j, store, row);
    if (read.kind === 'ready') ready.push({ row: read.row, file: read.file });
  }
  if (!ready.length || signal.aborted || j.meta.paused) return;
  // a session an earlier run planned but never wrote down (a stop between the answer and the
  // journal) is carried on rather than planned twice
  const open = await unfinishedUploads(own.api, own.workspaceId).catch(() => [] as UploadSession[]);
  const fresh: typeof ready = [];
  for (const one of ready) {
    const earlier = resumableFor(open, { size: one.file.size, sha256: one.row.sha });
    if (earlier && (earlier.song_id === undefined || earlier.song_id === one.row.songId)) await j.put(planned(one.row, earlier));
    else fresh.push(one);
  }
  if (!fresh.length) return;
  let preview: PreviewAnswer;
  try {
    preview = await own.api<PreviewAnswer>('/uploads/preview', json({ files: fresh.map(({ row, file }) => ({
      name: row.fileName, size: file.size, sha256: row.sha, song_id: row.songId, ...(row.duration ? { duration: row.duration } : {}),
    })) }), own.workspaceId);
  } catch (error) {
    await trouble(own, j, error, null);
    return;
  }
  const toPlan: typeof fresh = [];
  let full = false;
  for (const answer of preview.files) {
    const one = fresh[answer.index];
    if (!one || full) continue;
    if (answer.status === 'in_cloud_library') await settle(own, j, one.row, 'in_cloud_library', null, answer.song_id === one.row.songId);
    else if (answer.status === 'refused' && answer.reason === 'quota') full = true;
    else if (answer.status === 'refused') await settle(own, j, one.row, 'refused', answer.reason);
    else toPlan.push(one);
  }
  if (toPlan.length) await plan(own, j, toPlan);
  // the first file that won't fit stops the queue; what fitted before it is sent first
  else if (full) await stopRun(j, 'quota');
}

async function plan(own: UploadQueueParts, j: UploadJournal, list: { row: UploadRow; file: File }[]): Promise<void> {
  let answer: { uploads: UploadEntry[] };
  try {
    answer = await own.api<{ uploads: UploadEntry[] }>('/uploads/plan', json({ files: list.map(({ row, file }) => ({
      name: row.fileName, size: file.size, sha256: row.sha, song_id: row.songId, ...(file.type ? { content_type: file.type } : {}),
    })) }), own.workspaceId);
  } catch (error) {
    await trouble(own, j, error, null);
    return;
  }
  for (const entry of answer.uploads) {
    const one = list[entry.index];
    if (!one) continue;
    const row = j.get(one.row.songId) ?? one.row;
    if (entry.refused || !entry.session) { await settle(own, j, row, 'refused', entry.refusal_code ?? entry.refused ?? 'not_started'); continue; }
    if (entry.duplicate_of) {
      // a copy is already stored: this session is let go, and the song is left as it is here
      forget(own, entry.session.id);
      await settle(own, j, row, 'in_cloud_library', null);
      continue;
    }
    let session = entry.session;
    if (entry.same_as) { forget(own, session.id); session = { ...session, id: entry.same_as }; }
    await j.put(planned(row, session));
  }
}

function planned(row: UploadRow, session: UploadSession): UploadRow {
  return {
    ...row, state: 'planned', sessionId: session.id, plannedAt: Date.now(),
    expiresAt: typeof session.expires_at === 'number' ? session.expires_at * 1000 : null,
    partCount: session.part_count, partSize: session.part_size, partsDone: 0,
  };
}

function lapsed(row: UploadRow, now = Date.now()): boolean {
  const until = row.expiresAt ?? (row.plannedAt !== null ? row.plannedAt + HOLD_MS : null);
  return until !== null && now > until - HOLD_MARGIN_MS;
}

/** Let go of a session and its storage hold; best effort, the server lets it lapse anyway. */
function forget(own: UploadQueueParts, sessionId: string): void {
  void own.api(`/uploads/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }, own.workspaceId).catch(() => undefined);
}

/** Back to waiting, to be planned afresh; refused after PLAN_AGAIN_MAX tries. */
async function planAgain(own: UploadQueueParts, j: UploadJournal, row: UploadRow): Promise<void> {
  const count = (plannedAgain.get(row.songId) ?? 0) + 1;
  plannedAgain.set(row.songId, count);
  if (count > PLAN_AGAIN_MAX) { await settle(own, j, row, 'refused', 'not_started'); return; }
  await j.put({ ...row, state: 'waiting', sessionId: null, plannedAt: null, expiresAt: null, partsDone: 0, partCount: null, partSize: null });
}

async function sendOne(own: UploadQueueParts, j: UploadJournal, row: UploadRow, signal: AbortSignal): Promise<void> {
  if (!row.sessionId || lapsed(row)) {
    // a hold past its two days (a queue left for a long while): planned again
    if (row.sessionId) forget(own, row.sessionId);
    await planAgain(own, j, row);
    return;
  }
  const store = await own.openStore();
  const read = await readChecked(own, j, store, row);
  if (read.kind !== 'ready') return;
  const { file } = read;
  let status: UploadStatus;
  try {
    status = await own.api<UploadStatus>(`/uploads/${encodeURIComponent(row.sessionId)}`, {}, own.workspaceId);
  } catch (error) {
    await trouble(own, j, error, read.row, file);
    return;
  }
  const state = status.upload.status;
  if (state === 'accepted') { await settle(own, j, read.row, 'uploaded', null, status.upload.song_id === row.songId); return; }
  if (state === 'rejected') { await settle(own, j, read.row, 'refused', status.upload.error ?? null); return; }
  if (!RESUMABLE.has(state)) { await planAgain(own, j, read.row); return; }
  const session: UploadSession = {
    id: row.sessionId, name: row.fileName, size: file.size, sha256: row.sha, status: state,
    part_size: row.partSize ?? file.size, part_count: row.partCount ?? 1,
  };
  const sending = new AbortController();
  const stop = () => sending.abort();
  signal.addEventListener('abort', stop);
  if (running) running.sending = sending;
  const show = (partsDone: number, partCount: number | null) => refresh({ current: { songId: row.songId, title: row.title, stage: 'sending', partsDone, partCount } });
  show(row.partsDone, row.partCount);
  try {
    const done = await sendParts(own.api, own.workspaceId, file, session, (partsDone, total) => {
      const now = j.get(row.songId);
      if (now) void j.put({ ...now, partsDone, partCount: total });
      show(partsDone, total);
    }, own.fetchImpl, { inFlight: () => (hadError || own.playing?.() ? 1 : PARTS_IN_FLIGHT), signal: sending.signal });
    tries.delete(row.songId);
    await completed(own, j, j.get(row.songId) ?? read.row, done);
  } catch (error) {
    // paused, cancelled or the shell went away: the parts that went stay sent
    if (sending.signal.aborted) return;
    await trouble(own, j, error, j.get(row.songId) ?? read.row, file);
  } finally {
    signal.removeEventListener('abort', stop);
    if (running?.sending === sending) running.sending = null;
  }
}

async function completed(own: UploadQueueParts, j: UploadJournal, row: UploadRow, done: UploadDone): Promise<void> {
  if (done.status === 'accepted') {
    // cloud only only for an upload the server accepted as this very song
    await settle(own, j, row, 'uploaded', null, done.upload?.song_id === row.songId);
    return;
  }
  if (done.status === 'rejected') {
    await settle(own, j, row, 'refused', done.rejection_code === 'song_mismatch' ? 'song_mismatch' : done.error ?? done.rejection_code ?? null);
    return;
  }
  await planAgain(own, j, row);
}

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};
const codeOf = (error: unknown): string | null => {
  const value = error as { code?: unknown; payload?: { detail?: { code?: unknown } } } | null;
  const code = value?.code ?? value?.payload?.detail?.code;
  return typeof code === 'string' ? code : null;
};

/** A request that failed: the grant gone, the library full, a session gone, a song refused for
 * good, or the connection or the service, which is tried again patiently. */
async function trouble(own: UploadQueueParts, j: UploadJournal, error: unknown, row: UploadRow | null, file?: File): Promise<void> {
  const status = statusOf(error);
  const code = codeOf(error);
  if (code === 'upload_attestation_required') { await stopRun(j, 'consent'); return; }
  if (status === 403) { await stopRun(j, 'grant'); return; }
  if (status === 413 || code === 'storage_quota_exceeded' || code === 'over_quota_read_only') { await stopRun(j, 'quota'); return; }
  if (status === 404 && row) { await planAgain(own, j, row); return; }
  if (row && status !== null && status >= 400 && status < 500 && ![401, 408, 409, 429].includes(status)) {
    await settle(own, j, row, 'refused', code);
    return;
  }
  // a file that will not read any more is looked at again from its handle next time round
  if (row && file && !(await readable(file))) verified.delete(row.songId);
  hadError = true;
  const key = row?.songId ?? 0;
  const count = (tries.get(key) ?? 0) + 1;
  tries.set(key, count);
  refresh({ waiting: pace().online() ? 'server' : 'offline' });
  const controller = running?.controller;
  if (controller) await rest(controller.signal, (own.retryDelay ?? defaultRetry)(count));
  refresh({ waiting: null });
}

const defaultRetry = (count: number) => Math.min(60_000, 2_000 * 2 ** (count - 1));

async function readable(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/** A song's outcome. Its session's hold is let go unless it was accepted; an accepted upload
 * of this very song (or one already there) switches it to cloud only unless the member kept it. */
async function settle(own: UploadQueueParts, j: UploadJournal, row: UploadRow, outcome: UploadOutcome, reason: string | null, sameSong = false): Promise<void> {
  if (row.sessionId && outcome !== 'uploaded') forget(own, row.sessionId);
  let cloudOnly = false;
  if (sameSong && !row.keepHere && (outcome === 'uploaded' || outcome === 'in_cloud_library')) {
    const store = await own.openStore();
    cloudOnly = (await switchToCloudOnly(store, row.songId)) !== null;
    if (cloudOnly) reportSoon(own);
  }
  verified.delete(row.songId);
  tries.delete(row.songId);
  await j.put({ ...row, state: 'done', outcome, reason, sessionId: null, choose: false, ...(cloudOnly ? { cloudOnly: true } : {}) });
  refresh();
}

async function stopRun(j: UploadJournal, why: UploadStopWhy): Promise<void> {
  running?.sending?.abort();
  await j.setMeta({ stopped: why });
  refresh({ current: null });
}

async function finish(own: UploadQueueParts, j: UploadJournal): Promise<void> {
  await j.setMeta({ meteredOk: false, wifiWait: false, paused: false });
  refresh({ current: null, waiting: null, ask: null });
  reportNow(own);
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && Date.now() - startedAt >= LONG_UPLOAD_MS) {
    notify(snapshot.words, 'selecta-uploads');
  }
}

function reportSoon(own: UploadQueueParts): void {
  if (reportTimer) return;
  reportTimer = setTimeout(() => { reportTimer = null; void Promise.resolve(own.onAvailabilityChanged?.()).catch(() => undefined); }, REPORT_EVERY_MS);
}

function reportNow(own: UploadQueueParts): void {
  if (!reportTimer) return;
  clearTimeout(reportTimer);
  reportTimer = null;
  void Promise.resolve(own.onAvailabilityChanged?.()).catch(() => undefined);
}

// --- what the member does -------------------------------------------------------------------

export type StartAnswer =
  | { ok: true; queued: number; choose: number }
  | { ok: false; why: 'not_ready' | 'off' | 'consent' | 'nothing' };

const titleOf = (song: StoredSong) => song.identity.title || (song.ref.kind === 'handle' ? song.ref.handle.name : song.ref.name);
const fileNameOf = (song: StoredSong) => (song.ref.kind === 'handle' ? song.ref.handle.name : song.ref.name);
const sizeOf = (song: StoredSong) => (song.ref.kind === 'repick' ? song.ref.size : song.sources?.[0]?.size ?? null);

/** "Upload to your cloud library": queue these songs. `keepHere` is the member's "Keep playing
 * them from this device too"; the default plays them from the cloud library only once uploaded.
 * Refused without recorded consent, and with the flag off. Songs in the current and recent mixes
 * go first, then the newest. */
export async function startUpload(options: { songIds: readonly number[]; keepHere?: boolean }): Promise<StartAnswer> {
  const own = parts;
  if (!own || !journal) return { ok: false, why: 'not_ready' };
  if (!flagOn('cloud.move_to_cloud')) return { ok: false, why: 'off' };
  if (!(await own.hasUploadConsent(own.workspaceId).catch(() => false))) return { ok: false, why: 'consent' };
  const j = journal;
  await j.reload();
  if (parts !== own || journal !== j) return { ok: false, why: 'not_ready' };
  // a run that ended starts afresh; songs still waiting stay where they are
  if (!j.all().some((row) => row.state !== 'done') || j.meta.cancelled) await j.clear();
  const store = await own.openStore();
  const mix = new Map((own.mixSongs?.() ?? []).map((id, at) => [id, at] as const));
  const songs: StoredSong[] = [];
  for (const id of new Set(options.songIds)) {
    const song = await store.get(id);
    if (song && !(j.get(id) && j.get(id)!.state !== 'done')) songs.push(song);
  }
  if (!songs.length) return { ok: false, why: 'nothing' };
  songs.sort((one, other) => {
    const a = mix.get(one.songId);
    const b = mix.get(other.songId);
    if (a !== undefined || b !== undefined) return (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);
    return other.importedAt - one.importedAt || other.songId - one.songId;
  });
  let order = j.nextOrder();
  const rows: UploadRow[] = songs.map((song) => ({
    songId: song.songId, sha: song.identity.content_sha256, title: titleOf(song), fileName: fileNameOf(song), size: sizeOf(song),
    duration: song.identity.duration_s && song.identity.duration_s > 0 ? song.identity.duration_s : null,
    order: order++, state: 'waiting', sessionId: null, plannedAt: null, expiresAt: null, partsDone: 0, partCount: null, partSize: null,
    outcome: null, reason: null, keepHere: options.keepHere === true, choose: song.ref.kind === 'repick' && !store.sessionFile(song.songId),
  }));
  await j.put(...rows);
  await j.setMeta({ stopped: null, cancelled: false, startedAt: j.meta.startedAt ?? Date.now() });
  refresh();
  if (running) { nudge(); } else if (following) { post({ type: 'reload' }); } else void claim();
  return { ok: true, queued: rows.length, choose: rows.filter((row) => row.choose).length };
}

async function obey(command: Command): Promise<void> {
  if (command === 'pause') return pauseUploads();
  if (command === 'resume') return resumeUploads();
  if (command === 'cancel') return cancelUploads();
  return answerMobileData(command === 'mobile_now' ? 'now' : 'wifi');
}

/** Pause: the part on its way is dropped (the parts already sent stay sent). */
export async function pauseUploads(): Promise<void> {
  if (following && !running) { post({ type: 'command', command: 'pause' }); return; }
  const j = journal;
  if (!j) return;
  await j.setMeta({ paused: true });
  running?.sending?.abort();
  refresh({ current: null });
}

/** Carry on after a pause, a full library made room, or the grant came back. */
export async function resumeUploads(): Promise<void> {
  if (following && !running) { post({ type: 'command', command: 'resume' }); return; }
  const j = journal;
  if (!j) return;
  await j.setMeta({ paused: false, stopped: null, wifiWait: false });
  refresh({ waiting: null });
  nudge();
  if (!running && j.all().some((row) => row.state !== 'done')) void claim();
}

/** Cancel: songs not yet uploaded stay on this device as they are, and their holds are let go. */
export async function cancelUploads(): Promise<void> {
  if (following && !running) { post({ type: 'command', command: 'cancel' }); return; }
  const own = parts;
  const j = journal;
  if (!own || !j) return;
  running?.sending?.abort();
  const left = j.all().filter((row) => row.state !== 'done');
  for (const row of left) if (row.sessionId) forget(own, row.sessionId);
  await j.drop(left.map((row) => row.songId));
  for (const row of left) verified.delete(row.songId);
  await j.setMeta({ cancelled: true, paused: false, stopped: null });
  running?.controller.abort();
  refresh({ current: null, waiting: null, ask: null });
}

/** The answer to "Upload now on mobile data" / "Wait for Wi-Fi", for this run. */
export async function answerMobileData(answer: 'now' | 'wifi'): Promise<void> {
  if (following && !running) { post({ type: 'command', command: answer === 'now' ? 'mobile_now' : 'wifi' }); return; }
  const j = journal;
  if (!j) return;
  await j.setMeta(answer === 'now' ? { meteredOk: true, wifiWait: false } : { wifiWait: true });
  refresh({ ask: null });
  nudge();
}

/** "Choose these files": files picked again are matched to waiting songs by name and size, then
 * confirmed by hash; one that hashes differently has changed since it was added. */
export async function chooseFilesAgain(files: readonly File[]): Promise<{ matched: number; changed: number; unmatched: number }> {
  const own = parts;
  const j = journal;
  const answer = { matched: 0, changed: 0, unmatched: 0 };
  if (!own || !j) return { ...answer, unmatched: files.length };
  if (following && !running) { post({ type: 'files', files: [...files] }); return { ...answer, matched: files.length }; }
  const waiting = j.all().filter((row) => row.state !== 'done' && row.choose);
  const taken = new Set<number>();
  for (const file of files) {
    const row = waiting.find((one) => !taken.has(one.songId) && one.fileName === file.name && (one.size === null || one.size === file.size));
    if (!row) { answer.unmatched += 1; continue; }
    taken.add(row.songId);
    const sha = await (own.hash ?? fileSha256)(file).catch(() => null);
    if (sha !== row.sha) {
      answer.changed += 1;
      await settle(own, j, row, 'changed', null);
      continue;
    }
    verified.set(row.songId, file);
    await j.put({ ...row, choose: false, size: file.size });
    answer.matched += 1;
  }
  refresh();
  if (answer.matched) { if (running) nudge(); else void claim(); }
  return answer;
}

/** Put a finished (or cancelled) queue away. */
export async function clearFinishedUploads(): Promise<void> {
  const j = journal;
  if (!j || j.all().some((row) => row.state !== 'done' && !row.choose && !j.meta.cancelled)) return;
  await j.clear();
  refresh({ current: null, waiting: null, ask: null });
}

/** The dry run the consent sheet shows before the member agrees (plan 6c): these songs as the
 * server would take them, by file name, size, registered hash, song id and length. No audio is
 * read or sent and nothing is reserved; up to 500 songs, the route's limit. */
export async function previewUpload(songIds: readonly number[]): Promise<{ files: PreviewAnswer['files']; totals: Record<string, number | null> } | null> {
  const own = parts;
  if (!own || !flagOn('cloud.move_to_cloud')) return null;
  const store = await own.openStore();
  const specs: Record<string, unknown>[] = [];
  for (const id of songIds) {
    const song = await store.get(id);
    if (!song) continue;
    let size = sizeOf(song);
    if (size === null && song.ref.kind === 'handle') size = await song.ref.handle.getFile().then((file) => file.size, () => null);
    if (!size) continue;
    specs.push({ name: fileNameOf(song), size, sha256: song.identity.content_sha256, song_id: id, ...(song.identity.duration_s && song.identity.duration_s > 0 ? { duration: song.identity.duration_s } : {}) });
  }
  if (!specs.length) return { files: [], totals: { files: 0, ok: 0, in_cloud_library: 0, refused: 0, bytes_needed: 0, bytes_left: null, fit: 0, measure_days: null } };
  const answer = await own.api<PreviewAnswer & { totals: Record<string, number | null> }>('/uploads/preview', json({ files: specs.slice(0, 500) }), own.workspaceId);
  return { files: answer.files, totals: answer.totals };
}

// --- the shell ------------------------------------------------------------------------------

let title: (() => void) | null = null;

/** The tab's title carries the queue's progress while the tab is hidden. */
function watchTitle(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const update = () => {
    const state = snapshot;
    if (document.visibilityState !== 'hidden' || state.elsewhere) { showTitle(null); return; }
    if (state.phase === 'running' && state.total) showTitle(`${Math.min(99, Math.floor((state.settled / state.total) * 100))}% uploaded · SelectaDJ`);
    else if (state.phase === 'finished') showTitle('Finished uploading · SelectaDJ');
    else if (state.phase === 'paused' || state.phase === 'stopped' || state.phase === 'asking') showTitle('Uploads need a look · SelectaDJ');
  };
  const unhear = subscribeUploads(update);
  document.addEventListener('visibilitychange', update);
  return () => { unhear(); document.removeEventListener('visibilitychange', update); showTitle(null); };
}

/** Bind the queue to the signed-in workspace: opens its journal and carries on a queue a reload
 * or a closed tab left part way. The returned function lets go (sign-out, account switch). */
export function bindUploadQueue(given: UploadQueueParts): () => Promise<void> {
  parts = given;
  bindCloudOnly({ openStore: given.openStore, onAvailabilityChanged: given.onAvailabilityChanged });
  title ??= watchTitle();
  let gone = false;
  void UploadJournal.open(given.workspaceId, given.storageRevision).then((opened) => {
    if (gone || parts !== given) { opened.close(); return; }
    journal = opened;
    refresh();
    if (flagOn('cloud.move_to_cloud') && opened.all().some((row) => row.state !== 'done' && !row.choose) && !opened.meta.stopped && !opened.meta.cancelled) void claim();
  });
  return async () => {
    gone = true;
    if (parts === given) await endUploadQueue();
  };
}

/** Let go of the queue (the shell went away). A run stops where it is; the journal keeps it. */
export async function endUploadQueue(): Promise<void> {
  const own = parts;
  claimStop?.abort();
  running?.sending?.abort();
  running?.controller.abort();
  stopFollowing();
  if (own) reportNow(own);
  if (shareTimer) { clearTimeout(shareTimer); shareTimer = null; }
  await claiming?.catch(() => undefined);
  journal?.close();
  journal = null;
  parts = null;
  bindCloudOnly(null);
  title?.();
  title = null;
  verified.clear();
  tries.clear();
  plannedAgain.clear();
  live = { waiting: null, ask: null, current: null };
  snapshot = IDLE_UPLOADS;
  for (const listen of listeners) listen();
}

/** Whether this tab is running the queue right now. */
export function uploadsRunningHere(): boolean {
  return running !== null;
}
