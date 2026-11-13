import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderWatches, LegacyFolderWatchEntry, parseWatchedFolders } from './FolderWatches';

const record = (id: string, state: string, enabled = true) => ({
  id, name: id === 'one' ? 'Music' : 'DJ Sets', path: 'C:\\Music\\' + id,
  enabled, available: state !== 'offline', state, indexed: 8, discovered: 10,
  last_scanned_at: 1_730_000_000, last_attempt_at: 1_730_000_200, problem: null,
});
const response = (sources = [record('one', 'ready'), record('two', 'offline')]) =>
  ({ schema_version: 1, device: 'This computer', watch_every_seconds: 300, sources });
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Cloud local folder watches', () => {
  it('parses only bounded local-source fields, rejecting invalid counts and duplicate IDs', () => {
    const parsed = parseWatchedFolders(response([
      { ...record('one', 'ready'), indexed: -2, secret: 'never used' },
      record('one', 'offline'),
    ]));
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0].indexed).toBe(0);
    expect(parsed.sources[0]).not.toHaveProperty('secret');
    expect(() => parseWatchedFolders({ schema_version: 2, sources: [] })).toThrow();
  });

  it('shows multiple source states and never calls a hosted upload endpoint', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      requests.push(String(path));
      return json(response());
    }));
    render(<FolderWatches />);
    expect(await screen.findByText('Music')).toBeInTheDocument();
    expect(screen.getByText('DJ Sets')).toBeInTheDocument();
    expect(screen.getByText('Drive disconnected')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/Checks roughly every 5 minutes/)).toBeInTheDocument();
    expect(requests.every((path) => path.startsWith('/dev/local-watches'))).toBe(true);
  });

  it('preflights new folders and queues a local scan without uploading audio', async () => {
    const calls: { path: string; method: string; body?: string }[] = [];
    let folders = [record('one', 'ready')];
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ path: String(path), method, body: String(init?.body ?? '') });
      if (String(path).includes('/check?')) return json({ ok: true });
      if (String(path) === '/dev/local-watches' && method === 'POST') {
        folders = [...folders, record('two', 'stale')];
        return json({ accepted: true, source_id: 'two' });
      }
      return json(response(folders));
    }));
    const user = userEvent.setup();
    render(<FolderWatches />);
    await screen.findByText('Music');
    await user.click(screen.getByRole('button', { name: '+ Add folder' }));
    await user.type(screen.getByRole('textbox', { name: 'Folder address on this computer' }), 'C:\\DJ Sets');
    await user.click(screen.getByRole('button', { name: 'Watch folder' }));
    expect(await screen.findByText(/Folder added. Indexing is queued/)).toBeInTheDocument();
    expect(screen.getByText('DJ Sets')).toBeInTheDocument();
    const mutation = calls.find((call) => call.method === 'POST');
    expect(mutation?.path).toBe('/dev/local-watches');
    expect(JSON.parse(mutation?.body ?? '{}')).toEqual({ folder: 'C:\\DJ Sets' });
    expect(calls.every((call) => call.path.startsWith('/dev/local-watches'))).toBe(true);
  });

  it('pauses without deletion and requires explicit confirmation before removing a watch', async () => {
    const calls: { path: string; method: string }[] = [];
    let folders = [record('one', 'ready')];
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ path: String(path), method });
      if (method === 'PATCH') folders = [record('one', 'paused', false)];
      if (method === 'DELETE') folders = [];
      return json(method === 'GET' ? response(folders) : { accepted: true });
    }));
    const user = userEvent.setup();
    render(<FolderWatches />);
    await screen.findByText('Music');
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText(/Watching paused/)).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
    expect(screen.getByText(/Audio files and previously indexed recordings are not deleted/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop watching this folder' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1));
    expect(await screen.findByText('No folders watched yet')).toBeInTheDocument();
  });

  it('keeps legacy uploads untouched until the user explicitly opens watches', async () => {
    const mockFetch = vi.fn(async () => json(response()));
    vi.stubGlobal('fetch', mockFetch);
    const user = userEvent.setup();
    render(<LegacyFolderWatchEntry />);
    expect(mockFetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Manage folder watches' }));
    expect(await screen.findByText('Music')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('reports an unavailable companion rather than inventing an empty library', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ detail: 'not found' }, 404)));
    render(<FolderWatches />);
    expect(await screen.findByText(/local folder companion is not responding/)).toBeInTheDocument();
    expect(screen.queryByText('No folders watched yet')).not.toBeInTheDocument();
  });
});
