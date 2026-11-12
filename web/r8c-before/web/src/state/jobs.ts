import { useSyncExternalStore } from 'react';
import { ApiError, get, Jobs } from '../api';

type JobsSnapshot = { jobs: Jobs | null; stale: boolean; unsupported: boolean };

let snapshot: JobsSnapshot = { jobs: null, stale: false, unsupported: false };
let timer: number | null = null;
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function completeJobs(value: Jobs): boolean {
  return !!value
    && Array.isArray(value.failed_seams)
    && Array.isArray(value.failed_songs)
    && !!value.mix
    && typeof value.mix.queued === 'number'
    && typeof value.mix.rendering === 'number'
    && typeof value.mix.none === 'number'
    && !!value.analysis
    && typeof value.analysis.left === 'number';
}

const onVisible = () => {
  if (document.visibilityState === 'visible' && listeners.size) void refreshJobs();
};

function publish(next: JobsSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function refreshJobs(): Promise<void> {
  if (reading) return reading;
  reading = get<Jobs>('/jobs')
    .then((jobs) => {
      if (completeJobs(jobs)) publish({ jobs, stale: false, unsupported: false });
      else publish({ ...snapshot, stale: true, unsupported: false });
    })
    .catch((error) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
        publish({ jobs: null, stale: false, unsupported: true });
      } else {
        publish({ ...snapshot, stale: true });
      }
    })
    .finally(() => { reading = null; });
  return reading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshJobs();
    timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void refreshJobs();
    }, 5000);
    document.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== null) {
      window.clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

export function useJobsStatus(): JobsSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function jobAttention(jobs: Jobs | null): number {
  // A partially upgraded server (or a response interrupted at a version
  // boundary) may omit the failure lists. Never let a status badge take down
  // navigation and playback while the rest of Selecta remains usable.
  if (!jobs || !Array.isArray(jobs.failed_seams) || !Array.isArray(jobs.failed_songs) || !jobs.analysis) return 0;
  return Number(jobs.storage_full)
    + jobs.failed_seams.length
    + jobs.failed_songs.length
    + Number(jobs.analysis.paused && jobs.analysis.left > 0);
}

/** S4-0092-09: the words a screen reader hears when Workspace starts needing attention, naming each
 * blocker so nobody has to open Workspace to learn what stopped. Empty when nothing is wrong. */
export function attentionWords(jobs: Jobs | null): string {
  const count = jobAttention(jobs);
  if (!jobs || count === 0) return '';
  const parts: string[] = [];
  if (jobs.storage_full) parts.push('storage is full');
  if (jobs.analysis.paused && jobs.analysis.left > 0) parts.push(`analysis is paused with ${jobs.analysis.left} ${jobs.analysis.left === 1 ? 'song' : 'songs'} left`);
  if (jobs.failed_songs.length) parts.push(`${jobs.failed_songs.length} ${jobs.failed_songs.length === 1 ? 'song' : 'songs'} failed`);
  if (jobs.failed_seams.length) parts.push(`${jobs.failed_seams.length} ${jobs.failed_seams.length === 1 ? 'transition' : 'transitions'} failed`);
  return `Workspace needs your attention: ${parts.join(', ')}.`;
}
