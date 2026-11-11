export type SeamState = {
  status: 'none' | 'queued' | 'rendering' | 'ready' | 'failed';
  key: string;
  label?: string;
  style?: string;
  why?: string;
  error?: string;
  passed?: boolean;
  fell_back?: boolean;
  a_source_start?: number;
  b_source_end?: number;
  duration?: number;
  switch_at?: number;
  preview_seam?: number;
  bars?: number;
  rating?: string;
  eta?: number;
  tried?: { move: string; why: string }[];
  checks?: { name: string; passed: boolean; text: string; value: string }[];
};

export type SeamSettings = {
  move?: string;
  bars?: number;
  exit_bar?: number;
  entry_bar?: number;
  phrase?: string;
};

export type MixItem = {
  position: number;
  song_id: number;
  artist: string;
  title: string;
  duration: number;
  bpm: number | null;
  key: string | null;
  energy?: number | null;
  locked: boolean;
  seam: { settings: SeamSettings; state: SeamState; too_soon?: boolean } | null;
  from_request?: { kind: 'requested' | 'bridge'; for?: string | null };
};

export type Eta = { seconds: number; low: number; high: number; late?: boolean };
export type MixEta = Eta & { seams: number };

export type MixData = {
  mix: MixItem[];
  name: string;
  can_undo: boolean;
  undone?: string | null;
  eta?: MixEta;
  draft?: { id: number; place: number | null };
};

export type DraftInfo = {
  id: number;
  name: string;
  songs: number;
  seconds: number;
  seams: number;
  ready: number;
  failed: number;
  waiting: number;
  rendering: boolean;
  place: number | null;
  eta: Eta | null;
  to_render: number;
  missing: number;
  /** The draft's songs in order, for its Mix Sleeve. An older server doesn't send it. */
  song_ids?: number[];
};

export type DraftList = {
  drafts: DraftInfo[];
  current: { name: string; songs: number; left: number; eta: Eta };
  out_of_room: boolean;
};

export type SeamOptions = {
  moves: { name: string; label: string; description: string; available: boolean; reason: string | null }[];
  exits: { bar: number; time: number; kind: string }[];
  entries: { bar: number; time: number; kind: string }[];
  lengths: number[];
  studio?: { available: boolean; reason: string | null };
  links: { phrase: string; line_a: string; line_b: string; score: number }[];
  tempo_gap: number;
  keys: string[];
};

export type Status = {
  counts: Record<string, number>;
  steering: {
    mix_language: string;
    stems: string;
    energy_arc: number[] | null;
    target: string | null;
    target_label?: string | null;
  };
  moves: Record<string, string>;
  analysis_running: boolean;
  analysing: number[];
  mix_rendering: boolean;
  mixes_in_line?: number;
  transitions_ready?: number;
  new_songs?: { count: number; first: string | null; at: number } | null;
  eta?: {
    analysis: Eta & { songs: number; after_mix: boolean };
    line: Record<string, number>;
    jobs: Record<string, number>;
    accuracy?: { jobs: number; typical_miss: number | null };
  };
  scan: { status: string; folder?: string; music?: number; set_aside?: number; error?: string };
  /** Each feature flag and whether it's on in this build. An older server doesn't say. */
  flags?: Record<string, boolean>;
};

export type SongRow = {
  id: number;
  artist: string | null;
  title: string | null;
  genre: string | null;
  duration: number;
  bpm: number | null;
  camelot: string | null;
  lyric_status: string | null;
  never: boolean;
  priority: boolean;
};

export type SongDetail = {
  id: number;
  artist: string;
  title: string;
  duration: number;
  bpm: number;
  key: string;
  peaks: number[];
  bar_times?: number[];
  beat_times?: number[];
  beats_per_bar?: number;
  sections: { label: string; start: number; end: number }[];
  lines: { start: number; end: number; text: string; words?: { start: number; end: number }[] }[];
  lyric_status?: string | null;
};

export type Link = {
  phrase: string;
  kind: string;
  a: number;
  b: number;
  artist_a: string;
  title_a: string;
  artist_b: string;
  title_b: string;
  line_a: string;
  line_b: string;
  moves: string[];
  move: string;
  state: SeamState;
  worked: boolean;
};

export type LinkList = { links: Link[]; prepared: number; preparing: number; eta?: number };

export type VibeCard = {
  key: string;
  name: string;
  blurb: string;
  songs: number;
  ready: boolean;
  needs: number;
  artists: string[];
  group: string;
  family: string | null;
  tempo: [number, number] | null;
  moves: string;
  seconds: number;
  /** GP-0259-07: the measured song facts this idea chooses by; older servers omit it */
  basis?: string[];
};

export type Suggestion = {
  song_id: number;
  artist: string;
  title: string;
  bpm: number | null;
  key: string | null;
  duration: number;
  reason: string;
  analysed: boolean;
};

export type Storage = {
  used_bytes: number;
  cache_bytes: number;
  kept_bytes: number;
  budget_bytes: number;
  largest_budget_bytes: number;
  smallest_budget_bytes: number;
  free_bytes: number;
  total_bytes: number;
};

/** What went wrong, so a page can tell a missing thing from a conflict from a stopped server. */
export class ApiError extends Error {
  status: number;
  code: string;
  /** T0244: the request's own operation id, the same one Diagnostics lists beside its outcome. */
  operation: string;

  constructor(message: string, status: number, code = '', operation = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.operation = operation;
  }
}

