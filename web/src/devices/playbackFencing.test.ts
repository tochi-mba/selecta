import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Api, CommandEvent, commandStillValid, HEARTBEAT_MS, PLAYBACK_COMMAND_EVENT, RETRY_CODES, SessionState, Speaker, usePlaybackDevice,
} from './usePlaybackDevice';

// ADR-0461 web client: fences on heartbeats, the three "here's where it is now" refusals, and
// acks that only ever report what this speaker actually did.

const clock = () => Date.now() / 1000;
const session = (over: Partial<SessionState> = {}): SessionState => ({
  mix_revision_id: 'r1', song_index: 0, offset_ms: 0, anchor_at: clock(), state: 'playing',
  active_device_id: 'me', lease_expires_at: clock() + 60, seq: 4, fence: 7, state_confidence: 'fresh', ...over,
});

const quiet = (): Speaker => ({
  start: vi.fn(async () => undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
  position: () => ({ song_index: 0, offset_ms: 1000, state: 'playing' }), active: () => true,
});

type Call = { path: string; body: Record<string, unknown> | null };

/** A server where this browser ('me') is the speaker unless `elsewhere` says otherwise. */
function server({ elsewhere = false, current = () => session(), refuse }: { elsewhere?: boolean; current?: () => SessionState; refuse?: string } = {}) {
  const calls: Call[] = [];
  const api = (async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path === '/devices') return { device: { id: 'me', name: 'Tablet', kind: 'tablet', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
    if (path === '/playback/reconnect') return { action: elsewhere ? 'stop_moved' : 'continue', session: current(), message: null };
    if (path.startsWith('/playback/session')) {
      return { session: current(), speaker: elsewhere ? 'elsewhere' : 'here', speaker_device_id: elsewhere ? 'other' : 'me', speaker_name: elsewhere ? 'Laptop' : 'Tablet', ask_before_playing_here: false, server_time: clock() };
    }
    if (path === '/playback/heartbeat') return { outcome: 'renewed', session: current(), server_time: clock() };
    if (path === '/playback/commands') {
      if (refuse) throw Object.assign(new Error('refused'), { status: 409, code: refuse });
      return { status: 'applied', session: current() };
    }
    if (path.endsWith('/ack')) return { ack_result: 'applied' };
    throw new Error(`unexpected ${path}`);
  }) as Api;
  return { api, calls };
}

const command = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  device_id: 'me', command: 'pause', args: {}, seq: 4, command_id: 'c1', fence: 7, expires_at: clock() + 30, ...over,
});

const acks = (calls: Call[]) => calls.filter((call) => call.path.endsWith('/ack'));

afterEach(() => vi.useRealTimers());

describe('checking a delivered command (ADR-0461)', () => {
  it('refuses an expired command and one from an older fence, and keeps a current one', () => {
    const now = 1000;
    expect(commandStillValid({ fence: 7, expires_at: 999 }, 7, now)).toBe(false);
    expect(commandStillValid({ fence: 6, expires_at: 1100 }, 7, now)).toBe(false);
    expect(commandStillValid({ fence: 7, expires_at: 1100 }, 7, now)).toBe(true);
    expect(commandStillValid({ fence: 8, expires_at: null }, 7, now)).toBe(false);
  });

  it('treats superseded and expired refusals like a stale one', () => {
    for (const code of ['stale_command', 'superseded_command', 'expired_command']) expect(RETRY_CODES.has(code)).toBe(true);
  });
});

