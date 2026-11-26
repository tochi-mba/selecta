import { displayNames } from '../../media/importer';

// What the hosted card says (cloud.hosted_render): the server's song and mix answers turned into
// plain words, kept apart from the card so each rule has a test. Both shapes of the songs answer
// are read: the first (`analysis`, `counts`) and the current one (`status`, `totals`, `moving`).

export type SongStatusNow = { state: 'waiting' | 'running' | 'done' | 'failed'; reason?: string | null; can_retry?: boolean; job_id?: string | null };
export type Analysis = { state: string; bpm?: number | null; camelot?: string | null; why?: string };
export type HostedSong = {
  asset_id: string; name: string; title?: string | null; artist?: string | null; duration_s?: number | null; analysis: Analysis; status?: SongStatusNow;
  /** Other uploads of the same bytes, and of the same recording (the planner keeps one of each). */
  same_file_as?: string[]; same_recording_as?: string[];
};
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
  if (seconds < 60) return 'less than a minute';
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

/** An export as the server answers it (`/hosted/mixes/export`, `/hosted/exports/{id}`). Progress
 * is parts written of the parts plus the upload, as `parts_done` and `parts_total` and as the pair
 * `progress`; `estimate_s` comes only from the job's own pace. An older server sends less. Nothing
 * here makes a number up. */
export type ExportState = {
  state: string; job_id?: string; url?: string | null; why?: string;
  progress?: [number | null, number | null] | number | null; parts_done?: number | null; parts_total?: number | null;
  estimate_s?: number | null; worker_seen?: boolean; size_bytes?: number | null; seconds?: number | null;
};

/** Parts written and parts in all, when the server says (either shape). */
function exportParts(state: ExportState): { done: number; total: number } | null {
  const pair = Array.isArray(state.progress) ? state.progress : null;
  const done = state.parts_done ?? pair?.[0] ?? null;
  const total = state.parts_total ?? pair?.[1] ?? null;
  if (typeof done !== 'number' || typeof total !== 'number' || !Number.isFinite(done) || !(total > 0)) return null;
  return { done: Math.min(total, Math.max(0, done)), total };
}

/** The export's line: how far (only with real parts), how long (only with a real estimate),
 * or why it could not be made. */
export function exportWords(state: ExportState): { fraction: number | null; value: string; detail: string | null } {
  // a refusal is the server's own sentence ("The mix isn't ready yet: export opens once ...")
  if (state.state === 'refused') return { fraction: null, value: 'Not started', detail: state.why ?? 'The export could not be started. Try again in a moment.' };
  if (state.state === 'failed') return { fraction: null, value: 'Stopped', detail: `The export could not be made: ${(state.why ?? 'it stopped part way').replace(/\.$/, '')}.` };
  if (state.state === 'ready') return { fraction: 1, value: 'Ready', detail: null };
  const parts = exportParts(state);
  // in the queue nothing is known yet: the bar says something is happening, not "0 percent"
  const fraction = state.state === 'queued' && !parts?.done ? null : parts ? parts.done / parts.total : typeof state.progress === 'number' && Number.isFinite(state.progress) ? Math.min(1, Math.max(0, state.progress)) : null;
  if (state.worker_seen === false) return { fraction, value: 'Waiting for a server', detail: stillWords('worker') };
  const value = !parts || (state.state === 'queued' && parts.done === 0)
    ? (state.state === 'queued' ? 'Waiting for a server' : 'Joining the mix')
    // the last unit is the upload of the finished file
    : parts.done >= parts.total - 1 ? 'Saving the file' : `Part ${parts.done + 1} of ${parts.total - 1}`;
  return { fraction, value, detail: leftWords(state.estimate_s) };
}

