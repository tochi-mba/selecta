import { useEffect, useSyncExternalStore } from 'react';
import { flagOn } from '../flags';
import {
  assertNoPath, dropFolderSources, factsOf, listWatchedFolders, newFolderId, planCheck, rebaseSources, refreshDeviceAvailability, relationOf,
  rememberFolder, removeWatchedFolder, saveWatchedFolder, songsIn, songsOnlyIn, walkFolder,
  type FileHandleLike, type FolderState, type ImportSummary, type MediaStore, type StoredFolderHandle, type StoredSong, type WatchedFolder,
} from '../media';
import type { Request } from '../media/importer';
import { showToast } from '../ui/toasts';
import { countOf } from '../ui/format';
import { registeredDeviceId } from './ConnectMusic';
import { startImport, type WatchExtras } from './importResume';
import { cancelImportSession, importSnapshot, readImportMarker, subscribeImport } from './importSession';

// Watching music folders (`cloud.music_folders`).
//
// A folder the browser still allows is checked for new, changed and missing files without the
// member doing anything: once after SelectaDJ opens (when the page is idle and no music is
// playing), and again when the tab comes back if the last check is older than WATCH_INTERVAL_MS.
// Folders are checked one after another, and anything new goes through the one import session,
// so there is still only one import at a time and its chip, announcer and resilience all hold.
//
// Honest limits, said on the page as well:
// - A browser can only check while SelectaDJ is open.
// - Where the browser cannot keep a folder between visits (no folder picker with handles), the
//   folder is listed as "chosen this visit" and has to be chosen again next time.
// - Nothing is ever deleted from the library by a check: missing files show as not found.
//
// EDGE CASES, each handled where it is marked below: two tabs open; a second account in the same
// browser; a folder renamed or moved; a very large folder; a folder removed while it is checked;
// storage full or refused; offline.

/** A tab coming back checks again once the last check is older than this. */
export const WATCH_INTERVAL_MS = 30 * 60_000;
/** The first check waits this long after the shell opens, then for an idle moment. */
export const START_DELAY_MS = 4_000;
/** An automatic check waits for the music to pause, looking again this often. */
export const MUSIC_PAUSE_POLL_MS = 30_000;

export type RowState = FolderState | 'visit';

/** One folder as the page shows it. */
export type FolderRow = {
  id: string;
  name: string;
  addedAt: number;
  checkedAt: number | null;
  songs: number | null;
  lastNew: number;
  missing: number;
  state: RowState;
  /** The browser keeps a handle to it: it can be checked and allowed again. */
  handle: StoredFolderHandle | null;
  /** Remembered for the next visit (false: chosen this visit, or storage would not keep it). */
  kept: boolean;
};

export type CheckProgress = { folderId: string; stage: 'looking' | 'reading' | 'adding'; done: number; total: number | null };

export type WatchSnapshot = {
  workspaceId: string | null;
  /** null while the list loads */
  rows: FolderRow[] | null;
  /** IndexedDB refused or failing: folders will not be remembered next visit */
  refused: boolean;
  checking: CheckProgress | null;
  /** waiting: an automatic check is waiting for the music to pause, or for another tab */
  waiting: 'music' | 'tab' | null;
  /** What adding a folder found instead of adding it (the same folder, one inside or around a
   * watched one), or that the folder would not open; null once put away. */
  notice: AddNotice | null;
};

type Parts = { request: Request; openStore: () => Promise<MediaStore>; workspaceId: string; importer?: Parameters<typeof startImport>[0]['importer'] };

const EMPTY: WatchSnapshot = Object.freeze({ workspaceId: null, rows: null, refused: false, checking: null, waiting: null, notice: null });
let state: WatchSnapshot = EMPTY;
const listeners = new Set<() => void>();
let parts: Parts | null = null;
let extras: WatchExtras = {};
/** Folders waiting their turn, in order; one runs at a time. */
type Turn = { id: string; relink?: boolean; whole?: boolean };
let queue: Turn[] = [];
let running: { id: string; controller: AbortController } | null = null;
let loop: Promise<void> | null = null;
/** An automatic check deferred because an import was running. */
let deferred = false;

function publish(next: Partial<WatchSnapshot>): void {
  state = { ...state, ...next };
  for (const listen of listeners) listen();
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => { listeners.delete(listen); };
}

