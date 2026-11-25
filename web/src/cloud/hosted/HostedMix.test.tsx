import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../api';
import { EXPORT_FOLLOW_MS, HostedMix } from './HostedMix';

const songs = { songs: [], counts: { ready: 2, running: 0, queued: 0, failed: 0, not_started: 0 }, estimate_s: null, seconds_each: 1, total: 2 };
const mix = { parts: [], seams: [], complete: true, estimate_s: null, counts: { seams_ready: 1, seams: 1, songs_analysed: 2, songs: 2, files_ready: 2 } };

/** A server whose export job stays queued for ever. */
function stuckServer() {
  const polls = { count: 0 };
  const api = (async (path: string) => {
    if (path === '/hosted/songs/prepare') return songs;
    if (path === '/hosted/mixes/plan') return { songs: [{ asset_id: 'a', move: null }, { asset_id: 'b', move: null }] };
    if (path === '/hosted/mixes/render') return mix;
    if (path === '/hosted/mixes/export') return { state: 'queued', job_id: 'j1' };
    if (path === '/hosted/exports/j1') { polls.count += 1; return { state: 'queued' }; }
    throw new Error(`unexpected ${path}`);
  }) as Api;
  return { api, polls };
}

async function startExport(api: Api) {
  const view = render(<HostedMix api={api} workspaceId="ws" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByRole('button', { name: 'Make a mix on the server' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByRole('button', { name: 'Export the whole mix' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return view;
}

afterEach(() => { vi.useRealTimers(); });

describe('following a hosted export (T-20261125-66f1)', () => {
  it('stops asking after the limit and offers Check again', async () => {
    vi.useFakeTimers();
    const { api, polls } = stuckServer();
    await startExport(api);
    await act(async () => { await vi.advanceTimersByTimeAsync(EXPORT_FOLLOW_MS + 20_000); });
    expect(screen.getByText(/taking longer than expected/)).toBeTruthy();
    const asked = polls.count;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(polls.count).toBe(asked);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(polls.count).toBeGreaterThan(asked);
  });

  it('stops asking when the page is left', async () => {
    vi.useFakeTimers();
    const { api, polls } = stuckServer();
    const view = await startExport(api);
    await act(async () => { await vi.advanceTimersByTimeAsync(13_000); });
    view.unmount();
    const asked = polls.count;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(polls.count).toBe(asked);
  });
});
