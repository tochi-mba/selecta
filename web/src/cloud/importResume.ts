import { useEffect, useSyncExternalStore } from 'react';
import { flagOn } from '../flags';
import { recallFolder, runImport, type ImportSource, type MediaStore, type StoredFolderHandle } from '../media';
import type { Request, RetryPolicy } from '../media/importer';
import { ImportJournal } from '../media/importJournal';
import { IMPORT_RETRY_NOW } from '../media/journalledImport';
import { mediaDeviceId, registeredDeviceId } from './ConnectMusic';
import {
  clearImportSession, followImportElsewhere, IMPORT_SUSPENDED, IMPORT_TAB_FREED, importRunningHere, importSnapshot, readImportMarker, startImportSession,
  type ImportMarker, type ImportRunner,
} from './importSession';
import { getConnection } from './connection';
import { importingElsewhere } from './importTabs';
import { canHeal, withRetry } from './resilientRequest';
import { ImportFingerprints } from '../media/fingerprints';

// Carrying an interrupted import on (flag `cloud.resilient_import`).
//
// After a reload, a closed tab, a computer that slept or a sign-in that ended, the shell checks
// for an import that stopped part way. A remembered folder whose permission is still granted
// carries on by itself; one whose permission lapsed needs one press ("Allow access to <folder>
// to carry on"); plain picked files are gone after a reload by the browser's design, so the
// member is asked to choose the same files again and everything already done is skipped. The
// same check runs when the connection comes back, when the page becomes visible again and when
// another tab that was importing lets go.

export type ResumeOffer =
  | { kind: 'allow'; folder: string; handle: StoredFolderHandle; marker: ImportMarker }
  | { kind: 'repick'; folder: string | null; marker: ImportMarker };

let offer: ResumeOffer | null = null;
let offerWorkspace: string | null = null;
const listeners = new Set<() => void>();

function setOffer(workspaceId: string | null, next: ResumeOffer | null) {
  offer = next;
  offerWorkspace = next ? workspaceId : null;
  for (const listen of listeners) listen();
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => { listeners.delete(listen); };
}

/** The interrupted import this workspace could carry on, if any (null while one runs). */
export function useResumeOffer(workspaceId: string): ResumeOffer | null {
  const read = () => (offerWorkspace === workspaceId ? offer : null);
  return useSyncExternalStore(subscribe, read, read);
}

/** The import's patient retry, through the shared request layer where it is present. */
export const importRetry: RetryPolicy = (work, { signal, onWait } = {}) => {
  let waited = false;
  // the shared retry waits quietly while the connection store already knows it is offline
  if (getConnection().status === 'offline') { waited = true; onWait?.({ why: 'offline', retryAt: null }); }
  return withRetry(work, {
    attempts: Number.POSITIVE_INFINITY,
    baseMs: 2_000,
    maxMs: 60_000,
    signal,
    retryOn: (kind) => canHeal(kind) || kind === 'signed_out',
    onWait: (info) => {
      waited = true;
      onWait?.({
        why: info.offline || info.kind === 'offline' ? 'offline' : info.kind === 'signed_out' ? 'signin' : 'server',
        retryAt: info.offline ? null : Date.now() + info.delayMs,
      });
    },
    sleep: (ms, given) => waitOrNudge(ms, given),
  }).then((answer) => {
    if (waited) onWait?.(null);
    return answer;
  });
};

/** A retry wait that "Try now", a reconnect or the page coming back cuts short. */
function waitOrNudge(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Stopped.', 'AbortError')); return; }
    const done = () => { cleanup(); resolve(); };
    const visible = () => { if (document.visibilityState === 'visible') done(); };
    const aborted = () => { cleanup(); reject(new DOMException('Stopped.', 'AbortError')); };
    const timer = setTimeout(done, ms);
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      window.removeEventListener(IMPORT_RETRY_NOW, done);
      window.removeEventListener('online', done);
      document.removeEventListener('visibilitychange', visible);
    }
    signal?.addEventListener('abort', aborted);
    window.addEventListener(IMPORT_RETRY_NOW, done);
    window.addEventListener('online', done);
    document.addEventListener('visibilitychange', visible);
  });
}

/** "Try now": a waiting import tries again at once. */
export function retryImportNow(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(IMPORT_RETRY_NOW));
}

/** `cloud.content_cache` (ADR-0469 amendment): this browser's fingerprint memo and derived
 * store for one import, as an option to spread into the importer's options. Empty when the flag
 * is off or the store will not open, so the import is then exactly as it always was. */
export async function fingerprintOption(workspaceId: string): Promise<{ fingerprints?: ImportFingerprints }> {
  if (!flagOn('cloud.content_cache')) return {};
  try {
    return { fingerprints: await ImportFingerprints.start(workspaceId) };
  } catch {
    return {};
  }
}

type RunnerParts = { request: Request; openStore: () => Promise<MediaStore>; workspaceId: string; importer?: typeof runImport };

/** The import runner every surface uses. With `cloud.resilient_import` on, the run writes the
 * journal before any network call, skips what an earlier run did, retries patiently, and only
 * reports availability for a registered device; the journal is cleared once the import really
 * finished, and kept when it paused, failed or was put aside for a sign-in. Off, it is the
 * import as it always was. */