/** The folder list as `workspaceId` may see it. EDGE CASE (a second account in the same
 * browser): another workspace's folders read as still loading, never as this one's. */
export function useMusicFolders(workspaceId: string): WatchSnapshot {
  const read = () => (state.workspaceId === workspaceId ? state : EMPTY);
  return useSyncExternalStore(subscribe, read, read);
}

export function watchSnapshot(): WatchSnapshot { return state; }

const rowOf = (folder: WatchedFolder, kept = true): FolderRow => ({
  id: folder.id, name: folder.name, addedAt: folder.addedAt, checkedAt: folder.checkedAt, songs: folder.songs,
  lastNew: folder.lastNew, missing: folder.missing, state: folder.state, handle: folder.handle, kept,
});

const recordOf = (row: FolderRow, workspaceId: string): WatchedFolder | null => (row.handle ? {
  kind: 'folder', id: row.id, workspaceId, handle: row.handle, name: row.name, addedAt: row.addedAt, checkedAt: row.checkedAt,
  songs: row.songs, lastNew: row.lastNew, missing: row.missing, state: row.state === 'visit' ? 'unchecked' : row.state,
} : null);

async function permissionOf(handle: StoredFolderHandle): Promise<'granted' | 'ask'> {
  if (!handle.queryPermission) return 'granted';
  try { return (await handle.queryPermission({ mode: 'read' })) === 'granted' ? 'granted' : 'ask'; } catch { return 'ask'; }
}

/** Read this workspace's folders from the browser, keep the ones only this visit holds, and ask
 * each kept folder whether the browser still allows it (no prompt: `queryPermission`). */
export async function loadFolders(workspaceId: string): Promise<void> {
  if (state.workspaceId !== workspaceId) publish({ ...EMPTY, workspaceId });
  const kept = await listWatchedFolders(workspaceId);
  if (state.workspaceId !== workspaceId) return;
  const visitOnly = (state.rows ?? []).filter((row) => !row.kept);
  const rows = (kept ?? []).map((folder) => rowOf(folder));
  for (const row of rows) {
    if (!row.handle) continue;
    const allowed = await permissionOf(row.handle);
    if (allowed === 'ask') row.state = 'permission';
    else if (row.state === 'permission') row.state = row.checkedAt ? 'watching' : 'unchecked';
  }
  if (state.workspaceId !== workspaceId) return;
  publish({ rows: [...rows, ...visitOnly.filter((row) => !rows.some((one) => one.id === row.id))], refused: kept === null });
}

function setRow(id: string, change: Partial<FolderRow>): FolderRow | null {
  const rows = state.rows ?? [];
  const at = rows.findIndex((row) => row.id === id);
  if (at < 0) return null;
  const next = { ...rows[at], ...change };
  publish({ rows: [...rows.slice(0, at), next, ...rows.slice(at + 1)] });
  return next;
}

/** Keep a row's record in the browser. EDGE CASE (storage full or refused): the row stays for
 * this visit and the page says folders will not be remembered. */
async function persist(row: FolderRow): Promise<void> {
  const workspaceId = state.workspaceId;
  const record = workspaceId ? recordOf(row, workspaceId) : null;
  if (!record) return;
  const saved = await saveWatchedFolder(record);
  if (!saved) { publish({ refused: true }); setRow(row.id, { kept: false }); }
}

async function told(): Promise<void> {
  try {
    if (extras.onAvailabilityChanged) { await extras.onAvailabilityChanged(); return; }
    const device = parts ? registeredDeviceId(parts.workspaceId) : null;
    if (parts && device) await refreshDeviceAvailability(parts.request, await parts.openStore(), device);
  } catch { /* the shell's periodic report tries again */ }
}

const isNamed = (error: unknown, name: string) => (error as { name?: string } | null)?.name === name;

/** One folder's check. Stops cleanly when `signal` fires (EDGE CASE: the member stopped watching
 * the folder while it was being checked): nothing is written back for a folder that is gone. */
