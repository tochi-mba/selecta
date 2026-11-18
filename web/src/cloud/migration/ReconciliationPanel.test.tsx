import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HostedAsset, LocalSong, reconcile, ReconciliationPanel } from './ReconciliationPanel';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const assets: HostedAsset[] = [
  { id: 'as-1', name: 'Track One.mp3', sha256: A.toUpperCase() },
  { id: 'as-2', name: 'Night Drive.flac', sha256: B },
  { id: 'as-3', name: 'Mystery.wav', sha256: null },
  { id: 'as-4', name: 'Elsewhere.mp3', sha256: 'd'.repeat(64) },
];
const songs: LocalSong[] = [
  { id: 1, content_sha256: A, title: 'Track One', artist: 'Someone' },
  { id: 2, content_sha256: C, title: 'Night Drive', artist: 'Someone' },
  { id: 3, content_sha256: 'e'.repeat(64), title: 'Only Local', artist: 'Another' },
];

describe('reconcile (BF-0465-02)', () => {
  it('matches by content hash only, and explains every unmatched row', () => {
    const rows = reconcile(assets, songs);
    const by = (id: string) => rows.find((row) => row.kind !== 'device_only' && row.asset.id === id)!;
    expect(by('as-1')).toMatchObject({ kind: 'matched', song: { id: 1 } });
    // same title, different audio: never merged, and the reason says why
    expect(by('as-2')).toMatchObject({ kind: 'hosted_only' });
    expect(by('as-2').reason).toMatch(/audio is different/);
    expect(by('as-3').reason).toMatch(/no fingerprint/);
    expect(by('as-4').reason).toMatch(/Not on a device yet/);
    expect(rows.filter((row) => row.kind === 'device_only').map((row) => row.kind === 'device_only' && row.song.id)).toEqual([2, 3]);
  });
});

describe('ReconciliationPanel', () => {
  function server() {
    const calls: { path: string; method: string }[] = [];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: (init?.method ?? 'GET').toUpperCase() });
      if (path.startsWith('/assets')) {
        return path.includes('cursor=') ? { assets: assets.slice(2), next_cursor: null } : { assets: assets.slice(0, 2), next_cursor: 'page-2' };
      }
      if (path.startsWith('/local-media/songs')) {
        return path.includes('after=') ? { songs: songs.slice(2) } : { songs: songs.slice(0, 2), next: 2 };
      }
      throw new Error(`unexpected ${path}`);
    });
    return { calls, request: request as unknown as <T>(path: string, init?: RequestInit) => Promise<T> };
  }

  it('lists matched and unmatched across every page, with reasons', async () => {
    const { request } = server();
    render(<ReconciliationPanel request={request} />);
    expect(await screen.findByText('1 matched · 3 only in your hosted library · 2 only on your devices')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Matched' })).getByText('Track One.mp3')).toBeInTheDocument();
    const hosted = screen.getByRole('region', { name: 'Only in your hosted library' });
    expect(hosted).toHaveTextContent('Night Drive.flac');
    expect(hosted).toHaveTextContent('no fingerprint');
    expect(screen.getByRole('region', { name: 'Only on your devices' })).toHaveTextContent('Only Local');
  });

  it('only ever reads: no delete, no upload, no write of any kind', async () => {
    const { calls, request } = server();
    render(<ReconciliationPanel request={request} />);
    await screen.findByText(/1 matched/);
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText(/1 matched/);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(calls.every((call) => call.path.startsWith('/assets') || call.path.startsWith('/local-media/songs'))).toBe(true);
    expect(calls.some((call) => /upload|delete|purge/i.test(call.path))).toBe(false);
  });

  it('says plainly when it cannot load, and changes nothing', async () => {
    const request = vi.fn(async () => { throw new Error('offline'); }) as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;
    render(<ReconciliationPanel request={request} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed.');
  });

  it('warns when the hosted catalogue reaches the 10,000-item safety limit', async () => {
    const calls = vi.fn(async (path: string) => {
      if (path.startsWith('/assets')) {
        const page = path.includes('cursor=') ? Number(new URLSearchParams(path.split('?')[1]).get('cursor')) : 0;
        return { assets: [], next_cursor: String(page + 1) };
      }
      return { songs: [] };
    });
    const request = calls as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;

    render(<ReconciliationPanel request={request} />);

    expect(await screen.findByText(/10,000-item safety limit/)).toBeInTheDocument();
    expect(calls.mock.calls.filter(([path]) => path.startsWith('/assets'))).toHaveLength(100);
    expect(screen.getByText(/Nothing was changed|there's nothing to compare yet/i)).toBeInTheDocument();
  });

  it('warns when the device catalogue reaches the 10,000-item safety limit', async () => {
    const calls = vi.fn(async (path: string) => {
      if (path.startsWith('/assets')) return { assets: [] };
      const after = path.includes('after=') ? Number(new URLSearchParams(path.split('?')[1]).get('after')) : 0;
      return { songs: [], next: after + 1 };
    });
    const request = calls as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;

    render(<ReconciliationPanel request={request} />);

    expect(await screen.findByText(/10,000-item safety limit/)).toBeInTheDocument();
    expect(calls.mock.calls.filter(([path]) => path.startsWith('/local-media/songs'))).toHaveLength(100);
    expect(screen.getByText(/Nothing was changed|there's nothing to compare yet/i)).toBeInTheDocument();
  });
});