/** "107 MB", "1.2 GB". */
export function sizeWords(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** What the download is, and a word before a large one on a phone's data. */
export function downloadWords(state: ExportState, phone: boolean): { label: string; note: string | null } {
  const size = typeof state.size_bytes === 'number' && state.size_bytes > 0 ? sizeWords(state.size_bytes) : null;
  const length = typeof state.seconds === 'number' && state.seconds > 0 ? clock(state.seconds) : null;
  const label = size ? `Download the mix (lossless FLAC, ${size})` : 'Download the mix (lossless FLAC)';
  const facts = [length && `${length} long`, size].filter(Boolean).join(', ');
  const large = typeof state.size_bytes === 'number' && state.size_bytes >= LARGE_DOWNLOAD;
  const note = large && phone
    ? `A large file${facts ? ` (${facts})` : ''}: download it over Wi-Fi. If the download stops, the browser can carry it on for a while.`
    : facts ? `One 24-bit file of the mix exactly as it plays: ${facts}.` : null;
  return { label, note };
}

/** From this size a phone is told to use Wi-Fi first. */
export const LARGE_DOWNLOAD = 100e6;

/** Songs analysed, and how many different recordings they are: the planner keeps one copy of each
 * recording (`same_recording_as`, `same_file_as`), so a mix can have fewer songs than uploads. */
export function recordingsOf(songs: readonly HostedSong[]): { done: number; recordings: number } {
  const done = songs.filter((song) => songState(song).state === 'done');
  const seen = new Set<string>();
  let recordings = 0;
  for (const song of done) {
    if (seen.has(song.asset_id)) continue;
    recordings += 1;
    for (const id of [song.asset_id, ...(song.same_recording_as ?? []), ...(song.same_file_as ?? [])]) seen.add(id);
  }
  return { done: done.length, recordings };
}

/** "5 songs analysed, 4 different recordings; 1 could not be." */
export function analysedWords(done: number, recordings: number, failed: number): string {
  const head = done === 1 ? '1 song analysed' : `${done} songs analysed`;
  const copies = recordings < done ? `, ${recordings === 1 ? '1 recording' : `${recordings} different recordings`} (a mix plays each recording once)` : '';
  return `${head}${copies}${failed ? `; ${failed} could not be` : ''}.`;
}

/** A plan chooses from at most 60 recordings; a larger library is sampled at random for each plan
 * (`considered` of `analysed` from `/hosted/mixes/plan`). Said only when it was sampled. */
export function poolWords(pool: { considered?: number; analysed?: number } | null | undefined): string | null {
  if (!pool?.considered || !pool.analysed || pool.considered >= pool.analysed) return null;
  return `Planned from ${pool.considered} of your ${pool.analysed} analysed songs, picked at random. Make another mix picks again.`;
}

/** "About 3 minutes left.", only for a real estimate. */
function leftWords(estimate: number | null | undefined): string | null {
  if (typeof estimate !== 'number' || !Number.isFinite(estimate) || estimate <= 0) return null;
  const left = minutes(estimate);
  return `${left[0].toUpperCase()}${left.slice(1)} left.`;
}

/** Under the transitions' bar while they render: a time only when the server gives one, and
 * when it gives none, why (`estimate_why`: no worker, a job overrunning, servers busy). An older
 * server sends only `worker_seen`. */
export function renderDetail(mix: { worker_seen?: boolean; estimate_s?: number | null; estimate_why?: string | null }): string {
  const opens = 'Play opens when every part is ready.';
  if (mix.estimate_why === 'no_worker' || (mix.estimate_why === undefined && mix.worker_seen === false)) return stillWords('worker');
  if (mix.estimate_why === 'overrunning') return `Taking longer than usual, and still going. ${opens}`;
  if (mix.estimate_why === 'busy') return `SelectaDJ’s servers are busy with other mixes; yours is in line. ${opens}`;
  const left = leftWords(mix.estimate_s);
  return left ? `${left} ${opens}` : opens;
}

/** The footer's promise about where music lives: a hosted account keeps its uploads with SelectaDJ. */
export function footerWords(hosted: boolean): string {
  return hosted
    ? 'SelectaDJ Cloud. Songs you upload are kept privately in your SelectaDJ storage; music you connect on a device stays there.'
    : 'SelectaDJ Cloud. Your music files stay on your devices; your account keeps their details.';
}
