import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { configureConnection, reportOffline, reportOk } from '../cloud/connection';
import { Api, couldNotReach, SessionState, Speaker, TAKEN_OVER_WHILE_OFFLINE, usePlaybackDevice } from './usePlaybackDevice';

// cloud.offline_playback: a dropped connection keeps the music going past the lease; the lease is
// settled on return, and a refusal or another device taking over stops it with the message.

const session = (over: Partial<SessionState>): SessionState => ({
  mix_revision_id: null, song_index: 2, offset_ms: 0, anchor_at: Date.now() / 1000, state: 'playing',
  active_device_id: 'd1', lease_expires_at: Date.now() / 1000 + 0.6, seq: 4, ...over,
});

function speaker(): Speaker & { [key: string]: ReturnType<typeof vi.fn> } {
  return {
    start: vi.fn(async () => undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), setVolume: vi.fn(),
    position: vi.fn(() => ({ song_index: 2, offset_ms: 1_000, state: 'playing' })), active: vi.fn(() => true),
  } as unknown as Speaker & { [key: string]: ReturnType<typeof vi.fn> };
}

type Script = {
  /** What /playback/reconnect answers after the first one (which hands this device the lease). */
  reconnect?: () => unknown;
  heartbeat?: () => unknown;
  commands?: () => unknown;
};

