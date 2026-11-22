import { useSyncExternalStore } from 'react';
import type { ImportEvent, ImportSource, ImportSummary } from '../media';
import type { ImportWait } from '../media/importer';
import { flagOn } from '../flags';
import { askImportCancel, claimImport, followImport, type ImportClaim } from './importTabs';

// The one import running on this device (ADR-0463 BF-0463-02).
//
// A folder import keeps going while the member moves on, so its progress cannot live in the
// component that started it. This module-level store owns it: ConnectMusic, the onboarding
// spine and the shell import chip all subscribe to the same snapshot. It does no fetching and
// runs no timer; the injected runner does the work and its events fold in here. A small
// localStorage marker records an import in flight, so a reload can honestly offer to carry on.

export type ImportRunner = (source: ImportSource, onProgress: (e: ImportEvent) => void, signal: AbortSignal) => Promise<ImportSummary>;

export type ImportPhase = 'idle' | 'running' | 'paused' | 'finished' | 'failed';

export type ImportSnapshot = {
  phase: ImportPhase;
  folder: string | null;
  /** Audio files found in the source; null until the walk has finished. */
  total: number | null;
  skipped: number;
  /** The file being worked on right now, by name only. */
  current: string | null;
  /** Songs recorded on this device and in Cloud: imported + duplicates. */
  registered: number;
  imported: number;
  duplicates: number;
  failures: readonly { name: string; reason: string }[];
  /** Registration batches confirmed present on this device. */
  batches: number;
  summary: ImportSummary | null;
  error: string | null;
  /** `cloud.resilient_import`: files read and recorded on this device so far, including those an
   * interrupted run already did. Undefined where the import does not count them. */
  checked?: number;
  /** Of `checked`, the files an earlier, interrupted run had already done. */
  resumed?: number;
  /** Sending is waiting for the connection, the service or a sign-in; reading carries on. */
  waiting?: ImportWait | null;
  /** Every file has been read; only sending may still be going on. */
  read?: boolean;
  /** Another tab of this browser is doing this import; this one follows its progress. */
  elsewhere?: boolean;
};

export const IDLE_IMPORT: ImportSnapshot = Object.freeze({
  phase: 'idle',
  folder: null,
  total: null,
  skipped: 0,
  current: null,
  registered: 0,
  imported: 0,
  duplicates: 0,
  failures: Object.freeze([]) as readonly { name: string; reason: string }[],
  batches: 0,
  summary: null,
  error: null,
});

export type ImportMarker = {
  version: 1;
  folder: string | null;
  startedAt: number;
  total: number | null;
  registered: number;
  /** `cloud.resilient_import`: what the member picked. A folder handle can be asked for again;
   * plain picked files are gone after a reload by the browser's design. */
  kind?: 'folder' | 'files';
  checked?: number;
  /** The import's id, kept across resumes. */
  importId?: string;
  /** Set when the shell went away (sign-in ended, sign-out) and the import was kept. */
  kept?: boolean;
};

/** The abort reason of an import paused because the shell went away: its progress is kept. */
export const IMPORT_SUSPENDED = 'selecta-import-suspended';

export const importMarkerKey = (workspaceId: string) => `selecta.import.${workspaceId}`;

type Session = {
  controller: AbortController;
  workspaceId: string;
  startedAt: number;
  kind?: 'folder' | 'files';
  importId?: string;
  /** `cloud.resilient_import`: the claim that makes this tab the one doing the import. */
  claim?: ImportClaim;
  /** Set when the shell went away: the run stops but keeps its marker and journal. */
  suspended?: boolean;
  /** Set by a deliberate cancel: the marker is gone and must not be written again. */
  cancelled: boolean;
  /** Set once the run has settled. */
  settled: boolean;
};

let snapshot: ImportSnapshot = IDLE_IMPORT;
let session: Session | null = null;
const listeners = new Set<() => void>();
/** Whose import the snapshot describes, and which workspace is signed in on this page
 * (ADR-0469). A snapshot carries a folder name and file names, so one account's import is
 * never shown to another account that signs in to the same tab afterwards. */
let snapshotWorkspace: string | null = null;
let activeWorkspace: string | null = null;

function publish(next: ImportSnapshot) {
  snapshot = next;
  session?.claim?.share(next);
  for (const listener of listeners) listener();
}

