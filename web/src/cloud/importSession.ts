import { useSyncExternalStore } from 'react';
import type { ImportEvent, ImportSource, ImportSummary } from '../media';

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

export type ImportMarker = { version: 1; folder: string | null; startedAt: number; total: number | null; registered: number };

export const importMarkerKey = (workspaceId: string) => `selecta.import.${workspaceId}`;

type Session = {
  controller: AbortController;
  workspaceId: string;
  startedAt: number;
  /** Set by a deliberate cancel: the marker is gone and must not be written again. */
  cancelled: boolean;
  /** Set once the run has settled. */
  settled: boolean;
};

let snapshot: ImportSnapshot = IDLE_IMPORT;
let session: Session | null = null;
const listeners = new Set<() => void>();

function publish(next: ImportSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function importSnapshot(): ImportSnapshot {
  return snapshot;
}

export function subscribeImport(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useImportSession(): ImportSnapshot {
  return useSyncExternalStore(subscribeImport, importSnapshot, importSnapshot);
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

function markerFor(owner: Session, state: ImportSnapshot): ImportMarker {
  return { version: 1, folder: state.folder, startedAt: owner.startedAt, total: state.total, registered: state.registered };
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
      publish({ ...state, phase: 'paused', current: null });
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
 * unhandled rejection. */
export function startImportSession(options: { source: ImportSource; run: ImportRunner; workspaceId: string; folder?: string | null }): Promise<ImportSummary> {
  if (session && !session.settled) cancelImportSession();
  const owner: Session = { controller: new AbortController(), workspaceId: options.workspaceId, startedAt: Date.now(), cancelled: false, settled: false };
  session = owner;
  const folder = options.folder ?? null;
  publish({ ...IDLE_IMPORT, phase: 'running', folder });
  writeMarker(owner.workspaceId, markerFor(owner, snapshot));
  const live = () => session === owner;
  const running = (async () => {
    try {
      const summary = await options.run(options.source, (event) => { if (live()) fold(owner, event); }, owner.controller.signal);
      owner.settled = true;
      if (live()) {
        if (!summary.paused && !owner.cancelled) clearImportMarker(owner.workspaceId);
        publish({ ...snapshot, phase: summary.paused ? 'paused' : 'finished', current: null, summary });
      }
      return summary;
    } catch (error) {
      owner.settled = true;
      if (live()) {
        const message = error instanceof Error && error.message ? error.message : 'The import stopped before it finished. Try again to carry on.';
        publish({ ...snapshot, phase: 'failed', current: null, error: message });
      }
      throw error;
    }
  })();
  running.catch(() => {});
  return running;
}

/** A deliberate stop: aborts the run and clears the marker. What already registered stays in
 * the snapshot, and the run's own cancelled summary finishes it. */
export function cancelImportSession(): void {
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
  publish(IDLE_IMPORT);
}