/** The operation id a request was sent with, if it had one. */
function operationOf(init?: RequestInit): string {
  const headers = init?.headers;
  if (!headers) return '';
  if (headers instanceof Headers) return headers.get('x-operation-id') ?? '';
  if (Array.isArray(headers)) return headers.find(([name]) => name.toLowerCase() === 'x-operation-id')?.[1] ?? '';
  return (headers as Record<string, string>)['x-operation-id'] ?? '';
}

/** What a stopped server looks like to someone using the app, wherever it comes up. It doesn't say
 * whether a change got through, because when the connection drops nobody can know. */
export const OFFLINE_WORDS = 'Can’t reach Selecta right now. Try again in a moment.';

/** The server broke, rather than saying no. Its own "Internal Server Error" helps nobody. */
export const SERVER_FAILED_WORDS = 'Something went wrong inside Selecta. Your music and mixes are safe. Try again.';

export type ProblemKind = 'offline' | 'missing' | 'conflict' | 'invalid' | 'storage' | 'server' | 'off';

/** What a server says when something is turned off in its build, in place of its own words. */
export const TURNED_OFF_WORDS = 'That’s turned off in this version of Selecta.';

export function problemKind(error: unknown): ProblemKind {
  if (!(error instanceof ApiError)) return 'offline';
  if (error.code === 'flag_off') return 'off';
  if (error.code === 'storage_full') return 'storage';
  if (error.status === 404) return 'missing';
  if (error.status === 409) return 'conflict';
  if (error.status >= 400 && error.status < 500) return 'invalid';
  return 'server';
}

export async function send<T>(path: string, init?: RequestInit): Promise<T> {
  // Reads have a recovery deadline. Never abort a mutation and imply it did not happen.
  const controller = !init?.method || init.method === 'GET' ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), 20000) : null;
  try {
  const response = await fetch(`/api${path}`, controller ? { ...init, signal: controller.signal } : init);
  if (!response.ok) {
    // a page can tell a missing route from anything else, because an older server won't have new ones
    let detail = response.status === 404 ? 'Not Found' : response.status >= 500 ? SERVER_FAILED_WORDS : 'Selecta couldn’t do that. Try again.';
    let code = '';
    try {
      const body = await response.json();
      // a framework's bare "Internal Server Error" says nothing a listener can use; keep ours
      const generic = response.status >= 500 && body.detail === 'Internal Server Error';
      detail = typeof body.detail === 'string' && !generic ? body.detail : detail;
      code = body.code ?? '';
    } catch {
      /* the status text will do */
    }
    throw new ApiError(detail, response.status, code, operationOf(init));
  }
  return await response.json();
  } catch (error) {
    if (controller?.signal.aborted) throw new ApiError('Selecta is taking too long to respond. Try again.', 408, 'read_timeout');
    // what a browser throws when nothing answered at all, in words that only make sense to a developer
    if (error instanceof TypeError) throw new Error(OFFLINE_WORDS);
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}

export const get = <T,>(path: string) => send<T>(path);

export const post = <T,>(path: string, body?: unknown, headers?: Record<string, string>) =>
  send<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });

export const del = <T,>(path: string, headers?: Record<string, string>) => send<T>(path, { method: 'DELETE', headers });

export type LibrarySong = {
  id: number;
  artist: string | null;
  title: string | null;
  genre: string | null;
  duration: number;
  bpm: number | null;
  camelot: string | null;
  detected_bpm: number | null;
  detected_camelot: string | null;
  override_bpm: number | null;
  override_camelot: string | null;
  music_override: number | null;
  energy: number | null;
  grid_confidence: number | null;
  lyric_status: string | null;
  never: boolean;
  priority: boolean;
  match?: string | null;
  readiness: { status: string; reason: string };
};

export type LibraryPage = { songs: LibrarySong[]; total: number; next: string | null };

export type Jobs = {
  worker: { running: boolean; rendering_the_mix: boolean };
  mix: { queued: number; rendering: number; failed: number; none: number; ready: number };
  drafts_in_line: number;
  storage_full: boolean;
  analysis: { running: boolean; paused: boolean; asked_for: number; left: number };
  failed_seams: { from: string; to: string; why?: string }[];
  failed_songs: { id: number; title: string | null; artist: string | null }[];
  estimates: string;
};

export type Folders = {
  folders: { path: string; available: boolean; songs: number }[];
  watch_every: number;
};

/** Saving a mix to a file, as a job that outlives whatever started it. `seams_ready` is a real count of
 * the transitions in this job's snapshot. There's deliberately no percentage. */
export type ExportJobState = 'preparing' | 'encoding' | 'ready' | 'failed' | 'cancelling' | 'cancelled' | 'interrupted' | 'expired';

export type ExportJob = {
  id: string;
  state: ExportJobState;
  scope: 'current' | 'draft';
  draft: number | null;
  mix_name: string;
  /** Stable identity of the frozen song order and rendered transitions. Older saved jobs may omit it. */
  revision?: string;
  songs: { song_id: number; title: string; artist: string }[];
  seams: { key: string; from: string; to: string }[];
  seams_total: number;
  seams_ready: number;
  seconds_estimate: number;
  name: string;
  seconds: number | null;
  error: string | null;
  created_at: number;
  can_cancel: boolean;
  quiet_seconds: number;
};

/** What Selecta can say about a folder before reading it, from GET /api/folders/check. */
export type FolderCheck = {
  ok: boolean;
  kind: 'ok' | 'missing' | 'invalid' | 'not_a_folder' | 'no_access' | 'already_added' | 'inside_added' | 'empty' | 'no_audio';
  reason: string;
  path: string;
  audio_files: number | null;
};