describe('the speaker under fencing', () => {
  it('sends the fence it last saw with each heartbeat', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, calls } = server();
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-fence-beat', speaker: speakerOnce }));
    try {
      await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(true));
      await act(async () => { await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 50); });
      const beat = calls.find((call) => call.path === '/playback/heartbeat');
      expect(beat?.body).toMatchObject({ device_id: 'me', fence: 7 });
      expect(hook.result.current.knownFence()).toBe(7);
    } finally { hook.unmount(); }
  });

  it('adopts a newer fence from the server and never goes back to an older one', async () => {
    let fence = 7;
    const { api } = server({ current: () => session({ fence }) });
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-fence-adopt', speaker: speakerOnce }));
    try {
      await waitFor(() => expect(hook.result.current.knownFence()).toBe(7));
      fence = 9;
      await act(async () => { await hook.result.current.refreshSession(); });
      expect(hook.result.current.knownFence()).toBe(9);
      fence = 8;
      await act(async () => { await hook.result.current.refreshSession(); });
      expect(hook.result.current.knownFence()).toBe(9);
    } finally { hook.unmount(); }
  });

  it('acks a command it carried out as applied, once', async () => {
    const { api, calls } = server();
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-fence-ack', speaker: speakerOnce }));
    try {
      await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(true));
      await act(async () => { window.dispatchEvent(new CustomEvent(PLAYBACK_COMMAND_EVENT, { detail: command() })); });
      await waitFor(() => expect(acks(calls)).toHaveLength(1));
      expect(acks(calls)[0]).toMatchObject({ path: '/playback/commands/c1/ack', body: { device_id: 'me', result: 'applied' } });
      await act(async () => { await hook.result.current.handleCommand(command()); });
      expect(acks(calls)).toHaveLength(1);
    } finally { hook.unmount(); }
  });

  it('says unavailable_here for a command the speaker cannot carry out itself', async () => {
    const { api, calls } = server();
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-fence-volume', speaker: speakerOnce }));
    try {
      await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(true));
      await act(async () => { expect(await hook.result.current.handleCommand(command({ command: 'set_volume', command_id: 'v1' }))).toBe('unavailable_here'); });
      expect(acks(calls)[0].body).toMatchObject({ result: 'unavailable_here' });
    } finally { hook.unmount(); }
  });

  it('never acks an expired, superseded or misaddressed command, and never calls an unreached one applied', async () => {
    const { api, calls } = server();
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-fence-refuse', speaker: speakerOnce }));
    try {
      await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(true));
      await act(async () => {
        expect(await hook.result.current.handleCommand(command({ command_id: 'old', expires_at: clock() - 1 }))).toBeNull();
        expect(await hook.result.current.handleCommand(command({ command_id: 'fenced', fence: 3 }))).toBeNull();
        expect(await hook.result.current.handleCommand(command({ command_id: 'theirs', device_id: 'other' }))).toBeNull();
        // the session has not reached seq 9, so it was not applied here and is not acked as applied
        expect(await hook.result.current.handleCommand(command({ command_id: 'ahead', seq: 9 }))).toBe('unavailable_here');
      });
      expect(acks(calls).map((call) => call.body?.result)).toEqual(['unavailable_here']);
    } finally { hook.unmount(); }
  });

  it('a device that is not the speaker never acks', async () => {
    const { api, calls } = server({ elsewhere: true });
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-fence-remote', speaker: speakerOnce }));
    try {
      await waitFor(() => expect(hook.result.current.view?.speaker).toBe('elsewhere'));
      await act(async () => { expect(await hook.result.current.handleCommand(command())).toBeNull(); });
      expect(acks(calls)).toEqual([]);
    } finally { hook.unmount(); }
  });

  it.each(['superseded_command', 'expired_command'])('answers a %s refusal with where the music is now', async (code) => {
    const { api } = server({ elsewhere: true, refuse: code });
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: `ws-fence-${code}`, speaker: speakerOnce }));
    try {
      await waitFor(() => expect(hook.result.current.view?.session).toBeTruthy());
      await act(async () => { await hook.result.current.command('pause'); });
      expect(hook.result.current.error).toBe("Something changed just then. Here's where it is now; try again.");
    } finally { hook.unmount(); }
  });
});

// One stable speaker object per test file run: a new object each render would restart the hook.
const speakerOnce = quiet();
