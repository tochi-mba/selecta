import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixItem } from '../api';
import type { NowState, SetPlayer } from '../player';
import { releaseAudio, takeAudio } from './focus';
import { bindMediaSession, syncMediaSession } from './mediaSession';

const song: MixItem = {
  position: 0, song_id: 17, title: 'A real track', artist: 'Local artist',
  duration: 120, bpm: null, key: null, locked: false, seam: null,
};
const state = (changes: Partial<NowState> = {}): NowState => ({
  phase: 'playing', position: 0, songTime: 32, duration: 120, inSeam: false,
  seamAt: null, notice: '', nextReady: true, lastSeamKey: null,
  volume: 1, muted: false, ...changes,
});
const transport = (changes: Partial<NowState> = {}) => ({
  state: state(changes),
  togglePause: vi.fn(async () => {}),
  next: vi.fn(async () => {}),
  previous: vi.fn(async () => {}),
  seek: vi.fn(async (_: number) => {}),
});

function fakeSession() {
  const actions = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  const session = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: vi.fn((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => actions.set(action, handler)),
    setPositionState: vi.fn(),
  } as unknown as MediaSession;
  const act = (action: MediaSessionAction, details: Partial<MediaSessionActionDetails> = {}) =>
    actions.get(action)?.({ action, ...details } as MediaSessionActionDetails);
  return { session, actions, act };
}

afterEach(() => {
  releaseAudio('media-session-test-preview');
  vi.unstubAllGlobals();
});

describe('authoritative OS media transport', () => {
  it('follows the current song, rejects invalid seeks and refuses seeking during a seam', () => {
    const player = transport();
    const mix = [song, { ...song, position: 1, song_id: 18 }];
    const { session, act } = fakeSession();
    const cleanup = bindMediaSession(session, player as unknown as SetPlayer, () => mix);
    act('pause');
    expect(player.togglePause).toHaveBeenCalledOnce();
    act('seekto', { seekTime: Number.NaN });
    act('seekto', { seekTime: Number.POSITIVE_INFINITY });
    expect(player.seek).not.toHaveBeenCalled();
    act('seekto', { seekTime: 999 });
    expect(player.seek).toHaveBeenCalledWith(119);
    act('seekto', { seekTime: -50 });
    expect(player.seek).toHaveBeenLastCalledWith(0);
    player.state.inSeam = true;
    act('seekto', { seekTime: 10 });
    expect(player.seek).toHaveBeenCalledTimes(2);
    act('nexttrack');
    expect(player.next).toHaveBeenCalledOnce();
    cleanup();
    expect(session.setActionHandler).toHaveBeenCalledWith('seekto', null);
  });

  it('never starts an empty mix or hijacks a preview, and clears media actions on unmount', () => {
    const player = transport({ phase: 'idle' });
    let mix: MixItem[] = [];
    const { session, act, actions } = fakeSession();
    const cleanup = bindMediaSession(session, player as unknown as SetPlayer, () => mix);
    act('play');
    expect(player.togglePause).not.toHaveBeenCalled();
    mix = [song];
    act('play');
    expect(player.togglePause).toHaveBeenCalledOnce();
    player.state.phase = 'paused';
    takeAudio({ id: 'media-session-test-preview', label: 'Audition', stop: vi.fn() });
    act('play');
    act('previoustrack');
    expect(player.togglePause).toHaveBeenCalledOnce();
    expect(player.previous).not.toHaveBeenCalled();
    releaseAudio('media-session-test-preview');
    cleanup();
    expect(actions.get('play')).toBeNull();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
  });

  it('reports real position and metadata only when a track owns the session', () => {
    vi.stubGlobal('MediaMetadata', class { constructor(public details: MediaMetadataInit) {} });
    const { session } = fakeSession();
    syncMediaSession(session, state(), song, 'My performance');
    expect(session.playbackState).toBe('playing');
    expect((session.metadata as unknown as { details: MediaMetadataInit }).details).toMatchObject({
      title: song.title, artist: song.artist, album: 'My performance',
    });
    expect(session.setPositionState).toHaveBeenLastCalledWith({ duration: 120, position: 32, playbackRate: 1 });

    syncMediaSession(session, state({ phase: 'paused', songTime: 999 }), song, 'My performance');
    expect(session.playbackState).toBe('paused');
    expect(session.setPositionState).toHaveBeenLastCalledWith({ duration: 120, position: 120, playbackRate: 1 });

    syncMediaSession(session, state(), song, 'My performance', true);
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    expect(session.setPositionState).toHaveBeenLastCalledWith();
  });
});
