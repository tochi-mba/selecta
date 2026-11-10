import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { SetPlayer } from '../player';
import { refreshJobs } from '../state/jobs';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { clearToasts } from '../ui/toasts';

/**
 * S4-0092-09 and S4-0107-08: storage and analysis blockers are reachable from every page, not only
 * from Workspace, through one quiet header indicator that names the count and links straight to the fix.
 */
const jobs = (more: Record<string, unknown> = {}) => ({
  worker: { running: true, rendering_the_mix: false },
  mix: { queued: 0, rendering: 0, failed: 0, none: 0, ready: 2 },
  drafts_in_line: 0,
  storage_full: false,
  analysis: { running: false, paused: false, asked_for: 0, left: 0 },
  failed_seams: [],
  failed_songs: [],
  estimates: '',
  ...more,
});

const backend = (jobsReply: Record<string, unknown>) => fakeBackend({
  'GET /status': status(),
  'GET /mix': () => ({ mix: songs(seam('ready', 'a')), name: 'Test mix', can_undo: false }),
  'GET /vibes': [],
  'GET /requests': { requests: [] },
  'GET /drafts': { drafts: [], current: { name: 'Test mix', songs: 2, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
  'GET /library': { songs: [], total: 0, next: null },
  'GET /jobs': jobsReply,
});

const header = () => document.querySelector('.context-bar') as HTMLElement;

beforeEach(() => {
  clearToasts();
  window.localStorage.clear();
  vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});
});

describe('S4-0092-09 / S4-0107-08 global health attention', () => {
  it('a full storage limit and a paused analysis queue show on Library with a direct route to Workspace', async () => {
    window.history.pushState({}, '', '/library');
    backend(jobs({ storage_full: true, analysis: { running: false, paused: true, asked_for: 0, left: 5 } }));
    render(<App />);
    await act(async () => { await refreshJobs(); });
    const link = await waitFor(() => within(header()).getByRole('link', { name: 'Workspace, 2 items need your attention' }));
    expect(link).toHaveAttribute('href', '/workshop');
    expect(link).toHaveTextContent('2');
    expect(window.location.pathname).toBe('/library');
  });

  it('a paused queue with nothing left, or a healthy server, adds nothing to the header', async () => {
    window.history.pushState({}, '', '/mixes');
    backend(jobs({ analysis: { running: false, paused: true, asked_for: 0, left: 0 } }));
    render(<App />);
    await act(async () => { await refreshJobs(); });
    await screen.findByRole('navigation', { name: 'Main' });
    expect(within(header()).queryByRole('link', { name: /needs? your attention/ })).toBeNull();
  });

  it('a single failed song reads in the singular', async () => {
    window.history.pushState({}, '', '/listen');
    backend(jobs({ failed_songs: [{ id: 1, title: 'Broken', artist: 'A' }] }));
    render(<App />);
    await act(async () => { await refreshJobs(); });
    await waitFor(() => expect(within(header()).getByRole('link', { name: 'Workspace, 1 item needs your attention' })).toHaveAttribute('href', '/workshop'));
  });
});
