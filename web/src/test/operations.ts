import { ApiError, ExportJob, ExportJobState, Jobs, SeamState } from '../api';
import type { RequestRow } from '../views/Requests';

/**
 * T0012: one shared set of operation fixtures for tests. Every kind of long-running work the app shows
 * (a transition render, a song request, a Studio stem session and an export) has a fixture for each
 * of the six states a page must describe truthfully: pending, ready, failed, canceled, stale and
 * storage-blocked. `operations.test.ts` checks each fixture still means what its name says.
 */
export const OPERATION_STATES = ['pending', 'ready', 'failed', 'canceled', 'stale', 'storageBlocked'] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

/** What a server says when the disk is full, as the client sees it. */
export const storageFull = () => new ApiError('There isn’t enough free space to save that.', 507, 'storage_full');

/** A transition render, as `seam.state` on a mix row. `blocked` is the placement guard (`too_soon`). */
export type RenderFixture = { state: SeamState; tooSoon?: boolean; error?: ApiError };
export const RENDER: Record<OperationState, RenderFixture> = {
  pending: { state: { status: 'queued', key: 'render-pending' } },
  ready: { state: { status: 'ready', key: 'render-ready', passed: true } },
  failed: { state: { status: 'failed', key: 'render-failed', error: 'The render stopped part way.' } },
  // a render nobody needs any more goes back to "none": nothing is made and nothing claims success
  canceled: { state: { status: 'none', key: 'render-canceled' } },
  // cached audio for a placement that would now cut off the song before it
  stale: { state: { status: 'ready', key: 'render-stale', passed: true }, tooSoon: true },
  storageBlocked: { state: { status: 'failed', key: 'render-storage', error: 'Not enough free space.' }, error: storageFull() },
};

/** A Studio stem session has the same lifecycle words as a render. */
export type StemFixture = { status: SeamState['status']; error?: string; stale?: boolean; problem?: ApiError };
export const STEM: Record<OperationState, StemFixture> = {
  pending: { status: 'rendering' },
  ready: { status: 'ready' },
  failed: { status: 'failed', error: 'The stems could not be separated.' },
  canceled: { status: 'none' },
  // saved stems for a transition whose settings have since changed
  stale: { status: 'ready', stale: true },
  storageBlocked: { status: 'failed', error: 'Not enough free space.', problem: storageFull() },
};

const request = (more: Partial<RequestRow>): RequestRow => ({ id: 7, song_id: 7, title: 'Requested', artist: 'Artist', status: 'pending', available: 1, ...more });

/** A song request, with the stage the Requests page shows it at. */
export const REQUEST: Record<OperationState, { row: RequestRow; stage: 'preparing' | 'ready' | 'no_cues' | 'searching' | 'approve' | 'waiting'; problem?: ApiError }> = {
  pending: { row: request({ stage: 'preparing', after: 'Song 2' }), stage: 'preparing' },
  ready: { row: request({ stage: 'ready', ready: true, after: 'Song 2' }), stage: 'ready' },
  failed: { row: request({ no_cues: true }), stage: 'no_cues' },
  // the listener said no to the bridge, so that plan is withdrawn
  canceled: { row: request({ stage: 'approve', declined: true, bridge_choice: false }), stage: 'searching' },
  // the approved bridge stopped fitting after the mix changed
  stale: { row: request({ stage: 'approve', bridge_lost: true, needs_approval: true }), stage: 'approve' },
  storageBlocked: { row: request({ stage: 'preparing' }), stage: 'waiting', problem: storageFull() },
};

const job = (state: ExportJobState, more: Partial<ExportJob> = {}): ExportJob => ({
  id: `export-${state}`, state, scope: 'current', draft: null, mix_name: 'Current mix', revision: 'rev-1',
  songs: [{ song_id: 1, title: 'Song 1', artist: 'Artist 1' }, { song_id: 2, title: 'Song 2', artist: 'Artist 2' }],
  seams: [{ key: 'seam-1', from: 'Song 1', to: 'Song 2' }], seams_total: 1, seams_ready: state === 'ready' ? 1 : 0,
  seconds_estimate: 30, name: 'Current mix.flac', seconds: state === 'ready' ? 400 : null, error: null,
  created_at: 1_700_000_000, can_cancel: state === 'preparing' || state === 'encoding', quiet_seconds: 0, ...more,
});

/** A FLAC export job. */
export const EXPORT: Record<OperationState, ExportJob> = {
  pending: job('preparing'),
  ready: job('ready'),
  failed: job('failed', { error: 'The file could not be written.' }),
  canceled: job('cancelled'),
  stale: job('expired'),
  storageBlocked: job('failed', { error: 'There isn’t enough free space to save that.' }),
};

/** The background queue, as /jobs reports it, with nothing wrong unless a test says so. */
export function jobs(more: Partial<Jobs> = {}): Jobs {
  return {
    worker: { running: true, rendering_the_mix: false },
    mix: { queued: 0, rendering: 0, failed: 0, none: 0, ready: 3 },
    drafts_in_line: 0,
    storage_full: false,
    analysis: { running: false, paused: false, asked_for: 0, left: 0 },
    failed_seams: [],
    failed_songs: [],
    estimates: '',
    ...more,
  };
}

/** Analysis waiting behind a full disk. */
export const STORAGE_BLOCKED_JOBS = jobs({ storage_full: true, analysis: { running: false, paused: false, asked_for: 4, left: 4 } });
