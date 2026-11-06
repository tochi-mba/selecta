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
  tempo: [number, number] | null;
  moves: string;
  seconds: number;
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

  constructor(message: string, status: number, code = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type ProblemKind = 'offline' | 'missing' | 'conflict' | 'invalid' | 'storage' | 'server';

export function problemKind(error: unknown): ProblemKind {
  if (!(error instanceof ApiError)) return 'offline';
  if (error.code === 'storage_full') return 'storage';
  if (error.status === 404) return 'missing';
  if (error.status === 409) return 'conflict';
  if (error.status >= 400 && error.status < 500) return 'invalid';
  return 'server';
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    let detail = response.statusText;
    let code = '';
    try {
      const body = await response.json();
      detail = typeof body.detail === 'string' ? body.detail : detail;
      code = body.code ?? '';
    } catch {
      /* the status text will do */
    }
    throw new ApiError(detail, response.status, code);
  }
  return response.json();
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