export function importSnapshot(): ImportSnapshot {
  if (activeWorkspace !== null && snapshotWorkspace !== null && snapshotWorkspace !== activeWorkspace) return IDLE_IMPORT;
  return snapshot;
}

/** Say which workspace this page is signed in to. Another workspace's import, running or
 * settled, then reads as idle everywhere (chip, progress panel, announcer). */
export function bindImportWorkspace(workspaceId: string | null): void {
  if (activeWorkspace === workspaceId) return;
  activeWorkspace = workspaceId;
  for (const listener of listeners) listener();
}

export function subscribeImport(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The snapshot as one workspace may see it: another workspace's import reads as idle. */
export function importSnapshotFor(workspaceId: string | undefined): ImportSnapshot {
  if (workspaceId !== undefined && snapshotWorkspace !== null && snapshotWorkspace !== workspaceId) return IDLE_IMPORT;
  return importSnapshot();
}

/** Pass the signed-in workspace wherever it is known: the filter then holds from the very first
 * render, before any binding effect has run. */
export function useImportSession(workspaceId?: string): ImportSnapshot {
  const read = () => importSnapshotFor(workspaceId);
  return useSyncExternalStore(subscribeImport, read, read);
}

function writeMarker(workspaceId: string, marker: ImportMarker) {
  try {
    localStorage.setItem(importMarkerKey(workspaceId), JSON.stringify(marker));
  } catch {
    // No storage (private window, quota, disabled): the import still runs, it just cannot
    // offer to carry on after a reload.
  }
}

export function readImportMarker(workspaceId: string): ImportMarker | null {
  try {
    const raw = localStorage.getItem(importMarkerKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImportMarker> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.startedAt !== 'number' || typeof parsed.registered !== 'number') return null;
    return {
      version: 1,
      folder: typeof parsed.folder === 'string' ? parsed.folder : null,
      startedAt: parsed.startedAt,
      total: typeof parsed.total === 'number' ? parsed.total : null,
      registered: parsed.registered,
      ...(parsed.kind === 'folder' || parsed.kind === 'files' ? { kind: parsed.kind } : {}),
      ...(typeof parsed.checked === 'number' ? { checked: parsed.checked } : {}),
      ...(typeof parsed.importId === 'string' ? { importId: parsed.importId } : {}),
      ...(parsed.kept === true ? { kept: true } : {}),
    };
  } catch {
    return null;
  }
}

export function clearImportMarker(workspaceId: string): void {
  try {
    localStorage.removeItem(importMarkerKey(workspaceId));
  } catch {
    // Nothing to clear where there is no storage.
  }
}

function markerFor(owner: Session, state: ImportSnapshot, kept = false): ImportMarker {
  return {
    version: 1, folder: state.folder, startedAt: owner.startedAt, total: state.total, registered: state.registered,
    ...(owner.kind ? { kind: owner.kind } : {}),
    ...(state.checked !== undefined ? { checked: state.checked } : {}),
    ...(owner.importId ? { importId: owner.importId } : {}),
    ...(kept ? { kept: true } : {}),
  };
}

/** Whether any workspace on this browser has an import kept for later (the shell went away part
 * way, as when a sign-in ends), so a sign-in page can say it is kept. Names nothing. */
export function keptImportWaiting(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith('selecta.import.')) continue;
      const raw = localStorage.getItem(key);
      if (raw && (JSON.parse(raw) as { kept?: unknown } | null)?.kept === true) return true;
    }
  } catch { /* no storage: nothing to say */ }
  return false;
}

