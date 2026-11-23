import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Api, extrapolate, FADE_MS, SessionState, Speaker, SPEAKER_POLL_MS, START_DELAY_MS, usePlaybackDevice } from './usePlaybackDevice';

const session = (over: Partial<SessionState>): SessionState => ({
  mix_revision_id: null, song_index: 2, offset_ms: 10_000, anchor_at: 1000, state: 'playing',
  active_device_id: 'd1', lease_expires_at: 1020, seq: 4, ...over,
});

describe('the playback session on a device', () => {
  it('moves the position on from the anchor while playing', () => {
    expect(extrapolate(session({}), 1003.5)).toBe(13_500);
  });

  it('keeps the position still while paused, and never runs backwards', () => {
    expect(extrapolate(session({ state: 'paused' }), 1100)).toBe(10_000);
    expect(extrapolate(session({}), 999)).toBe(10_000);
  });

  it('waits for the old speaker to hear and fade before starting here', () => {
    expect(START_DELAY_MS).toBeGreaterThan(SPEAKER_POLL_MS + FADE_MS);
  });

  it('stamps remote commands with the current fence and a short TTL', async () => {
    let sent: RequestInit | undefined;
    const quiet: Speaker = {
      start: async () => undefined, stop: () => undefined, pause: () => undefined,
      resume: () => undefined, position: () => null, active: () => false,
    };
    const api = (async (path: string, init?: RequestInit) => {
      if (path === '/devices') return { device: {
        id: 'remote', name: 'Remote', kind: 'phone', signed_in: true,
        this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [],
      }, notice: null };
      if (path === '/playback/reconnect') return {
        action: 'stop_moved', session: session({ fence: 9 }), message: null,
      };
      if (path.startsWith('/playback/session')) return {
        session: session({ fence: 9 }), speaker: 'elsewhere', speaker_device_id: 'd1',
        speaker_name: 'Tablet', ask_before_playing_here: true, server_time: 1000,
      };
      if (path === '/playback/commands') {
        sent = init;
        return { status: 'applied', session: session({ fence: 9 }) };
      }
      throw new Error(`unexpected ${path}`);
    }) as Api;
    const hook = renderHook(() => usePlaybackDevice({
      api, workspaceId: 'ws-fenced-command', speaker: quiet,
    }));
    try {
      await waitFor(() => expect(hook.result.current.view?.session?.fence).toBe(9));
      await act(async () => { await hook.result.current.command('pause'); });
      const body = JSON.parse(String(sent?.body));
      expect(body).toMatchObject({ command: 'pause', fence: 9, ttl_seconds: 60, based_on_seq: 4 });
      expect(body.idempotency_key).toEqual(expect.any(String));
    } finally { hook.unmount(); }
  });

  it('stops the buffered speaker when an unreachable server cannot renew its lease', async () => {
    const clock = Date.now() / 1000;
    const expiredSoon = session({ lease_expires_at: clock + 0.6, anchor_at: clock });
    const renewed = session({ lease_expires_at: clock + 60, anchor_at: clock });
    let online = true;
    let reconnects = 0;
    const quiet: Speaker = {
      start: vi.fn(async () => undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
      position: () => ({ song_index: 2, offset_ms: 0, state: 'playing' }), active: () => true,
    };
    const api = (async (path: string) => {
      if (path === '/devices') return { device: {
        id: 'd1', name: 'Device 1', kind: 'laptop', signed_in: true,
        this_device: true, poor_speaker: false, last_seen_at: clock, warnings: [],
      }, notice: null };
      if (path === '/playback/reconnect') {
        reconnects++;
        if (!online) throw new TypeError('network offline');
        return {
          action: 'continue', session: reconnects === 1 ? expiredSoon : renewed, message: null,
        };
      }
      if (path.startsWith('/playback/session')) {
        if (!online) throw new TypeError('network offline');
        return {
          session: reconnects === 1 ? expiredSoon : renewed,
          speaker: 'here', speaker_device_id: 'd1',
          speaker_name: 'Device 1', ask_before_playing_here: false,
          server_time: Date.now() / 1000,
        };
      }
      if (path === '/playback/heartbeat') throw new TypeError('network offline');
      throw new Error(`unexpected ${path}`);
    }) as Api;
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-lease-expiry', speaker: quiet }));
    try {
      await waitFor(() => expect(quiet.start).toHaveBeenCalledTimes(1));
      online = false;
      await waitFor(() => expect(quiet.stop).toHaveBeenCalledWith(0), { timeout: 3500 });
      expect(hook.result.current.isSpeaker()).toBe(false);
      // The message is React state set in the same call as stop(0): wait for the render, so a
      // loaded machine cannot read the hook before it re-renders.
      await waitFor(() => expect(hook.result.current.message).toContain('could not renew its audio lease'));
      online = true;
      // A normal poll re-establishes ownership atomically via /reconnect, without
      // requiring a page reload or resuming if another device has since taken over.
      await waitFor(() => expect(quiet.start).toHaveBeenCalledTimes(2), { timeout: 5000 });
      expect(hook.result.current.isSpeaker()).toBe(true);
    } finally { hook.unmount(); }
  });

  it('a delayed reconnect after device takeover never restarts the old speaker', async () => {
    const oldSession = session({ active_device_id: 'd1' });
    const newSession = session({ active_device_id: 'd2', seq: 5 });
    let answerReconnect!: (answer: { action: string; session: SessionState; message: null }) => void;
    let reconnectCalled = false;
    let reads = 0;
    const speaker: Speaker = {
      start: vi.fn(async () => undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
      position: () => null, active: () => false,
    };
    const api = (async (path: string) => {
      if (path === '/devices') return { device: {
        id: 'd1', name: 'First device', kind: 'laptop', signed_in: true,
        this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [],
      }, notice: null };
      if (path === '/playback/reconnect') {
        reconnectCalled = true;
        return new Promise<{ action: string; session: SessionState; message: null }>(
          (resolve) => { answerReconnect = resolve; },
        );
      }
      if (path.startsWith('/playback/session')) {
        reads++;
        return {
          session: newSession, speaker: 'elsewhere', speaker_device_id: 'd2',
          speaker_name: 'Second device', ask_before_playing_here: true,
          server_time: Date.now() / 1000,
        };
      }
      throw new Error(`unexpected ${path}`);
    }) as Api;
    const hook = renderHook(() => usePlaybackDevice({
      api, workspaceId: 'ws-reconnect-race', speaker,
    }));
    try {
      await waitFor(() => expect(reconnectCalled).toBe(true));
      answerReconnect({ action: 'continue', session: oldSession, message: null });
      await waitFor(() => expect(reads).toBeGreaterThan(0));
      expect(speaker.start).not.toHaveBeenCalled();
      expect(hook.result.current.isSpeaker()).toBe(false);
    } finally { hook.unmount(); }
  });

  // A press on a song on a device that isn't the speaker yet (LocalFirstPlayer.playFrom) names
  // where to begin: the new speaker starts there, not where the session was last left.
  function takeOver(label: string) {
    let taken = false;
    const heard: string[] = [];
    const speaker: Speaker = {
      start: vi.fn(async () => undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
      position: () => null, active: () => false,
    };
    const left = session({ active_device_id: 'd2', song_index: 2, offset_ms: 10_000, anchor_at: 1000, seq: 4 });
    const ours = session({ active_device_id: 'd1', song_index: 2, offset_ms: 10_000, anchor_at: 1000, seq: 5, lease_expires_at: Date.now() / 1000 + 60 });
    const api = (async (path: string, init?: RequestInit) => {
      heard.push(path);
      if (path === '/devices') return { device: {
        id: 'd1', name: 'This laptop', kind: 'laptop', signed_in: true,
        this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [],
      }, notice: null };
      if (path === '/playback/reconnect') return { action: 'stop_moved', session: left, message: null };
      if (path === '/playback/take-over') {
        expect(JSON.parse(String(init?.body))).toMatchObject({ device_id: 'd1', start_playing: true });
        taken = true;
        return { session: ours, previous_device: null, server_time: 1001 };
      }
      if (path.startsWith('/playback/session')) return {
        session: taken ? ours : left, speaker: taken ? 'here' : 'elsewhere', speaker_device_id: taken ? 'd1' : 'd2',
        speaker_name: taken ? 'This laptop' : 'Tablet', ask_before_playing_here: !taken, server_time: 1001,
      };
      if (path === '/playback/heartbeat') return { outcome: 'ok', session: ours, server_time: 1001 };
      throw new Error(`unexpected ${path}`);
    }) as Api;
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: `ws-start-at-${label}`, speaker }));
    return { hook, speaker, heard };
  }

  it('starts a new speaker at the point the press asked for', async () => {
    const { hook, speaker, heard } = takeOver('given');
    try {
      await waitFor(() => expect(hook.result.current.view?.speaker).toBe('elsewhere'));
      await act(async () => { await hook.result.current.playHere(undefined, { song_index: 0, offset_ms: 4000 }); });
      expect(heard).toContain('/playback/take-over');
      expect(speaker.start).toHaveBeenCalledTimes(1);
      // song 0 at 4 s, playing; never song 2 at the session's 10 s and onwards
      expect(speaker.start).toHaveBeenCalledWith(0, 4000, true);
    } finally { hook.unmount(); }
  });

  it('without a start point, a new speaker carries on from the session', async () => {
    const { hook, speaker } = takeOver('carried');
    try {
      await waitFor(() => expect(hook.result.current.view?.speaker).toBe('elsewhere'));
      await act(async () => { await hook.result.current.playHere(); });
      expect(speaker.start).toHaveBeenCalledTimes(1);
      const [index, offset, playing] = (speaker.start as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(index).toBe(2);
      expect(offset).toBeGreaterThanOrEqual(10_000);
      expect(playing).toBe(true);
    } finally { hook.unmount(); }
  });

  it('tears the speaker down when the page lets it go', () => {
    const speaker: Speaker = { start: async () => {}, stop: vi.fn(), pause: () => {}, resume: () => {}, position: () => null, active: () => false, dispose: vi.fn() };
    const api = (() => new Promise(() => {})) as Api;
    const { unmount } = renderHook(() => usePlaybackDevice({ api, workspaceId: 'w1', speaker }));
    unmount();
    expect(speaker.dispose).toHaveBeenCalledTimes(1);
  });
});
