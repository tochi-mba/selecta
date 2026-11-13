import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudListen } from '../rooms/CloudListen';
import type { Account, Api, Page } from './api';
import { claimFocus, releaseFocus, resetTransport, transportState } from './cloudTransport';
import { CloudTransportDock } from './CloudTransportDock';
import { LibraryPanel } from './Library';

// AV-0419-02 (one transport above the pages) and AV-0419-03 (exclusive focus, explicit Pause
// stays paused), with the flag on; and the flag off rendering exactly as before.

const paused = new WeakMap<HTMLMediaElement, boolean>();
const plays = vi.fn();
beforeEach(() => {
  resetTransport();
  plays.mockReset();
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return paused.get(this) ?? true; } });
  HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) { plays(this); paused.set(this, false); this.dispatchEvent(new Event('play')); return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) { const was = paused.get(this) === false; paused.set(this, true); if (was) this.dispatchEvent(new Event('pause')); };
  HTMLMediaElement.prototype.load = function load() {};
});
afterEach(() => { cleanup(); resetTransport(); });

const songs = [
  { id: 'b', name: 'Song B.wav', size: 1, sha256: null, format: 'wav', duration_seconds: 60, sample_rate: null, channels: null, created_at: 2 },
  { id: 'a', name: 'Song A.wav', size: 1, sha256: null, format: 'wav', duration_seconds: 60, sample_rate: null, channels: null, created_at: 1 },
];
const session = { mix_revision_id: null, song_index: 0, offset_ms: 0, anchor_at: 100, state: 'playing', active_device_id: 'me', lease_expires_at: 120, seq: 3 };

const api = (async (path: string) => {
  if (path.startsWith('/assets?')) return { assets: songs, next_cursor: null };
  if (path.endsWith('/playback-proxy')) return { status: 'ready', url: `https://r2.test/${path.split('/')[2]}.wav` };
  if (path === '/devices') return { device: { id: 'me', name: 'Edge on Windows', kind: 'laptop', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
  if (path.startsWith('/playback/session')) return { session, speaker: 'here', speaker_device_id: 'me', speaker_name: 'Edge on Windows', ask_before_playing_here: false, server_time: 100 };
  if (path === '/playback/reconnect') return { action: 'stop_moved', session, message: null };
  throw new Error(`unexpected ${path}`);
}) as Api;

const account = (features: Record<string, boolean> = {}): Account => ({
  user: { id: 'u', email: 'dj@example.test', email_verified: true },
  workspace: { id: 'ws', name: 'WS', role: 'owner' },
  entitlement: { plan: 'free', plan_version: 1, storage_limit_bytes: 1, storage_used_bytes: 0, storage_state: 'ok' },
  features: { rooms: false, ...features }, feature_locks: {},
});

function Shell({ page, features }: { page: Page; features?: Record<string, boolean> }) {
  const acct = account(features);
  return (
    <>
      <CloudTransportDock api={api} account={acct} page={page} />
      {page === 'library' && <LibraryPanel api={api} workspaceId="ws" setError={() => {}} refreshAccount={async () => {}} go={() => {}} />}
      {page === 'listen' && <CloudListen api={api} account={acct} />}
    </>
  );
}

describe('one Cloud transport (AV-0419-02)', () => {
  it('keeps the Library song playing, on the same element, when the person leaves the Library', async () => {
    const view = render(<Shell page="library" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Listen to Song B.wav' }));
    expect(await screen.findByTestId('now-playing')).toHaveTextContent('Song B.wav');
    const audio = screen.getByTestId('library-audio') as HTMLAudioElement;
    expect(document.querySelectorAll('audio')).toHaveLength(1); // the page made no second element
    await act(async () => { await audio.play(); });
    view.rerender(<Shell page="billing" />);
    expect(screen.queryByRole('button', { name: 'Listen to Song B.wav' })).toBeNull();
    expect(screen.getByTestId('library-audio')).toBe(audio);
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId('now-playing')).toHaveTextContent('Song B.wav');
    expect(screen.getByTestId('up-next')).toHaveTextContent('Song A.wav');
  });

  it('keeps the speaker mounted after Listen is left, so its lease and sound carry on', async () => {
    const view = render(<Shell page="listen" />);
    const speaker = await screen.findByTestId('speaker-audio');
    expect(screen.getAllByTestId('speaker-audio')).toHaveLength(1); // the dock's, not a second bar on Listen
    view.rerender(<Shell page="library" />);
    expect(screen.getByTestId('speaker-audio')).toBe(speaker);
  });
});

describe('exclusive playback focus (AV-0419-03)', () => {
  it('starting one source pauses the other, and nothing ever resumes it', () => {
    const library = { id: 'library' as const, pause: vi.fn() };
    const device = { id: 'device' as const, pause: vi.fn() };
    claimFocus(library);
    claimFocus(device);
    expect(library.pause).toHaveBeenCalledTimes(1);
    expect(transportState().focus).toBe('device');
    releaseFocus('device');
    expect(transportState().focus).toBeNull();
    claimFocus(library);
    expect(device.pause).not.toHaveBeenCalled(); // device released itself: nothing to pause
  });

  it('the speaker starting pauses the Library player in the dock, and says so', async () => {
    const view = render(<Shell page="library" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Listen to Song B.wav' }));
    const audio = await screen.findByTestId('library-audio') as HTMLAudioElement;
    await act(async () => { await audio.play(); });
    view.rerender(<Shell page="listen" />);
    const speaker = await screen.findByTestId('speaker-audio') as HTMLAudioElement;
    await act(async () => { await speaker.play(); });
    expect(audio.paused).toBe(true);
    expect(speaker.paused).toBe(false);
    expect(screen.getByText('Your library is paused while this device plays the session.')).toBeTruthy();
    // And back: the Library starting pauses the speaker.
    await act(async () => { await audio.play(); });
    expect(speaker.paused).toBe(true);
  });

  it('explicit Pause stays paused across pages and when the other source stops', async () => {
    const view = render(<Shell page="library" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Listen to Song B.wav' }));
    const audio = await screen.findByTestId('library-audio') as HTMLAudioElement;
    await act(async () => { await audio.play(); });
    act(() => audio.pause());
    expect(transportState().focus).toBeNull();
    plays.mockClear();
    view.rerender(<Shell page="home" />);
    view.rerender(<Shell page="listen" />);
    const speaker = await screen.findByTestId('speaker-audio') as HTMLAudioElement;
    await act(async () => { await speaker.play(); });
    act(() => speaker.pause());
    view.rerender(<Shell page="library" />);
    await waitFor(() => expect(screen.getByTestId('library-audio')).toBe(audio));
    expect(audio.paused).toBe(true);
    expect(plays.mock.calls.filter(([element]) => element === audio)).toHaveLength(0);
  });
});

describe('with cloud.single_audio_owner off', () => {
  it('Listen keeps its own bar and the Library its own player, as before', async () => {
    const off = account({ 'cloud.single_audio_owner': false });
    const listen = render(<CloudListen api={api} account={off} />);
    expect(await screen.findByTestId('speaker-audio')).toBeTruthy();
    listen.unmount();
    render(<LibraryPanel api={api} workspaceId="ws" setError={() => {}} refreshAccount={async () => {}} go={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Listen to Song B.wav' }));
    expect(await screen.findByTestId('now-playing')).toHaveTextContent('Song B.wav');
    expect(screen.queryByTestId('library-audio')).toBeNull();
    expect(document.querySelectorAll('audio')).toHaveLength(1);
  });
});