async function checkOne(id: string, signal: AbortSignal, turn: Turn): Promise<void> {
  const relink = turn.relink === true;
  const own = parts;
  const row = state.rows?.find((one) => one.id === id);
  if (!own || !row?.handle) return;
  const gone = () => signal.aborted || !state.rows?.some((one) => one.id === id);
  if (await permissionOf(row.handle) === 'ask') { setRow(id, { state: 'permission' }); return; }
  if (turn.whole) { await readWhole(own, row, signal); return; }
  publish({ checking: { folderId: id, stage: 'looking', done: 0, total: null } });
  let files;
  try {
    // EDGE CASE (a very large folder): the walk and the size check hand the page back as they go
    files = await walkFolder(row.handle, { signal, onFound: (done) => publish({ checking: { folderId: id, stage: 'looking', done, total: null } }) });
  } catch (error) {
    if (gone()) return;
    // EDGE CASE (renamed or moved): the handle no longer leads anywhere. Its songs are kept; Choose
    // it again relinks them.
    setRow(id, { state: isNamed(error, 'NotAllowedError') || isNamed(error, 'SecurityError') ? 'permission' : 'missing', checkedAt: Date.now() });
    const changed = state.rows?.find((one) => one.id === id);
    if (changed) await persist(changed);
    return;
  }
  const facts = await factsOf(files, { signal, onProgress: (done, total) => publish({ checking: { folderId: id, stage: 'reading', done, total } }) });
  const store = await own.openStore();
  const before = await store.all();
  const plan = await planCheck(id, facts, before, signal);
  if (gone()) return;
  for (const { songId, source } of plan.adopt) {
    const song = await store.get(songId);
    if (song) await store.put({ ...song, sources: [...(song.sources ?? []).filter((one) => one.folderId !== id || one.path !== source.path), source] });
  }
  if (relink) {
    // Choose it again: songs known by place, size and time point at the folder's new handle
    const byPath = new Map(facts.map((fact) => [fact.path, fact] as const));
    for (const song of await store.all()) {
      const place = song.sources?.find((one) => one.folderId === id && byPath.get(one.path)?.size === one.size && byPath.get(one.path)?.modified === one.modified);
      if (place) await store.put({ ...song, ref: { kind: 'handle', handle: byPath.get(place.path)!.handle } }, { availability: true });
    }
  }
  const knownIds = new Set(before.map((song) => song.songId));
  let added = 0;
  if (plan.fresh.length) {
    // never two imports at once: one started meanwhile (by the member) goes first, and this
    // folder waits its turn again
    if (importSnapshot().phase === 'running') waitTurn(turn);
    publish({ checking: { folderId: id, stage: 'adding', done: 0, total: plan.fresh.length } });
    const marker = readImportMarker(own.workspaceId);
    const summary: ImportSummary | null = await startImport(own, { kind: 'walked', name: row.name, files: plan.fresh.map(({ handle, path }) => ({ handle, path })) }, {
      folder: row.name, kind: 'folder', folderId: id, resume: marker?.folderId === id ? marker : null,
    }).catch(() => null);
    if (gone()) return;
    const after = await store.all();
    added = after.filter((song) => !knownIds.has(song.songId) && song.sources?.some((one) => one.folderId === id)).length;
    // a changed file's old song loses this place; if that was its only place, its file is no
    // longer those bytes, which the existing "changed file" state says
    for (const { songId, path } of plan.changed) {
      const fact = facts.find((one) => one.path === path);
      const song = await store.get(songId);
      const stale = song?.sources?.find((one) => one.folderId === id && one.path === path && (one.size !== fact?.size || one.modified !== fact?.modified));
      if (!song || !stale) continue;
      const sources = song.sources!.filter((one) => one !== stale);
      await store.put({ ...song, sources });
      if (!sources.length) await store.markChanged(songId);
    }
    if (summary?.cancelled && !gone()) { publish({ checking: null }); return; }
  }
  if (plan.missing.length) store.noteAvailabilityChanged();
  const songs = songsIn(id, await store.all());
  const next = setRow(id, { state: 'watching', checkedAt: Date.now(), songs, lastNew: added, missing: plan.missing.length });
  if (next) await persist(next);
  publish({ checking: null });
  if (added > 0) showToast(`${countOf(added, 'new song')} from ${row.name}`);
  if (plan.missing.length || relink || plan.changed.length) await told();
}

class DeferredCheck extends Error {}

/** Never two imports at once: one the member started meanwhile goes first, and this folder
 * waits its turn again once it ends. */
function waitTurn(turn: Turn): never {
  queue.unshift(turn);
  deferred = true;
  publish({ checking: null });
  throw new DeferredCheck();
}

/** A folder just added is read whole by the importer, so its progress shows at once (the walk
 * and the size check would only find that every file is new). */
