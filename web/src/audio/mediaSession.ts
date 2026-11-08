import type { MixItem } from '../api';
import type { NowState, SetPlayer } from '../player';
import { audioOwner } from './focus';

type Transport = Pick<SetPlayer, 'state' | 'togglePause' | 'next' | 'previous' | 'seek'>;

/** OS controls must act on the one authoritative mix player, never a preview or a stale render. */
export function bindMediaSession(session: MediaSession, player: Transport, getMix: () => MixItem[]): () => void {
  const playable = () => !audioOwner() && getMix().length > 0;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => {
      if (playable() && (player.state.phase === 'idle' || player.state.phase === 'paused')) {
        void player.togglePause();
      }
    }],
    ['pause', () => {
      if (playable() && player.state.phase === 'playing') void player.togglePause();
    }],
    ['nexttrack', () => {
      if (playable() && player.state.phase !== 'idle' && getMix()[player.state.position + 1]) {
        void player.next();
      }
    }],
    ['previoustrack', () => {
      if (playable() && player.state.phase !== 'idle') void player.previous();
    }],
    ['seekto', (details) => {
      const state = player.state;
      if (!playable() || state.inSeam || (state.phase !== 'playing' && state.phase !== 'paused')) return;
      if (!getMix()[state.position] || !Number.isFinite(state.duration) || state.duration <= 0) return;
      if (details.seekTime === undefined || !Number.isFinite(details.seekTime)) return;
      void player.seek(Math.min(Math.max(details.seekTime, 0), Math.max(state.duration - 1, 0)));
    }],
  ];
  const supported: MediaSessionAction[] = [];
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
      supported.push(action);
    } catch {
      // Media key support differs by browser.
    }
  }
  return () => {
    for (const action of supported) {
      try { session.setActionHandler(action, null); } catch { /* Unsupported on this device. */ }
    }
    session.metadata = null;
    session.playbackState = 'none';
    try { session.setPositionState?.(); } catch { /* Optional browser feature. */ }
  };
}

/** Metadata and position always describe the audible song, not a proposed seam or draft. */
export function syncMediaSession(session: MediaSession, now: NowState, song: MixItem | undefined, mixName: string, previewing = false) {
  const current = !!song && now.phase !== 'idle' && !previewing;
  session.metadata = current && typeof MediaMetadata !== 'undefined'
    ? new MediaMetadata({ title: song.title || 'Untitled', artist: song.artist || 'Unknown artist', album: mixName })
    : null;
  session.playbackState = current && now.phase === 'playing' ? 'playing'
    : current && now.phase === 'paused' ? 'paused' : 'none';

  try {
    if (current && (now.phase === 'playing' || now.phase === 'paused')
      && Number.isFinite(now.duration) && now.duration > 0 && Number.isFinite(now.songTime)) {
      session.setPositionState?.({
        duration: now.duration,
        position: Math.min(Math.max(now.songTime, 0), now.duration),
        playbackRate: 1,
      });
    } else {
      session.setPositionState?.();
    }
  } catch {
    // Media Session position is optional and cannot prevent playback.
  }
}