export function importRunnerFor({ request, openStore, workspaceId, importer = runImport }: RunnerParts, importId?: string): ImportRunner {
  return async (source, onProgress, signal) => {
    const store = await openStore();
    const reuse = await fingerprintOption(workspaceId);
    if (!flagOn('cloud.resilient_import')) {
      return importer({ source, request, store, deviceId: mediaDeviceId(workspaceId), onProgress, signal, ...reuse });
    }
    const journal = await ImportJournal.open(workspaceId);
    try {
      const summary = await importer({
        source, request, store, deviceId: mediaDeviceId(workspaceId), onProgress, signal,
        journal, retry: importRetry, reportDevice: () => registeredDeviceId(workspaceId), importId, ...reuse,
      });
      const putAside = signal.aborted && signal.reason === IMPORT_SUSPENDED;
      if (!summary.paused && !putAside) await journal.clear();
      return summary;
    } finally {
      journal.close();
    }
  };
}

/** Starts an import of `source` the way every surface should: through the shared runner, and as
 * the carrying on of `resume` where one is given. */
export function startImport(parts: RunnerParts, source: ImportSource, options: { folder?: string | null; kind: 'folder' | 'files'; resume?: ImportMarker | null }): void {
  setOffer(null, null);
  const resume = options.resume ?? null;
  void startImportSession({
    source, run: importRunnerFor(parts, resume?.importId), workspaceId: parts.workspaceId,
    folder: options.folder ?? null, kind: options.kind, resume,
  });
}

let registered: RunnerParts | null = null;

/** Look for an interrupted import and carry it on where that needs no press. */
export async function checkForInterruptedImport(parts: RunnerParts): Promise<void> {
  if (!flagOn('cloud.resilient_import') || importRunningHere()) return;
  const live = importSnapshot();
  if (live.phase === 'running') return;
  const kept = readImportMarker(parts.workspaceId);
  if (!kept) { if (offerWorkspace === parts.workspaceId) setOffer(null, null); return; }
  // another tab is importing: this one follows it and offers nothing (no carry on, no Forget this)
  // until that tab lets go, when this check runs again (IMPORT_TAB_FREED)
  if (await importingElsewhere(parts.workspaceId)) {
    if (registered !== parts || importRunningHere()) return;
    if (offerWorkspace === parts.workspaceId) setOffer(null, null);
    followImportElsewhere(parts.workspaceId);
    return;
  }
  // The marker is rewritten per sent batch; the journal holds every file already checked, which is
  // what a resume skips, so the offer counts from it.
  const journal = await ImportJournal.open(parts.workspaceId).catch(() => null);
  const checked = Math.max(kept.checked ?? kept.registered ?? 0, journal?.size ?? 0);
  journal?.close();
  const marker = { ...kept, checked };
  if (marker.kind !== 'folder') {
    setOffer(parts.workspaceId, { kind: 'repick', folder: marker.folder, marker });
    return;
  }
  const handle = await recallFolder(parts.workspaceId).catch(() => null);
  if (registered !== parts || importRunningHere()) return;
  if (!handle) {
    setOffer(parts.workspaceId, { kind: 'repick', folder: marker.folder, marker });
    return;
  }
  const permission = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt') : 'granted';
  if (registered !== parts || importRunningHere()) return;
  if (permission === 'granted') {
    // a settled (failed or paused) result gives way to the import carrying on
    clearImportSession();
    startImport(parts, handle, { folder: handle.name, kind: 'folder', resume: marker });
  } else {
    setOffer(parts.workspaceId, { kind: 'allow', folder: marker.folder ?? handle.name, handle, marker });
  }
}

/** The one press for a lapsed folder permission; must run inside a click. */
export async function allowAndCarryOn(given: ResumeOffer & { kind: 'allow' }): Promise<boolean> {
  const parts = registered;
  if (!parts) return false;
  const answer = given.handle.requestPermission ? await given.handle.requestPermission({ mode: 'read' }).catch(() => 'denied') : 'granted';
  if (answer !== 'granted') return false;
  clearImportSession();
  startImport(parts, given.handle, { folder: given.handle.name, kind: 'folder', resume: given.marker });
  return true;
}

/** Carry on a failed or paused import now (the "Try again" press). */
export function carryOnNow(): void {
  const live = importSnapshot();
  if (live.phase === 'running') { retryImportNow(); return; }
  if (registered) void checkForInterruptedImport(registered);
}

/** The shell's hook: registers how this workspace imports, checks for an interrupted import on
 * mount, and checks again on reconnect, on the page becoming visible and when another tab that
 * was importing lets go. */
export function useImportCarryOn(parts: RunnerParts): void {
  const { request, openStore, workspaceId, importer } = parts;
  useEffect(() => {
    if (!flagOn('cloud.resilient_import')) return undefined;
    const mine: RunnerParts = { request, openStore, workspaceId, importer };
    registered = mine;
    const check = () => {
      if (registered !== mine) return;
      const phase = importSnapshot().phase;
      // a running import waits by itself; the rest are worth a look
      if (phase === 'running') { retryImportNow(); return; }
      void checkForInterruptedImport(mine);
    };
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    void checkForInterruptedImport(mine);
    window.addEventListener('online', check);
    window.addEventListener(IMPORT_TAB_FREED, check);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener(IMPORT_TAB_FREED, check);
      document.removeEventListener('visibilitychange', visible);
      if (registered === mine) { registered = null; setOffer(null, null); }
    };
  }, [request, openStore, workspaceId, importer]);
}

/** Forget an interrupted import: its offer goes; ConnectMusic clears the marker and journal. */
export function dropResumeOffer(): void {
  setOffer(null, null);
}

/** The parts the shell registered, for surfaces that start an import themselves. */
export function registeredImportParts(): RunnerParts | null {
  return registered;
}