/** Folds one runner event into the snapshot. Pure apart from the marker write on a batch. */
function fold(owner: Session, event: ImportEvent) {
  const state = snapshot;
  switch (event.kind) {
    case 'collected':
      publish({ ...state, total: event.total, skipped: event.skipped });
      return;
    case 'file':
      if (event.stage === 'hashing' || event.stage === 'registering') {
        publish({ ...state, current: event.name });
      } else if (event.stage === 'done') {
        const duplicate = event.duplicateOf !== undefined;
        publish({
          ...state,
          current: event.name,
          registered: state.registered + 1,
          imported: state.imported + (duplicate ? 0 : 1),
          duplicates: state.duplicates + (duplicate ? 1 : 0),
        });
      } else if (event.stage === 'failed') {
        publish({ ...state, current: event.name, failures: [...state.failures, { name: event.name, reason: event.reason }] });
      }
      return;
    case 'batch': {
      const next = { ...state, batches: state.batches + 1 };
      publish(next);
      if (!owner.cancelled) writeMarker(owner.workspaceId, markerFor(owner, next));
      return;
    }
    case 'paused':
      publish({ ...state, phase: 'paused', current: null, waiting: null });
      return;
    case 'checked': {
      const next = { ...state, current: event.name, checked: (state.checked ?? 0) + 1, resumed: (state.resumed ?? 0) + (event.resumed ? 1 : 0) };
      publish(next);
      // a reload part way says honestly how far it got, without a write per file
      if (!owner.cancelled && next.checked % 25 === 0) writeMarker(owner.workspaceId, markerFor(owner, next));
      return;
    }
    case 'waiting':
      publish({ ...state, waiting: event.wait });
      return;
    case 'read':
      publish({ ...state, read: true });
      return;
    case 'finished':
      // The run's resolved summary is the authority; see startImportSession.
      return;
  }
}

/** Starts the device's one import. A second start cancels the first through its
 * AbortController. Resolves with the run's honest summary; rejects only when the run itself
 * rejects (the snapshot then carries the error and the marker stays, so the member can carry
 * on). The returned promise is pre-handled, so firing and forgetting never reports an
 * unhandled rejection.
 *
 * With `cloud.resilient_import` on, the run first claims this workspace's import across tabs
 * (another tab already importing makes this one follow it instead), a reload while files are
 * mid-read asks first, and `resume` carries on an interrupted import under its own id. */
export function startImportSession(options: {
  source: ImportSource;
  run: ImportRunner;
  workspaceId: string;
  folder?: string | null;
  kind?: 'folder' | 'files';
  resume?: ImportMarker | null;
}): Promise<ImportSummary> {
  const resilient = flagOn('cloud.resilient_import');
  // a run this tab is stopping still holds the cross-tab claim until it settles
  const prior = session && !session.settled ? lastRun : null;
  if (session && !session.settled) cancelImportSession();
  stopFollowing();
  const resume = resilient ? options.resume ?? null : null;
  const owner: Session = {
    controller: new AbortController(), workspaceId: options.workspaceId, startedAt: resume?.startedAt ?? Date.now(), cancelled: false, settled: false,
    ...(resilient ? { kind: options.kind ?? 'files', importId: resume?.importId ?? newImportId() } : {}),
  };
  session = owner;
  snapshotWorkspace = owner.workspaceId;
  const folder = options.folder ?? null;
  publish({ ...IDLE_IMPORT, phase: 'running', folder, ...(resilient ? { checked: 0, resumed: 0, waiting: null, read: false } : {}) });
  const live = () => session === owner;
  const running = (async () => {
    let unhook = () => {};
    if (resilient) {
      if (prior) await prior.catch(() => undefined);
      const claim = await claimImport(owner.workspaceId);
      if (!claim) {
        // another tab is importing for this workspace: follow it, never start a second run
        owner.settled = true;
        if (live()) { session = null; follow(owner.workspaceId); }
        return { ...EMPTY_SUMMARY };
      }
      if (!live() || owner.controller.signal.aborted) {
        owner.settled = true;
        claim.release();
        return { ...EMPTY_SUMMARY, cancelled: true };
      }
      owner.claim = claim;
      claim.share(snapshot);
      claim.onCancelAsked(() => { if (live()) cancelImportSession(); });
      unhook = guardUnload(live);
    }
    writeMarker(owner.workspaceId, markerFor(owner, snapshot));
    try {
      const summary = await options.run(options.source, (event) => { if (live()) fold(owner, event); }, owner.controller.signal);
      owner.settled = true;
      if (live()) {
        if (!summary.paused && !owner.cancelled && !owner.suspended) clearImportMarker(owner.workspaceId);
        publish({ ...snapshot, phase: summary.paused ? 'paused' : 'finished', current: null, summary, ...(resilient ? { waiting: null } : {}) });
      }
      return summary;
    } catch (error) {
      owner.settled = true;
      if (live()) {
        const message = resilient
          ? importProblemWords(error)
          : error instanceof Error && error.message ? error.message : 'The import stopped before it finished. Try again to carry on.';
        publish({ ...snapshot, phase: 'failed', current: null, error: message, ...(resilient ? { waiting: null } : {}) });
      }
      throw error;
    } finally {
      unhook();
      owner.claim?.release();
    }
  })();
  running.catch(() => {});
  lastRun = running;
  return running;
}

