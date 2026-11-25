import { displayNames } from '../../media/importer';

// What the hosted card says (cloud.hosted_render): the server's song and mix answers turned into
// plain words, kept apart from the card so each rule has a test. Both shapes of the songs answer
// are read: the first (`analysis`, `counts`) and the current one (`status`, `totals`, `moving`).

export type SongStatusNow = { state: 'waiting' | 'running' | 'done' | 'failed'; reason?: string | null; can_retry?: boolean; job_id?: string | null };
export type Analysis = { state: string; bpm?: number | null; camelot?: string | null; why?: string };
export type HostedSong = { asset_id: string; name: string; title?: string | null; artist?: string | null; duration_s?: number | null; analysis: Analysis; status?: SongStatusNow };
export type SongsStatus = {
  songs: HostedSong[];
  counts: Record<'ready' | 'running' | 'queued' | 'failed' | 'not_started', number>;
  totals?: { waiting: number; running: number; done: number; failed: number; total: number };
  moving?: boolean;
  waiting_for?: 'worker' | 'retry' | null;
  estimate_s: number | null; worker_seen?: boolean; seconds_each: number; total: number;
};

export type SongState = { state: 'waiting' | 'running' | 'done' | 'failed'; reason: string | null; canRetry: boolean };

/** One song's state in the current words, from either shape. */
export function songState(song: HostedSong): SongState {
  if (song.status) {
    return { state: song.status.state, reason: song.status.reason ?? (song.status.state === 'failed' ? song.analysis.why ?? null : null), canRetry: song.status.can_retry ?? song.status.state === 'failed' };
  }
  const old = song.analysis.state;
  const state = old === 'ready' ? 'done' : old === 'running' ? 'running' : old === 'failed' ? 'failed' : 'waiting';
  return { state, reason: state === 'failed' ? song.analysis.why ?? 'It stopped part way.' : null, canRetry: state === 'failed' };
}

export type Totals = { waiting: number; running: number; done: number; failed: number; total: number };

export function totalsOf(status: SongsStatus): Totals {
  if (status.totals) return status.totals;
  const { ready, running, queued, failed, not_started: notStarted } = status.counts;
  return { waiting: queued + notStarted, running, done: ready, failed, total: status.total };
}

/** Title and artist as the Library shows them: the server's words when it sends them, else the
 * file name read the way an import reads it ("001. Morgan Wallen - Last Night.mp3" is Last Night
 * by Morgan Wallen). */
export function songNames(song: { name?: string | null; title?: string | null; artist?: string | null } | undefined): { title: string; artist: string } {
  if (!song) return { title: 'A song', artist: '' };
  const fromName = displayNames({}, song.name || 'Untitled');
  const artist = song.artist || (fromName.artist === 'Unknown artist' ? '' : fromName.artist);
  return { title: song.title || fromName.title || 'Untitled', artist };
}

export function minutes(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const whole = Math.round(seconds / 60);
  return whole === 1 ? 'about 1 minute' : `about ${whole} minutes`;
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(mins).padStart(2, '0')}:${secs}` : `${mins}:${secs}`;
}

/** How long is left, said only while the work is really moving: an estimate that stands still
 * (no worker, or no song finished for a long while) would never come true. */
export function timeLeft(estimate: number | null | undefined, moving: boolean): string | null {
  if (!moving || estimate === null || estimate === undefined) return null;
  const left = minutes(estimate);
  return `${left[0].toUpperCase()}${left.slice(1)} left`;
}

/** Why nothing is moving, in the customer's words. */
export function stillWords(waitingFor: 'worker' | 'retry' | null | undefined): string {
  if (waitingFor === 'retry') return 'Waiting to try again. Nothing is lost.';
  return 'Waiting for a SelectaDJ server to start. Nothing is lost; it carries on when one does.';
}

/** Whether the songs' work is moving: the server says so in its current shape; with the first
 * one, a worker has checked in and something finished in the last few minutes. */
export function songsMoving(status: SongsStatus, lastProgressAt: number, now: number): boolean {
  if (status.moving !== undefined) return status.moving;
  return !!status.worker_seen && status.estimate_s !== null && now - lastProgressAt < STALL_MS;
}

/** No song finished for this long: the time left is no longer shown. */
export const STALL_MS = 5 * 60 * 1000;

export const MOVE_NAMES: Record<string, string> = {
  bass_swap_blend: 'Blend', filter_sweep: 'Filter sweep', tempo_ramp: 'Tempo ramp', cut_on_one: 'Cut', cut: 'Cut',
  echo_out: 'Echo out', delay_throw: 'Delay throw', reverb_wash: 'Reverb wash', vocal_ride: 'Vocal ride',
};

export function moveName(move: string | null | undefined): string {
  if (!move) return 'Transition';
  return MOVE_NAMES[move] ?? `${move[0].toUpperCase()}${move.slice(1).replace(/_/g, ' ')}`;
}

export type Seam = { index: number; state: string; planned_move: string | null; move?: string | null; passed?: boolean | null; fell_back?: boolean | null; why?: string };

/** A hand-off's line under its song in the track list. */
export function seamWords(seam: Seam): { words: string; tone: 'ok' | 'working' | 'problem' } {
  const name = moveName(seam.move ?? seam.planned_move);
  switch (seam.state) {
    case 'ready': return { words: seam.passed === false ? `${name} into the next song (a near miss on its checks)` : `${name} into the next song`, tone: 'ok' };
    case 'running': return { words: `${name}: rendering now`, tone: 'working' };
    case 'queued': return { words: `${name}: waiting for a server`, tone: 'working' };
    case 'waiting_for_analysis': return { words: 'Waiting for both songs to be analysed', tone: 'working' };
    case 'refused': return { words: `Plays as a straight change: ${seam.why ?? 'the server was busy'}`, tone: 'problem' };
    case 'failed': return { words: `Plays as a straight change: ${seam.why ?? 'the transition could not be rendered'}`, tone: 'problem' };
    default: return { words: name, tone: 'working' };
  }
}

/** The footer's promise about where music lives: a hosted account keeps its uploads with SelectaDJ. */
export function footerWords(hosted: boolean): string {
  return hosted
    ? 'SelectaDJ Cloud. Songs you upload are kept privately in your SelectaDJ storage; music you connect on a device stays there.'
    : 'SelectaDJ Cloud. Your music files stay on your devices; your account keeps their details.';
}
