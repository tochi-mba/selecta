import { act, renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FADE_MS, Speaker, usePlaybackDevice } from '../devices/usePlaybackDevice';
import type { Api, Asset } from './api';
import { recoveringSpeaker } from './recoveringSpeaker';
import { useCloudPlayer } from './useCloudPlayer';

// AV-0419-05: lease transfer to another device, and media failure recovery with an honest
// message, for both the session speaker and the Library player.

afterEach(() => vi.restoreAllMocks());

function stubSpeaker(): Speaker & { starts: [number, number, boolean][]; stops: number[]; disposed: boolean } {
  const made = {
    starts: [] as [number, number, boolean][], stops: [] as number[], disposed: false, index: -1,
    async start(songIndex: number, offsetMs: number, playing: boolean) { made.index = songIndex; made.starts.push([songIndex, offsetMs, playing]); },
    stop(fadeMs: number) { made.index = -1; made.stops.push(fadeMs); },
    pause() {}, resume() {},
    position() { return made.index < 0 ? null : { song_index: made.index, offset_ms: 4000, state: 'playing' as const }; },
    active() { return made.index >= 0; },
    dispose() { made.disposed = true; },
  };
  return made;
}

describe('the speaker recovers from media failure (AV-0419-05)', () => {
  const setUp = (source: (index: number) => Promise<string | null>) => {
    const audio = document.createElement('audio');
    audio.setAttribute('src', 'blob:song');
    const made: ReturnType<typeof stubSpeaker>[] = [];
    const problems: string[] = [];
    const speaker = recoveringSpeaker(audio, source, {
      onProblem: (text) => problems.push(text),
      songName: (index) => `Song ${index + 1}.wav`,
      make: (() => { const next = stubSpeaker(); made.push(next); return next; }) as never,
    });
    const fail = async () => { audio.dispatchEvent(new Event('error')); await new Promise((resolve) => setTimeout(resolve, 0)); };
    return { speaker, made, problems, fail };
  };

  it('first refetches the same song at the same place, then moves on and says which song failed', async () => {
    const { speaker, made, problems, fail } = setUp(async (index) => (index < 3 ? `https://r2.test/${index}` : null));
    await speaker.start(1, 0, true);
    await fail();
    expect(made).toHaveLength(2); // a fresh speaker: no cached copy of the broken file
    expect(made[0]?.disposed).toBe(true);
    expect(made[1]?.starts).toEqual([[1, 4000, true]]);
    expect(problems).toEqual([]);
    await fail();
    expect(made[1]?.starts.at(-1)).toEqual([2, 0, true]);
    expect(problems).toEqual(['Song 2.wav could not be played, so SelectaDJ moved to the next song.']);
  });

  it('at the end of the list it stops and says so, instead of retrying for ever', async () => {
    const { speaker, made, problems, fail } = setUp(async (index) => (index < 1 ? 'https://r2.test/0' : null));
    await speaker.start(0, 0, true);
    await fail();
    await fail();
    expect(made[1]?.stops).toEqual([0]);
    expect(problems).toEqual(['Song 1.wav could not be played and there is no next song, so playback stopped.']);
    await fail();
    expect(problems).toHaveLength(1);
  });

  it('ignores errors once disposed or emptied', async () => {
    const { speaker, made, fail } = setUp(async () => 'x');
    await speaker.start(0, 0, true);
    speaker.dispose?.();
    await fail();
    expect(made).toHaveLength(1);
  });
});

describe('the Library player skips a song that cannot be played (AV-0419-05)', () => {
  const songs: Asset[] = ['A', 'B'].map((name, at) => ({ id: name.toLowerCase(), name: `Song ${name}.wav`, size: 1, sha256: null, format: 'wav', duration_seconds: 60, sample_rate: null, channels: null, created_at: at }));
  const api = (async (path: string) => ({ status: 'ready', url: `https://r2.test${path}?v=${Math.random()}` })) as Api;

  const play = (skipOnFailure: boolean) => {
    const errors: string[] = [];
    const audio = createRef<HTMLAudioElement>() as { current: HTMLAudioElement | null };
    audio.current = document.createElement('audio');
    const hook = renderHook(() => useCloudPlayer({ api, workspaceId: 'ws', audio, setError: (text) => { if (text) errors.push(text); }, skipOnFailure }));
    return { hook, errors };
  };

  it('with the flag on: one refresh, then the next song and an honest message', async () => {
    const { hook, errors } = play(true);
    await act(async () => { await hook.result.current.start(songs, 0); });
    await act(async () => { await hook.result.current.refreshUrl(); });
    expect(hook.result.current.track?.id).toBe('a');
    await act(async () => { await hook.result.current.refreshUrl(); });
    await waitFor(() => expect(hook.result.current.track?.id).toBe('b'));
    await waitFor(() => expect(errors).toContain('Song A.wav could not be played, so the next song is playing.'));
  });

  it('with the flag off: it stops and asks for Listen again, exactly as before', async () => {
    const { hook, errors } = play(false);
    await act(async () => { await hook.result.current.start(songs, 0); });
    await act(async () => { await hook.result.current.refreshUrl(); });
    await act(async () => { await hook.result.current.refreshUrl(); });
    expect(hook.result.current.track?.id).toBe('a');
    expect(errors).toEqual(['This playback link could not be refreshed. Try Listen again.']);
  });
});

describe('the lease moves to another device (AV-0419-05)', () => {
  it('the old speaker fades out and names the device that took over', async () => {
    const session = { mix_revision_id: null, song_index: 2, offset_ms: 0, anchor_at: 100, state: 'playing' as const, active_device_id: 'me', lease_expires_at: 120, seq: 3 };
    let speakerNow: 'here' | 'elsewhere' = 'here';
    const api = (async (path: string) => {
      if (path === '/devices') return { device: { id: 'me', name: 'Edge', kind: 'laptop', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
      if (path === '/playback/reconnect') return { action: 'continue', session, message: null };
      if (path.startsWith('/playback/session')) return { session, speaker: speakerNow, speaker_device_id: speakerNow === 'here' ? 'me' : 'phone', speaker_name: speakerNow === 'here' ? 'Edge' : 'Phone', ask_before_playing_here: false, server_time: 100 };
      throw new Error(`unexpected ${path}`);
    }) as Api;
    const speaker = stubSpeaker();
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker }));
    await waitFor(() => expect(speaker.starts).toHaveLength(1));
    expect(hook.result.current.isSpeaker()).toBe(true);
    speakerNow = 'elsewhere';
    await waitFor(() => expect(hook.result.current.message).toBe('Playback moved to Phone'), { timeout: 5000 });
    expect(speaker.stops).toContain(FADE_MS);
    expect(hook.result.current.isSpeaker()).toBe(false);
    hook.unmount();
  });
});
