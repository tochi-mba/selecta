import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessContext, type BusinessCtx } from '../business/context';
import { PeoplePage } from '../business/venue/PeoplePage';
import { clearToasts, Toaster } from '../ui/toasts';
import type { Api, Asset } from './api';
import { importSummaryWords, milestoneOf } from './importAnnouncer';
import { IDLE_IMPORT } from './importSession';
import { LibraryPanel, UNDO_WINDOW_MS } from './Library';
import { MakeCloudMix } from './MakeCloudMix';
import { UploadsPanel } from './Uploads';

/** The W4 surfaces polish: shared confirmations instead of window.confirm, an Undo that really
 * restores, stable mix rows that keep focus, and import milestones said once. */

afterEach(() => {
  vi.useRealTimers();
  clearToasts();
});

const asset = (id: string, name: string): Asset => ({ id, name, size: 1_000_000, sha256: null, format: 'wav', duration_seconds: 60, sample_rate: 44_100, channels: 2, created_at: 1 });

describe('Library remove', () => {
  function library() {
    const calls: string[] = [];
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path.startsWith('/assets?')) return { assets: [asset('a1', 'First Song'), asset('a2', 'Second Song')], next_cursor: null };
      if (init?.method === 'DELETE') return { deleted: true };
      if (path === '/uploads') return { uploads: [] };
      throw new Error(`unexpected ${path}`);
    });
    const refreshAccount = vi.fn(async () => {});
    render(<><LibraryPanel api={api as unknown as Api} workspaceId="ws" setError={() => {}} refreshAccount={refreshAccount} go={() => {}} /><Toaster /></>);
    return { calls, refreshAccount, api };
  }

  it('asks in the shared dialog, never window.confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    library();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove First Song' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove First Song?' });
    expect(dialog).toHaveTextContent('You can undo this for a few seconds afterwards.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Remove First Song' })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Undo inside the window really puts the song back, and nothing is deleted', async () => {
    const { calls } = library();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove First Song' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove First Song' })).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    expect(await screen.findByRole('button', { name: 'Remove First Song' })).toBeInTheDocument();
    const names = screen.getAllByRole('button', { name: /^Remove / }).map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Remove First Song', 'Remove Second Song']);
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });

  it('tells the server once the Undo window has passed', async () => {
    const { calls, refreshAccount } = library();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Second Song' }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Second Song' })).toBeNull());
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
    await act(async () => { vi.advanceTimersByTime(UNDO_WINDOW_MS + 10); });
    await waitFor(() => expect(calls).toContain('DELETE /assets/a2'));
    expect(refreshAccount).toHaveBeenCalled();
  });

  it('commits a waiting removal with keepalive when the tab closes inside the Undo window (M6)', async () => {
    const { calls, api } = library();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Second Song' }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Second Song' })).toBeNull());
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(calls.filter((call) => call === 'DELETE /assets/a2')).toHaveLength(1);
    const sent = api.mock.calls.find(([path, init]) => path === '/assets/a2' && init?.method === 'DELETE');
    expect(sent?.[1]).toMatchObject({ method: 'DELETE', keepalive: true });
    // the timer it replaced never sends a second delete
    await act(async () => { vi.advanceTimersByTime(UNDO_WINDOW_MS + 10); });
    expect(calls.filter((call) => call === 'DELETE /assets/a2')).toHaveLength(1);
  });

  it('sends nothing on pagehide once Undo has put the song back', async () => {
    const { calls } = library();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove First Song' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, remove it' }));
    await userEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    expect(await screen.findByRole('button', { name: 'Remove First Song' })).toBeInTheDocument();
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });
});

