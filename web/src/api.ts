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
  locked: boolean;
  seam: { settings: SeamSettings; state: SeamState } | null;
};

export type MixData = { mix: MixItem[]; name: string; can_undo: boolean; undone?: string | null };

export type SeamOptions = {
  moves: { name: string; label: string; description: string; available: boolean; reason: string | null }[];
  exits: { bar: number; time: number; kind: string }[];
  entries: { bar: number; time: number; kind: string }[];
  lengths: number[];
  links: { phrase: string; line_a: string; line_b: string; score: number }[];
  tempo_gap: number;
  keys: string[];
};

export type Status = {
  counts: Record<string, number>;
  steering: { mix_language: string; target: string | null; target_label?: string | null };
  moves: Record<string, string>;
  analysis_running: boolean;
  analysing: number[];
  mix_rendering: boolean;
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
};

export type SongDetail = {
  id: number;
  artist: string;
  title: string;
  duration: number;
  bpm: number;
  key: string;
  peaks: number[];
  sections: { label: string; start: number; end: number }[];
  lines: { start: number; end: number; text: string }[];
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

export type LinkList = { links: Link[]; prepared: number; preparing: number };

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

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).detail ?? detail;
    } catch {
      /* the status text will do */
    }
    throw new Error(detail);
  }
  return response.json();
}

export const get = <T,>(path: string) => send<T>(path);

export const post = <T,>(path: string, body?: unknown) =>
  send<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

export const del = <T,>(path: string) => send<T>(path, { method: 'DELETE' });
