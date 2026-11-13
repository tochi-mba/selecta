import { useSyncExternalStore } from 'react';
import { ApiError, del, ExportJob, get, post } from '../api';

/** What's known about exports, shared by whatever is showing them. The work itself happens on the
 * server, so closing a panel or reloading loses nothing: this only has to ask again. It only asks
 * while something is showing, and more often while something's under way. */

export type ExportsNow = {
  jobs: ExportJob[] | null;
  /** The last check failed, so what's shown may be out of date. */
  stale: boolean;
  /** This server is too old to have export jobs. */
  unsupported: boolean;
};

const QUICK_MS = 1500;
const SLOW_MS = 15000;
const ACTIVE = new Set(['preparing', 'encoding', 'cancelling']);

let now: ExportsNow = { jobs: null, stale: false, unsupported: false };
function validJob(value: unknown): value is ExportJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<ExportJob>;
  return typeof job.id === 'string'
    && typeof job.name === 'string'
    && typeof job.mix_name === 'string'
    // a state this site doesn't know yet is still a job: its own row says "State unknown"
    // (ExportJobs.tsx exportStage), and the rest of the list stays readable
    && typeof job.state === 'string' && job.state.length > 0
    && (job.scope === 'current' || job.scope === 'draft')
    && Array.isArray(job.songs)
    && typeof job.created_at === 'number' && Number.isFinite(job.created_at)
    && typeof job.can_cancel === 'boolean';
}

let asked = 0;
let timer: number | undefined;
const listeners = new Set<() => void>();

function changed(next: Partial<ExportsNow>) {
  now = { ...now, ...next };
  for (const listener of listeners) listener();
}

export const isExportActive = (job: Pick<ExportJob, 'state'>) => ACTIVE.has(job.state);

export function refreshExports(): Promise<void> {
  const mine = ++asked;
  return get<{ jobs: ExportJob[] }>('/exports/jobs').then(
    (answer) => {
      // an answer to an older question can't overwrite a newer one
      if (mine !== asked) return;
      // An older or partial response is not an empty export list.
      if (!Array.isArray(answer?.jobs) || !answer.jobs.every(validJob)) changed({ stale: true });
      else changed({ jobs: answer.jobs, stale: false, unsupported: false });
    },
    (error: unknown) => {
      if (mine !== asked) return;
      if (error instanceof ApiError && (error.status === 404 || error.status === 405)) changed({ jobs: [], stale: false, unsupported: true });
      else changed({ stale: true });
    },
  );
}

function schedule() {
  window.clearTimeout(timer);
  if (!listeners.size || document.visibilityState === 'hidden') return;
  const busy = now.jobs?.some(isExportActive);
  timer = window.setTimeout(() => {
    void refreshExports().finally(schedule);
  }, busy ? QUICK_MS : SLOW_MS);
}

const whenVisible = () => {
  if (document.visibilityState === 'hidden') {
    window.clearTimeout(timer);
  } else if (listeners.size) {
    void refreshExports().finally(schedule);
  }
};

function subscribe(listener: () => void) {
  const first = !listeners.size;
  listeners.add(listener);
  if (first) {
    document.addEventListener('visibilitychange', whenVisible);
    void refreshExports().finally(schedule);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', whenVisible);
    }
  };
}

export function useExports(): ExportsNow {
  return useSyncExternalStore(subscribe, () => now);
}

function known(job: ExportJob) {
  const others = (now.jobs ?? []).filter((item) => item.id !== job.id);
  changed({ jobs: [job, ...others], unsupported: false });
  schedule();
}

/** `path` already says which mix. `guard` stops it if the mix has changed since it was last shown. */
export async function startExport(path: string, guard: Record<string, string>): Promise<ExportJob> {
  asked += 1;
  const job = await post<ExportJob>(path, undefined, guard);
  // A job may have been created even if the reply was malformed; callers
  // retain their operation ID on this uncertain result and can retry safely.
  if (!validJob(job)) throw new Error('The export started, but its details could not be read. Retry to recover its status.');
  known(job);
  return job;
}

export async function cancelExport(id: string): Promise<void> {
  asked += 1;
  const job = await del<ExportJob>(`/exports/jobs/${id}`);
  if (!validJob(job)) throw new Error('Couldn’t confirm the export was cancelled. Check its latest status.');
  known(job);
}

/** For the tests: forget everything. */
export function resetExports() {
  window.clearTimeout(timer);
  asked += 1;
  now = { jobs: null, stale: false, unsupported: false };
}