let lastRun: Promise<ImportSummary> | null = null;

const EMPTY_SUMMARY: ImportSummary = { imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false };

function newImportId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A stopped import in plain words: never a raw browser error. */
export function importProblemWords(error: unknown): string {
  const status = typeof (error as { status?: unknown } | null)?.status === 'number' ? (error as { status: number }).status : null;
  const name = (error as { name?: string } | null)?.name;
  if (status === 401 || name === 'LoginRequiredError') return 'Sign in again to carry on. Your import is kept.';
  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return 'SelectaDJ could not add these songs to your account. Everything already checked is kept; try again to carry on.';
  }
  return 'The import stopped part way. Everything already checked is kept, and it carries on from there.';
}

/** While files are being read, closing or reloading the tab asks first. Nothing is lost if the
 * member leaves anyway: the import carries on next time from the journal. */
function guardUnload(live: () => boolean): () => void {
  if (typeof window === 'undefined') return () => {};
  const ask = (event: BeforeUnloadEvent) => {
    if (!live() || snapshot.phase !== 'running' || snapshot.read || snapshot.elsewhere) return;
    event.preventDefault();
    // older browsers show a prompt only when returnValue is set; none show custom words now
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', ask);
  return () => window.removeEventListener('beforeunload', ask);
}

/** Fired on `window` when another tab that was importing has let go, so this tab can check
 * whether there is an interrupted import to carry on. */
export const IMPORT_TAB_FREED = 'selecta:import-tab-freed';

let following: { workspaceId: string; stop: () => void } | null = null;

function stopFollowing() {
  following?.stop();
  following = null;
}

function follow(workspaceId: string) {
  stopFollowing();
  snapshotWorkspace = workspaceId;
  publish({ ...IDLE_IMPORT, phase: 'running', elsewhere: true, checked: 0, resumed: 0, waiting: null, read: false });
  const mine = {
    workspaceId,
    stop: followImport(workspaceId, (shared) => {
      if (following !== mine || session) return;
      publish({ ...shared, elsewhere: true });
    }, () => {
      if (following !== mine) return;
      stopFollowing();
      if (!session && snapshot.elsewhere && snapshot.phase === 'running') publish(IDLE_IMPORT);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(IMPORT_TAB_FREED));
    }),
  };
  following = mine;
}

/** A deliberate stop: aborts the run and clears the marker. What already registered stays in
 * the snapshot, and the run's own cancelled summary finishes it. In a tab that only follows
 * another tab's import, the importing tab is asked to cancel. */
export function cancelImportSession(): void {
  if (following && !session) {
    askImportCancel(following.workspaceId);
    return;
  }
  const owner = session;
  if (!owner || owner.settled) return;
  owner.cancelled = true;
  clearImportMarker(owner.workspaceId);
  owner.controller.abort();
}

/** Dismisses a settled import's result. A running import cannot be cleared away. */
export function clearImportSession(): void {
  if (snapshot.phase === 'idle' || snapshot.phase === 'running') return;
  if (session && !session.settled) return;
  session = null;
  snapshotWorkspace = null;
  publish(IDLE_IMPORT);
}

/** The shell is going away (sign-out, account switch, a sign-in that ended): forget the snapshot
 * entirely, so nothing of it (folder, file names, summary) outlives the shell. With
 * `cloud.resilient_import` a running import is paused, not cancelled: its marker and journal
 * stay, and it carries on when this workspace's shell opens again. Off, it is cancelled as a
 * deliberate stop always was. */
export function endImportSession(): void {
  const owner = session;
  if (flagOn('cloud.resilient_import') && owner && !owner.settled) {
    owner.suspended = true;
    writeMarker(owner.workspaceId, markerFor(owner, snapshot, true));
    owner.controller.abort(IMPORT_SUSPENDED);
  } else {
    cancelImportSession();
  }
  stopFollowing();
  session = null;
  snapshotWorkspace = null;
  publish(IDLE_IMPORT);
}

/** Whether this page is running (not following) an import right now. */
export function importRunningHere(): boolean {
  return session !== null && !session.settled;
}