describe('Uploads duplicate question', () => {
  it('asks in the shared dialog, and skipping cancels that upload only', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const calls: string[] = [];
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/uploads') return { uploads: [] };
      if (path === '/uploads/plan') return { uploads: [{ index: 0, name: 'song.wav', session: { id: 'up-9', name: 'song.wav', size: 1, sha256: 'x', part_size: 4, part_count: 1, status: 'uploading' }, duplicate_of: 'a1' }] };
      if (init?.method === 'DELETE') return {};
      throw new Error(`unexpected ${path}`);
    });
    const setNotice = vi.fn();
    const { container } = render(<UploadsPanel api={api as unknown as Api} workspaceId="ws" setError={() => {}} setNotice={setNotice} blocked={null} />);
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'song.wav', { type: 'audio/wav' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Keep another copy of song.wav?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Skip this file' }));
    await waitFor(() => expect(calls).toContain('DELETE /uploads/up-9'));
    expect(await screen.findByText('A matching copy is already in your library.')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('People remove', () => {
  it('asks before removing someone, and removes only on yes', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const removeMember = vi.fn(async () => {});
    const client = { members: vi.fn(async () => [{ id: 'm1', name: 'Ada', email: 'ada@example.test', role: 'staff', venue_ids: null }]), removeMember, invite: vi.fn() };
    const value = { org: { id: 'o1', role: 'owner' }, venues: [], client, readOnly: false, offline: false } as unknown as BusinessCtx;
    render(<BusinessContext.Provider value={value}><PeoplePage /></BusinessContext.Provider>);
    expect((await screen.findByText('Ada')).closest('li')).toHaveTextContent(/Ada \(ada@example\.test\): \w/);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ada' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Ada from this organisation?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(removeMember).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ada' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith('o1', 'm1'));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('Make a mix editor', () => {
  const MIX = {
    mix_id: 'm1', name: 'Warm up', number: 1, parent: null, revision: 'r1', intelligent_seams: 0,
    songs: ['a1', 'a2', 'a3'].map((id, at) => ({ source: 'asset', id, title: `Song ${at + 1}`, artist: null, duration: 60, facts: { bpm: null, camelot: null, energy: null } })),
    seams: [],
  };
  function maker() {
    const api = vi.fn(async (path: string) => {
      if (path === '/cloud-mixes') return { mixes: [{ mix_id: 'm1', name: 'Warm up', revision: 'r1', number: 1, songs: 3, intelligent_seams: 0, updated_at: 1 }, { mix_id: 'm2', name: 'Late', revision: 'r9', number: 1, songs: 2, intelligent_seams: 1, updated_at: 1 }] };
      if (path.startsWith('/assets')) return { assets: [asset('a1', 'Song 1'), asset('a2', 'Song 2'), asset('a3', 'Song 3')] };
      if (path === '/cloud-mixes/m1') return { mix: MIX, history: [{ revision: 'r1', number: 1, name: 'Warm up', songs: 3 }] };
      if (path === '/cloud-mixes/m2') return { mix: { ...MIX, mix_id: 'm2', name: 'Late' }, history: [] };
      throw new Error(`unexpected ${path}`);
    });
    const account = { features: { 'cloud.mix_create': true, 'cloud.stored_media': true, 'cloud.uploads': true }, workspace: { id: 'ws' } } as never;
    render(<MakeCloudMix api={api as unknown as Api} account={account} />);
    return api;
  }
  const order = () => [...document.querySelectorAll('.cloud-mix-songs li span')].map((node) => node.textContent);

  it('says its counts with the right plural, and focus rides with a moved song', async () => {
    maker();
    expect(await screen.findByText('3 songs · version 1 · 0 planned changes')).toBeInTheDocument();
    expect(screen.getByText('2 songs · version 1 · 1 planned change')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Warm up' }));
    const down = await screen.findByRole('button', { name: 'Move Song 1 later' });
    down.focus();
    await userEvent.keyboard('{Enter}');
    expect(order()).toEqual(['Song 2', 'Song 1', 'Song 3']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Song 1 later' }));
    await userEvent.keyboard('{Enter}');
    expect(order()).toEqual(['Song 2', 'Song 3', 'Song 1']);
    // at the end its Down is gone, so its Up takes focus
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Song 1 earlier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Song 3' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Song 1' }));
  });

  it('asks before another mix replaces unsaved edits', async () => {
    const api = maker();
    await userEvent.click(await screen.findByRole('button', { name: 'Warm up' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Move Song 1 later' }));
    await userEvent.click(screen.getByRole('button', { name: 'Late' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Open Late without saving?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(order()).toEqual(['Song 2', 'Song 1', 'Song 3']);
    expect(api).not.toHaveBeenCalledWith('/cloud-mixes/m2', {}, 'ws');
    await userEvent.click(screen.getByRole('button', { name: 'Late' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Leave without saving' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Edit Late' })).toBeInTheDocument());
  });
});

describe('import milestones', () => {
  const running = (registered: number, total: number | null) => ({ ...IDLE_IMPORT, phase: 'running' as const, registered, total });
  it('speaks at the start, each quarter and the end, never per file', () => {
    expect(milestoneOf(running(0, null), 1)).toEqual({ key: '1:started', words: 'Checking your music has started.' });
    expect(milestoneOf(running(10, 100), 1)?.key).toBe('1:started');
    expect(milestoneOf(running(26, 100), 1)).toEqual({ key: '1:q1', words: 'Checking your music: 25 percent done, 26 of 100.' });
    expect(milestoneOf(running(49, 100), 1)?.key).toBe('1:q1');
    expect(milestoneOf(running(75, 100), 1)?.key).toBe('1:q3');
    expect(milestoneOf(running(100, 100), 1)?.key).toBe('1:q3');
    const summary = { imported: 3, duplicates: 1, failed: 0, skipped: 0, cancelled: false, paused: false };
    expect(milestoneOf({ ...IDLE_IMPORT, phase: 'finished', summary }, 1)).toEqual({ key: '1:end', words: `Checking your music finished. ${importSummaryWords(summary)}` });
    expect(milestoneOf(IDLE_IMPORT, 1)).toBeNull();
  });
});