async function readWhole(own: Parts, row: FolderRow, signal: AbortSignal): Promise<void> {
  if (importSnapshot().phase === 'running') waitTurn({ id: row.id, whole: true });
  const store = await own.openStore();
  const knownIds = new Set((await store.all()).map((song) => song.songId));
  publish({ checking: { folderId: row.id, stage: 'adding', done: 0, total: null } });
  const summary = await startImport(own, row.handle!, { folder: row.name, kind: 'folder', folderId: row.id }).catch(() => null);
  if (signal.aborted || !state.rows?.some((one) => one.id === row.id)) return;
  const after = await store.all();
  const added = after.filter((song) => !knownIds.has(song.songId) && song.sources?.some((one) => one.folderId === row.id)).length;
  // a stopped or failed first read is not a check: the folder is checked again next time
  const finished = summary !== null && !summary.cancelled;
  const next = setRow(row.id, { state: 'watching', checkedAt: finished ? Date.now() : row.checkedAt, songs: songsIn(row.id, after), lastNew: added, missing: 0 });
  if (next) await persist(next);
  publish({ checking: null });
  if (added > 0) showToast(`${countOf(added, 'new song')} from ${row.name}`);
}

/** Web Locks where the browser has them: EDGE CASE (two tabs open) a folder check never runs in
 * two tabs of this browser at once; the other tab simply does not check this time. */
type LockManagerLike = { request(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => unknown): Promise<unknown> };
function locks(): LockManagerLike | null {
  const found = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
  return found && typeof found.request === 'function' ? found : null;
}

async function drain(): Promise<void> {
  while (queue.length && parts) {
    const next = queue.shift()!;
    const controller = new AbortController();
    running = { id: next.id, controller };
    try {
      await checkOne(next.id, controller.signal, next);
    } catch (error) {
      if (error instanceof DeferredCheck) return;
      // a check that fails says so on its row; the next folder still gets its turn
      if (!controller.signal.aborted) setRow(next.id, { checkedAt: Date.now() });
    } finally {
      running = null;
      publish({ checking: null });
    }
  }
}

