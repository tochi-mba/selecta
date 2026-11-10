import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, Asset } from './api';
import { LibraryPanel } from './Library';

const asset = (id: string, name: string): Asset => ({ id, name, size: 1_000_000, sha256: null, format: 'wav', duration_seconds: 60, sample_rate: 44_100, channels: 2, created_at: 1 });
const SONGS = [asset('a1', 'First Song'), asset('a2', 'Second Song'), asset('a3', 'Third Song')];

let urlCount: Record<string, number>;
function fakeApi() {
  const calls: string[] = [];
  const api = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.startsWith('/assets?')) return { assets: SONGS, next_cursor: null };
    const proxy = /^\/assets\/([^/]+)\/playback-proxy$/.exec(path);
    if (proxy) {
      urlCount[proxy[1]] = (urlCount[proxy[1]] ?? 0) + 1;
      return { status: 'ready', url: `https://r2.test/${proxy[1]}?v=${urlCount[proxy[1]]}` };
    }
    throw new Error(`unexpected ${path}`);
  });
  return { api: api as unknown as Api, calls };
}

beforeEach(() => {
  urlCount = {};
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let blobs = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:buffered-${++blobs}`), revokeObjectURL: vi.fn() }));
});

function audio() {
  return document.querySelector('audio') as HTMLAudioElement;
}

async function listenTo(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Listen to ${name}` }));
  await waitFor(() => expect(audio()).not.toBeNull());
}

describe('Cloud library playback', () => {
  it('plays a run from the chosen song and buffers the next one once this one plays', async () => {
    const { api } = fakeApi();
    const fetchSpy = vi.fn(async () => new Response(new Blob(['audio']), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<LibraryPanel api={api} workspaceId="ws" setError={() => {}} refreshAccount={async () => {}} go={() => {}} />);
    await listenTo('First Song');
    expect(screen.getByTestId('now-playing')).toHaveTextContent('First Song');
    expect(screen.getByTestId('up-next')).toHaveTextContent('Up next: Second Song');
    expect(audio().src).toBe('https://r2.test/a1?v=1');
    fireEvent.playing(audio());
    await waitFor(() => expect(screen.getByTestId('up-next')).toHaveTextContent('Second Song · loaded'));
    expect(fetchSpy).toHaveBeenCalledWith('https://r2.test/a2?v=1');

    // The hand-over uses the buffered copy: no new URL, no wait on the network.
    const asked = urlCount.a2;
    fireEvent.ended(audio());
    await waitFor(() => expect(screen.getByTestId('now-playing')).toHaveTextContent('Second Song'));
    expect(audio().src).toBe('blob:buffered-1');
    expect(urlCount.a2).toBe(asked);
    expect(screen.getByTestId('up-next')).toHaveTextContent('Third Song');
  });

  it('refreshes an expired URL once, keeping the song, the queue and the playhead', async () => {
    const { api } = fakeApi();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    const setError = vi.fn();
    render(<LibraryPanel api={api} workspaceId="ws" setError={setError} refreshAccount={async () => {}} go={() => {}} />);
    await listenTo('First Song');
    Object.defineProperty(audio(), 'currentTime', { value: 42, writable: true, configurable: true });
    Object.defineProperty(audio(), 'paused', { value: false, configurable: true });
    fireEvent.error(audio());
    await waitFor(() => expect(audio().src).toBe('https://r2.test/a1?v=2'));
    expect(screen.getByTestId('now-playing')).toHaveTextContent('First Song');
    expect(screen.getByTestId('up-next')).toHaveTextContent('Up next: Second Song');
    Object.defineProperty(audio(), 'duration', { value: 180, configurable: true });
    audio().currentTime = 0;
    fireEvent.loadedMetadata(audio());
    expect(audio().currentTime).toBe(42);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    // A second failure on the same song isn't retried for ever.
    fireEvent.error(audio());
    await waitFor(() => expect(setError).toHaveBeenCalledWith('This playback link could not be refreshed. Try Listen again.'));
    expect(urlCount.a1).toBe(2);
  });

  it('keeps a paused song paused after its URL is refreshed', async () => {
    const { api } = fakeApi();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    render(<LibraryPanel api={api} workspaceId="ws" setError={() => {}} refreshAccount={async () => {}} go={() => {}} />);
    await listenTo('First Song');
    const element = audio();
    Object.defineProperty(element, 'paused', { value: true, configurable: true });
    element.autoplay = false;
    fireEvent.error(element);
    await waitFor(() => expect(audio().src).toBe('https://r2.test/a1?v=2'));
    await act(async () => { fireEvent.loadedMetadata(audio()); });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('still plays the next song from the network when buffering it failed', async () => {
    const { api } = fakeApi();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    render(<LibraryPanel api={api} workspaceId="ws" setError={() => {}} refreshAccount={async () => {}} go={() => {}} />);
    await listenTo('First Song');
    fireEvent.playing(audio());
    await waitFor(() => expect(urlCount.a2).toBe(1));
    fireEvent.ended(audio());
    await waitFor(() => expect(screen.getByTestId('now-playing')).toHaveTextContent('Second Song'));
    expect(audio().src).toBe('https://r2.test/a2?v=2');
  });
});
