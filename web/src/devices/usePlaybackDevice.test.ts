import { renderHook, waitFor } from '@testing-library/react';
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
      expect(hook.result.current.message).toContain('could not renew its audio lease');
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

  it('tears the speaker down when the page lets it go', () => {
    const speaker: Speaker = { start: async () => {}, stop: vi.fn(), pause: () => {}, resume: () => {}, position: () => null, active: () => false, dispose: vi.fn() };
    const api = (() => new Promise(() => {})) as Api;
    const { unmount } = renderHook(() => usePlaybackDevice({ api, workspaceId: 'w1', speaker }));
    unmount();
    expect(speaker.dispose).toHaveBeenCalledTimes(1);
  });
});