function runQueue(): Promise<void> {
  if (loop) return loop;
  const workspaceId = parts?.workspaceId;
  const manager = locks();
  const work = async () => {
    if (!manager || !workspaceId) { await drain(); return; }
    await manager.request(`selecta-folder-check:${workspaceId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { queue = []; publish({ waiting: 'tab' }); return; }
      publish({ waiting: null });
      await drain();
    });
  };
  loop = work().catch(() => undefined).finally(() => { loop = null; });
  return loop;
}

/** Check these folders now (Check now, Check all, Allow, Choose it again), in order. */
export function checkFolders(ids: readonly string[], options: { relink?: boolean; whole?: boolean } = {}): Promise<void> {
  for (const id of ids) {
    if (running?.id === id || queue.some((item) => item.id === id)) continue;
    queue.push({ id, ...(options.relink ? { relink: true } : {}), ...(options.whole ? { whole: true } : {}) });
  }
  return runQueue();
}

/** The automatic check: kept folders the browser allows, all of them (`'all'`) or those not
 * checked for WATCH_INTERVAL_MS (`'due'`). Waits for an import to finish and for the music to
 * pause rather than compete with either. */
export function autoCheck(which: 'all' | 'due'): void {
  if (!parts || !flagOn('cloud.music_folders')) return;
  if (importSnapshot().phase === 'running') { deferred = true; return; }
  if (extras.playing?.()) {
    publish({ waiting: 'music' });
    later(() => autoCheck(which), MUSIC_PAUSE_POLL_MS);
    return;
  }
  if (state.waiting === 'music') publish({ waiting: null });
  const now = Date.now();
  const ids = (state.rows ?? [])
    .filter((row) => row.handle && row.kept && row.state !== 'permission' && (which === 'all' || row.checkedAt === null || now - row.checkedAt >= WATCH_INTERVAL_MS))
    .map((row) => row.id);
  if (ids.length) void checkFolders(ids);
}

let timers: ReturnType<typeof setTimeout>[] = [];
function later(run: () => void, ms: number): void {
  const timer = setTimeout(() => { timers = timers.filter((one) => one !== timer); run(); }, ms);
  timers.push(timer);
}

function whenIdle(run: () => void): void {
  const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === 'function') idle(() => run(), { timeout: 10_000 });
  else later(run, 1_000);
}

/** Stop everything this workspace's watch was doing (the shell went away, or another account). */
function endWatch(): void {
  running?.controller.abort();
  queue = [];
  for (const timer of timers) clearTimeout(timer);
  timers = [];
  deferred = false;
  parts = null;
  publish(EMPTY);
}

/** The shell's hook (through `useImportCarryOn`): loads this workspace's folders, checks them
 * once after opening, again when the tab comes back and is due, and after an import that made a
 * check wait. Off (`cloud.music_folders`), it does nothing at all. */
export function useFolderWatch(given: Parts, more?: WatchExtras): void {
  useEffect(() => { extras = more ?? {}; });
  const { request, openStore, workspaceId, importer } = given;
  useEffect(() => {
    if (!flagOn('cloud.music_folders')) return undefined;
    const mine: Parts = { request, openStore, workspaceId, importer };
    parts = mine;
    void loadFolders(workspaceId).then(() => { if (parts === mine) later(() => whenIdle(() => autoCheck('all')), START_DELAY_MS); });
    const visible = () => {
      if (document.visibilityState !== 'visible' || parts !== mine) return;
      void loadFolders(workspaceId).then(() => { if (parts === mine) whenIdle(() => autoCheck('due')); });
    };
    const unhear = subscribeImport(() => {
      if (!deferred || importSnapshot().phase === 'running' || parts !== mine) return;
      deferred = false;
      // a check that was waiting carries on; what was queued keeps its order
      if (queue.length) void runQueue();
      else whenIdle(() => autoCheck('due'));
    });
    document.addEventListener('visibilitychange', visible);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      unhear();
      if (parts === mine) endWatch();
    };
  }, [request, openStore, workspaceId, importer]);
}

// --- What the member does -------------------------------------------------------------------

export type AddOutcome =
  | { kind: 'added'; id: string }
  | { kind: 'same'; name: string }
  | { kind: 'inside'; name: string; parent: string }
  | { kind: 'parent'; handle: StoredFolderHandle; children: FolderRow[]; paths: Record<string, string[]> };

export type AddNotice = Exclude<AddOutcome, { kind: 'added' }> | { kind: 'failed' };

/** Put a notice away. */
export function clearFolderNotice(): void { if (state.notice) publish({ notice: null }); }

/** Add a folder chosen by the member: the outcome is added, or said on the folder list. */
export async function watchChosen(handle: StoredFolderHandle): Promise<AddOutcome> {
  const outcome = await addFolder(handle);
  publish({ notice: outcome.kind === 'added' ? null : outcome });
  return outcome;
}

/** "Add a folder": the browser's folder picker (must run from a press), then `watchChosen`. */
export async function pickFolderToWatch(): Promise<void> {
  try {
    const handle = await (window as unknown as { showDirectoryPicker(options?: { mode: 'read' }): Promise<StoredFolderHandle> }).showDirectoryPicker({ mode: 'read' });
    await watchChosen(handle);
  } catch (error) {
    // closing the picker is a choice, not a failure
    if (!isNamed(error, 'AbortError')) publish({ notice: { kind: 'failed' } });
  }
}

/** "Choose it again" for one row: the picker, then the chosen folder takes the row's place. */
export async function pickFolderAgain(id: string): Promise<void> {
  try {
    const handle = await (window as unknown as { showDirectoryPicker(options?: { mode: 'read' }): Promise<StoredFolderHandle> }).showDirectoryPicker({ mode: 'read' });
    await relinkFolder(id, handle);
  } catch (error) {
    if (!isNamed(error, 'AbortError')) publish({ notice: { kind: 'failed' } });
  }
}

/** A folder the member chose (picker or drop). The same folder, a folder inside one already
 * watched, or the parent of folders already watched are said plainly instead of being read twice. */
export async function addFolder(handle: StoredFolderHandle): Promise<AddOutcome> {
  const children: FolderRow[] = [];
  const paths: Record<string, string[]> = {};
  for (const row of state.rows ?? []) {
    if (!row.handle) continue;
    const related = await relationOf(handle, row.handle);
    if (related?.relation === 'same') {
      void checkFolders([row.id]);
      return { kind: 'same', name: row.name };
    }
    if (related?.relation === 'inside') return { kind: 'inside', name: handle.name, parent: row.name };
    if (related?.relation === 'parent') { children.push(row); paths[row.id] = related.path; }
  }
  if (children.length) return { kind: 'parent', handle, children, paths };
  return { kind: 'added', id: await watchNew(handle) };
}

async function watchNew(handle: StoredFolderHandle): Promise<string> {
  const row: FolderRow = { id: newFolderId(), name: handle.name, addedAt: Date.now(), checkedAt: null, songs: null, lastNew: 0, missing: 0, state: 'unchecked', handle, kept: true };
  publish({ rows: [...(state.rows ?? []), row] });
  await persist(row);
  // the folder an interrupted import carries on with, as before (and if this flag is turned off)
  if (parts) void rememberFolder(parts.workspaceId, handle);
  void checkFolders([row.id], { whole: true });
  return row.id;
}

/** Watch the parent in place of the folders inside it: their songs move under it by place, so
 * nothing is read again, and the parent's check adds only what the children did not hold. */
export async function watchParentInstead(outcome: AddOutcome & { kind: 'parent' }): Promise<void> {
  const own = parts;
  if (!own) return;
  publish({ notice: null });
  const row: FolderRow = { id: newFolderId(), name: outcome.handle.name, addedAt: Date.now(), checkedAt: null, songs: null, lastNew: 0, missing: 0, state: 'unchecked', handle: outcome.handle, kept: true };
  const store = await own.openStore();
  for (const child of outcome.children) {
    if (running?.id === child.id) running.controller.abort();
    queue = queue.filter((item) => item.id !== child.id);
    await rebaseSources(store, child.id, row.id, outcome.paths[child.id] ?? []);
    await removeWatchedFolder(child.id);
  }
  const childIds = new Set(outcome.children.map((child) => child.id));
  publish({ rows: [...(state.rows ?? []).filter((one) => !childIds.has(one.id)), row] });
  await persist(row);
  void rememberFolder(own.workspaceId, outcome.handle);
  void checkFolders([row.id]);
}

/** A folder chosen through a browser without folder handles (the directory file input): it is
 * read now and listed as chosen this visit. */
export function addVisitFolder(files: File[]): void {
  const own = parts;
  if (!own || !files.length) return;
  const first = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
  const name = first.split('/')[0] || 'Chosen folder';
  const row: FolderRow = { id: newFolderId(), name, addedAt: Date.now(), checkedAt: Date.now(), songs: null, lastNew: 0, missing: 0, state: 'visit', handle: null, kept: false };
  // the same folder chosen again this visit takes its own earlier row's place
  publish({ rows: [...(state.rows ?? []).filter((one) => !(one.state === 'visit' && one.name === name)), row] });
  void own.openStore().then(async (store) => {
    const before = new Set((await store.all()).map((song) => song.songId));
    const summary = await startImport(own, files, { folder: name, kind: 'files', folderId: row.id }).catch(() => null);
    const after = await store.all();
    const added = after.filter((song) => !before.has(song.songId)).length;
    setRow(row.id, { songs: songsIn(row.id, after), lastNew: added, checkedAt: Date.now() });
    if (summary && added > 0) showToast(`${countOf(added, 'new song')} from ${name}`);
  });
}

/** Songs (or folders) dropped onto the page as files, through the same one import. */
export function importLooseHandles(handles: FileHandleLike[]): void {
  const own = parts;
  if (!own || !handles.length) return;
  const marker = readImportMarker(own.workspaceId);
  void startImport(own, handles, { kind: 'files', resume: marker && !marker.folderId ? marker : null });
}

/** Allow, from the member's press: one prompt restores every song in the folder at once, then
 * the availability report tells Rooms and the member's other devices, and the folder is checked. */
export async function allowFolder(id: string): Promise<boolean> {
  const row = state.rows?.find((one) => one.id === id);
  if (!row?.handle) return false;
  let answer = 'granted';
  try { if (row.handle.requestPermission) answer = await row.handle.requestPermission({ mode: 'read' }); } catch { answer = 'denied'; }
  if (answer !== 'granted') return false;
  const next = setRow(id, { state: row.checkedAt ? 'watching' : 'unchecked' });
  if (next) await persist(next);
  if (parts) (await parts.openStore()).noteAvailabilityChanged();
  await told();
  void checkFolders([id]);
  return true;
}

/** Choose it again: a folder that was moved or renamed (or never kept) is chosen afresh and
 * takes the place of the old one, keeping its songs (by place, size and time, then content hash). */
export async function relinkFolder(id: string, handle: StoredFolderHandle): Promise<void> {
  const row = state.rows?.find((one) => one.id === id);
  if (!row) return;
  const next = setRow(id, { handle, name: handle.name, state: 'unchecked', kept: true });
  if (next) await persist(next);
  if (parts) void rememberFolder(parts.workspaceId, handle);
  void checkFolders([id], { relink: true });
}

export type StopResult = { removed: number; undo: () => Promise<void> };

/** Stop watching a folder. `removeSongs`: also take out of the library the songs that came only
 * from it (a song also in another watched folder stays), through the library's own remove; the
 * returned `undo` puts the folder and those songs back. EDGE CASE (removed while being checked):
 * its check is stopped first, and so is the import it started. */
export async function stopWatching(id: string, removeSongs: boolean): Promise<StopResult> {
  const own = parts;
  const row = state.rows?.find((one) => one.id === id);
  if (!own || !row) return { removed: 0, undo: async () => undefined };
  if (running?.id === id) running.controller.abort();
  queue = queue.filter((item) => item.id !== id);
  if (importSnapshot().phase === 'running' && importSnapshot().folderId === id) cancelImportSession();
  const workspaceId = own.workspaceId;
  const record = recordOf(row, workspaceId);
  publish({ rows: (state.rows ?? []).filter((one) => one.id !== id) });
  await removeWatchedFolder(id);
  const store = await own.openStore();
  const all = await store.all();
  const watched = new Set((state.rows ?? []).map((one) => one.id));
  const kept = all.filter((song) => song.sources?.some((one) => one.folderId === id));
  const leaving: StoredSong[] = [];
  let refused = 0;
  for (const song of removeSongs ? songsOnlyIn(id, all, watched) : []) {
    try {
      await own.request(`/api/local-media/songs/${song.songId}`, { method: 'DELETE' });
      await store.remove(song.songId);
      leaving.push(song);
    } catch {
      // offline, or the service said no: the song stays, and the member is told how many
      refused += 1;
    }
  }
  if (refused) showToast(`${countOf(refused, 'song')} could not be removed just now, so ${refused === 1 ? 'it stays' : 'they stay'} in your library.`, { tone: 'problem' });
  await dropFolderSources(store, id);
  if (leaving.length) await told();
  const undo = async () => {
    if (parts?.workspaceId !== workspaceId) return;
    if (leaving.length) {
      // the library's remove is a soft delete; registering the same fingerprints restores them
      const payload = { songs: leaving.map((song) => ({ content_sha256: song.identity.content_sha256, title: song.identity.title, artist: song.identity.artist, ...(song.identity.album ? { album: song.identity.album } : {}), ...(song.identity.duration_s ? { duration_s: song.identity.duration_s } : {}) })) };
      assertNoPath(payload);
      await own.request('/api/local-media/songs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    }
    for (const song of kept) await store.put(song);
    if (record && await saveWatchedFolder(record)) publish({ rows: [...(state.rows ?? []).filter((one) => one.id !== id), rowOf(record)].sort((a, b) => a.addedAt - b.addedAt) });
    else publish({ rows: [...(state.rows ?? []).filter((one) => one.id !== id), row] });
    await told();
  };
  return { removed: leaving.length, undo };
}

/** How many songs stopping watching would take out of the library, and how many would stay
 * because another watched folder also has them. */
export async function stopCounts(id: string): Promise<{ only: number; shared: number }> {
  const own = parts;
  if (!own) return { only: 0, shared: 0 };
  const all = await (await own.openStore()).all();
  const watched = new Set((state.rows ?? []).filter((one) => one.id !== id).map((one) => one.id));
  const only = songsOnlyIn(id, all, watched).length;
  return { only, shared: songsIn(id, all) - only };
}

/** Whether the shell is watching this workspace's folders here (flag on and the shell mounted). A
 * surface without it (a test, onboarding before the shell) adds music the way it always did. */
export function watchingFor(workspaceId: string): boolean {
  return flagOn('cloud.music_folders') && parts?.workspaceId === workspaceId;
}

/** Whether a check or an import for this workspace is under way here. */
export function folderBusy(): boolean {
  return running !== null || queue.length > 0;
}