function harness(script: Script) {
  const calls: string[] = [];
  let reconnects = 0;
  let down = false;
  const api = (async (path: string) => {
    calls.push(path);
    if (path === '/devices') return { device: { id: 'd1', name: 'Laptop', kind: 'laptop', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
    if (down) throw new TypeError('Failed to fetch');
    if (path === '/playback/reconnect') {
      reconnects += 1;
      if (reconnects === 1) return { action: 'continue', session: session({}), message: null };
      return script.reconnect?.() ?? { action: 'continue', session: session({ lease_expires_at: Date.now() / 1000 + 60 }), message: null };
    }
    if (path.startsWith('/playback/session')) {
      return { session: session({}), speaker: 'here', speaker_device_id: 'd1', speaker_name: 'Laptop', ask_before_playing_here: false, server_time: Date.now() / 1000 };
    }
    if (path === '/playback/heartbeat') {
      if (script.heartbeat) return script.heartbeat();
      return { outcome: 'renewed', session: session({ lease_expires_at: Date.now() / 1000 + 60 }), server_time: Date.now() / 1000 };
    }
    if (path === '/playback/commands') return script.commands?.() ?? { status: 'applied', session: session({}) };
    throw new Error(`unexpected ${path}`);
  }) as Api;
  return { api, calls, setDown: (value: boolean) => { down = value; } };
}

beforeEach(() => {
  configureConnection({ reset: true, probe: async () => false });
});

afterEach(() => {
  configureConnection({ reset: true, probe: async () => false });
});

describe('couldNotReach', () => {
  it('tells a network failure from a refusal', () => {
    expect(couldNotReach(new TypeError('Failed to fetch'))).toBe(true);
    expect(couldNotReach({ status: 503 })).toBe(true);
    expect(couldNotReach({ status: 0 })).toBe(true);
    expect(couldNotReach({ name: 'TimeoutError' })).toBe(true);
    expect(couldNotReach({ status: 409 })).toBe(false);
    expect(couldNotReach({ status: 403 })).toBe(false);
    reportOffline();
    expect(couldNotReach({ status: 409 })).toBe(true);
  });
});

describe('playing through a dropped connection (cloud.offline_playback)', () => {
  it('keeps playing past the lease while offline, then settles the lease on return', async () => {
    const sound = speaker();
    const { api, calls, setDown } = harness({});
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-off-1', speaker: sound }));
    try {
      await waitFor(() => expect(sound.start).toHaveBeenCalledTimes(1));
      setDown(true);
      act(() => reportOffline());
      await waitFor(() => expect(hook.result.current.offline).toBe(true), { timeout: 3_000 });
      expect(sound.stop).not.toHaveBeenCalled();
      expect(hook.result.current.isSpeaker()).toBe(true);
      expect(hook.result.current.message).toBe('');

      setDown(false);
      act(() => reportOk());
      await waitFor(() => expect(hook.result.current.offline).toBe(false), { timeout: 3_000 });
      expect(calls.filter((path) => path === '/playback/reconnect').length).toBeGreaterThanOrEqual(2);
      expect(sound.stop).not.toHaveBeenCalled();
      // nothing restarted: the music carried on through the whole drop
      expect(sound.start).toHaveBeenCalledTimes(1);
      expect(hook.result.current.offlineNotice).toBe('');
    } finally { hook.unmount(); }
  });

  it('another device took over meanwhile: stops here on return and says so', async () => {
    const sound = speaker();
    vi.mocked(sound.position).mockReturnValue(null);
    const { api, setDown } = harness({ reconnect: () => ({ action: 'stop_moved', session: session({ active_device_id: 'd2' }), message: null, moved_to_name: 'Tablet' }) });
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-off-2', speaker: sound }));
    try {
      await waitFor(() => expect(sound.start).toHaveBeenCalledTimes(1));
      vi.mocked(sound.position).mockReturnValue(null);
      setDown(true);
      act(() => reportOffline());
      await waitFor(() => expect(hook.result.current.offline).toBe(true), { timeout: 3_000 });
      setDown(false);
      act(() => reportOk());
      await waitFor(() => expect(hook.result.current.offlineNotice).toBe('Tablet took over while this device was offline, so playback stopped here.'), { timeout: 3_000 });
      expect(sound.stop).toHaveBeenCalled();
      expect(hook.result.current.isSpeaker()).toBe(false);
    } finally { hook.unmount(); }
  });

  it('with nobody named, a refused heartbeat on return stops here with the plain sentence', async () => {
    const sound = speaker();
    let refuse = false;
    const { api, setDown } = harness({
      reconnect: () => ({ action: 'stop_moved', session: null, message: null }),
      heartbeat: () => (refuse
        ? { outcome: 'refused', session: session({ active_device_id: 'd2' }), server_time: Date.now() / 1000 }
        : { outcome: 'renewed', session: session({}), server_time: Date.now() / 1000 }),
    });
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-off-3', speaker: sound }));
    try {
      await waitFor(() => expect(sound.start).toHaveBeenCalledTimes(1));
      setDown(true);
      act(() => reportOffline());
      await waitFor(() => expect(hook.result.current.offline).toBe(true), { timeout: 3_000 });
      refuse = true;
      setDown(false);
      act(() => reportOk());
      await waitFor(() => expect(hook.result.current.offlineNotice).toBe(TAKEN_OVER_WHILE_OFFLINE), { timeout: 3_000 });
      expect(sound.stop).toHaveBeenCalled();
    } finally { hook.unmount(); }
  });

  it('a heartbeat the server refuses (not a network drop) still stops at the lease', async () => {
    const sound = speaker();
    const { api } = harness({ heartbeat: () => { throw Object.assign(new Error('fence'), { status: 409 }); } });
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-off-4', speaker: sound }));
    try {
      await waitFor(() => expect(sound.start).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(sound.stop).toHaveBeenCalledWith(0), { timeout: 3_500 });
      // a refusal is not a dropped connection: no playing on "offline"
      expect(hook.result.current.offline).toBe(false);
    } finally { hook.unmount(); }
  });

  it('pause and volume act here at once while offline, and the volume is held to send later', async () => {
    const sound = speaker();
    const { api, calls, setDown } = harness({});
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-off-5', speaker: sound }));
    try {
      await waitFor(() => expect(sound.start).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(hook.result.current.view?.session).toBeTruthy());
      setDown(true);
      act(() => reportOffline());
      const before = calls.filter((path) => path === '/playback/commands').length;
      let took = false;
      await act(async () => { took = await hook.result.current.send('pause'); });
      expect(took).toBe(true);
      expect(sound.pause).toHaveBeenCalled();
      await act(async () => { await hook.result.current.send('set_volume', { volume: 40 }); });
      expect(sound.setVolume).toHaveBeenCalledWith(0.4);
      expect(hook.result.current.heldVolume()).toBe(40);
      expect(calls.filter((path) => path === '/playback/commands').length).toBe(before);
      expect(hook.result.current.error).toBe('');
    } finally { hook.unmount(); }
  });

  it('with the flag off, a dropped connection stops at the lease as it always did', async () => {
    setFlags({ 'cloud.offline_playback': false });
    const sound = speaker();
    const { api, setDown } = harness({});
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws-off-6', speaker: sound }));
    try {
      await waitFor(() => expect(sound.start).toHaveBeenCalledTimes(1));
      setDown(true);
      act(() => reportOffline());
      await waitFor(() => expect(sound.stop).toHaveBeenCalledWith(0), { timeout: 3_500 });
      expect(hook.result.current.offline).toBe(false);
    } finally { hook.unmount(); }
  });
});
