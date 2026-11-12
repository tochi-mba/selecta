import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackDevice, type Api, type SessionState, type Speaker } from './usePlaybackDevice';

// With `devices.remote_control` off the speaker applies no command from another device, even one
// that reached the session before the switch (SC-0415, devices.remote_control).

const playing: SessionState = {
  mix_revision_id: 'r1', song_index: 0, offset_ms: 0, anchor_at: 100, state: 'playing',
  active_device_id: 'laptop', lease_expires_at: 200, seq: 3,
};
const paused: SessionState = { ...playing, state: 'paused', anchor_at: null, seq: 4 };

function speaker(): Speaker & { pause: ReturnType<typeof vi.fn> } {
  return {
    start: vi.fn(async () => undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    position: () => ({ song_index: 0, offset_ms: 0, state: 'playing' }), active: () => true,
  };
}

const api = (async (path: string) => {
  if (path === '/devices') return { device: { id: 'laptop', name: 'Laptop', kind: 'laptop', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
  if (path === '/playback/reconnect') return { action: 'continue', session: playing, message: null };
  if (path.startsWith('/playback/session')) return { session: paused, speaker: 'here', speaker_device_id: 'laptop', speaker_name: 'Laptop', ask_before_playing_here: false, server_time: 100 };
  if (path === '/playback/heartbeat') return { outcome: 'ok', session: paused, server_time: 100 };
  throw new Error(`unexpected ${path}`);
}) as Api;

afterEach(() => { cleanup(); });

describe('a speaker with remote control off', () => {
  it('ignores a pause another device sent', async () => {
    const quiet = speaker();
    renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker: quiet, remoteControl: false }));
    await waitFor(() => expect(quiet.start).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(quiet.pause).not.toHaveBeenCalled();
  });

  it('follows the same pause when remote control is on', async () => {
    const following = speaker();
    renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker: following }));
    await waitFor(() => expect(following.pause).toHaveBeenCalled(), { timeout: 4000 });
  });
});
