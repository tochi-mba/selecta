import type { MixItem } from '../api';
import type { NowState, SetPlayer } from '../player';
import { audioOwner } from './focus';
import { flagOn } from '../flags';
import { getArtImage, peekArtUrl, songKeyFor, type ArtImage } from '../media/artStore';

/** The playing song's own cover for the system controls and the lock screen (ADR-0478,
 * `library.art_embedded`): a local `blob:` URL from this device, never a third party's. The
 * metadata is set at once without it; when the cover is found, the metadata is set again, only
 * if the same song is still the one described. */
let artFor: { songId: number; sha: string | null; image: ArtImage | null } | null = null;
let artLooking: number | null = null;

function artworkFor(session: MediaSession, songId: number, init: MediaMetadataInit): MediaImage[] | undefined {
  if (!flagOn('library.art_embedded')) return undefined;
  if (artFor?.songId === songId) {
    const { sha, image } = artFor;
    // a URL the page's small cache has since revoked is looked up again, never handed out stale
    if (!image || !sha) return undefined;
    if (peekArtUrl(sha, 'large') === image.src) return [{ src: image.src, sizes: '512x512', type: image.type }];
    artFor = null;
  }
  if (artLooking !== songId) {
    artLooking = songId;
    let found: string | null = null;
    void songKeyFor(songId)
      .then((sha) => { found = sha; return sha ? getArtImage(sha, 'large') : null; })
      .catch(() => null)
      .then((image) => {
        if (artLooking !== songId) return;
        artLooking = null;
        artFor = { songId, sha: found, image };
        const described = session.metadata;
        if (!image || !described || typeof MediaMetadata === 'undefined') return;
        if (described.title !== init.title || described.artist !== init.artist) return;
        try {
          session.metadata = new MediaMetadata({ ...init, artwork: [{ src: image.src, sizes: '512x512', type: image.type }] });
        } catch {
          // artwork is optional and never stops playback
        }
      });
  }
  return undefined;
}

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
  const init = current && song
    ? { title: song.title || 'Untitled', artist: song.artist || 'Unknown artist', album: mixName }
    : null;
  const artwork = init && song ? artworkFor(session, song.song_id, init) : undefined;
  session.metadata = init && typeof MediaMetadata !== 'undefined'
    ? new MediaMetadata({ ...init, ...(artwork ? { artwork } : {}) })
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
