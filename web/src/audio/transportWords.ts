import type { NowState } from '../player';

/** UF-0373-02: the mini-player and Listen read the one player through these words, so the song, the
 * phase, the time and the transition label can never disagree between screens. A clock rounds down,
 * as every media player does, and a missing or non-finite time reads 0:00, never NaN. */
export function transportClock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(Math.floor(seconds), 0) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Where the song is, out of how long it is; a length the player doesn't know is said, not guessed. */
export function timeLabel(songTime: number, duration: number): string {
  const known = Number.isFinite(duration) && duration > 0;
  return `${transportClock(songTime)} / ${known ? transportClock(duration) : 'unknown duration'}`;
}

/** What pressing the main transport button will do, in the player's current phase. */
export function playLabel(phase: NowState['phase']): string {
  return phase === 'playing' ? 'Pause' : phase === 'loading' ? 'Loading song' : phase === 'paused' ? 'Resume' : 'Play';
}

/** The words both screens use while a transition is sounding. */
export const SEAM_LABEL = 'Transition playing';

/** A song with no title or artist reads the same everywhere, including an empty string from the server. */
export const songTitle = (song?: { title?: string | null } | null) => song?.title || 'Untitled';
export const songArtist = (song?: { artist?: string | null } | null) => song?.artist || 'Unknown artist';
