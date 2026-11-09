import { flagOn } from '../flags';
import type { ListeningEventKind } from './types';

/** What the main player actually played, for Lucy's sense of your taste: when a song started, and
 * whether it was heard through or skipped. Only the main player calls this, never a preview, an
 * audition or the Studio. Nothing here can throw, wait or change what's playing: each report is sent
 * and forgotten, and a server that doesn't collect it (off, or older) is simply ignored. */

const SESSION = (() => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
})();

const seconds = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value * 10) / 10) : 0);

export function recordListening(songId: number, event: ListeningEventKind, heard: number, position: number): void {
  try {
    if (typeof fetch !== 'function' || !Number.isFinite(songId) || !flagOn('lucy.listening_history')) return;
    void fetch('/api/listening/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ song_id: songId, session: SESSION, source: 'player', event, heard: seconds(heard), position: seconds(position) }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* listening history is a nice-to-have; the music never waits for it */
  }
}

/** The song whose start was reported and hasn't been closed yet, and how much of it had been heard
 * before (the player's own running total), so only this listen is counted. Seeking within a song
 * restarts its audio but isn't a new listen. */
let open: { songId: number; heardBefore: number } | null = null;

export function listenStarted(songId: number, position: number, heardSoFar: number): void {
  if (open?.songId === songId) return;
  open = { songId, heardBefore: heardSoFar };
  recordListening(songId, 'start', 0, position);
}

export function listenEnded(songId: number, event: Exclude<ListeningEventKind, 'start'>, heardSoFar: number, position: number): void {
  if (open?.songId !== songId) return;
  const heard = heardSoFar - open.heardBefore;
  open = null;
  recordListening(songId, event, heard, position);
}
