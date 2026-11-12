import type { ExportJobState, Jobs, SeamState } from '../api';
import type { StatusKind } from '../ui/controls';
import type { Loaded } from './async';

/** UF-0371-01: one vocabulary for anything that takes time. Every source of asynchronous truth in the
 * app (a page read, a seam render, the analysis queue, an export) maps onto these nine words, so two
 * pages can never describe the same work differently, and only `ready` ever counts as success
 * (UF-0371-06). The cross-route matrix is in docs/engineering/async-state-vocabulary.md. */
export type WorkState = 'initial' | 'stale' | 'queued' | 'running' | 'paused' | 'blocked' | 'cancelled' | 'failed' | 'ready';

export const WORK_STATES: readonly WorkState[] = ['initial', 'stale', 'queued', 'running', 'paused', 'blocked', 'cancelled', 'failed', 'ready'];

/** The words and the shared status mark each state is shown with. A status is never colour alone. */
export const WORK_WORDS: Record<WorkState, { words: string; kind: StatusKind }> = {
  initial: { words: 'Not known yet', kind: 'planned' },
  stale: { words: 'May be out of date', kind: 'warning' },
  queued: { words: 'Waiting in line', kind: 'queued' },
  running: { words: 'Working on it', kind: 'working' },
  paused: { words: 'Paused', kind: 'paused' },
  blocked: { words: 'Can’t go ahead yet', kind: 'blocked' },
  cancelled: { words: 'Cancelled', kind: 'unavailable' },
  failed: { words: 'Didn’t work', kind: 'failed' },
  ready: { words: 'Ready', kind: 'ready' },
};

/** Only finished, current work is a success. Cancelled, superseded, stale and failed work never is. */
export const isSuccess = (state: WorkState) => state === 'ready';

/** A page read: nothing yet, an answer, or the last good answer kept after a failed refresh. */
export function loadedState(loaded: Pick<Loaded<unknown>, 'state'>): WorkState {
  switch (loaded.state) {
    case 'loading': return 'initial';
    case 'refreshing': return 'running';
    case 'stale': return 'stale';
    case 'failed': return 'failed';
    default: return 'ready';
  }
}

/** A transition render. One that can't be made where it was placed is blocked, not waiting. */
export function seamState(status: SeamState['status'], blocked = false): WorkState {
  if (status === 'ready') return blocked ? 'blocked' : 'ready';
  if (status === 'failed') return 'failed';
  if (blocked) return 'blocked';
  if (status === 'rendering') return 'running';
  if (status === 'queued') return 'queued';
  return 'initial';
}

/** The analysis queue, from /jobs. A full disk blocks it before anything else. */
export function analysisState(jobs: Pick<Jobs, 'analysis' | 'storage_full'>): WorkState {
  const { analysis } = jobs;
  if (analysis.left <= 0) return 'ready';
  if (jobs.storage_full) return 'blocked';
  if (analysis.paused) return 'paused';
  return analysis.running ? 'running' : 'queued';
}

/** An export job. A job being cancelled is still running until the server says it has stopped. */
export function exportState(state: ExportJobState): WorkState {
  switch (state) {
    case 'preparing': return 'queued';
    case 'encoding':
    case 'cancelling': return 'running';
    case 'ready': return 'ready';
    case 'cancelled': return 'cancelled';
    case 'expired': return 'stale';
    default: return 'failed';
  }
}
