// Typed calls for the ADR-0450 content tools: each zone's pool, overrides, the bulk editor with
// undo, the CSV import, artist variants, clean edits and the "Worth checking" list. Every path is
// a route the server registers (tests/test_business_client_routes.py reads this file).

import type { Api } from '../../cloud/api';

export type Explicit = 'explicit' | 'clean' | 'unknown';
export type PoolBlock = { daypart_id: string | null; label: string; songs: number; hours: number; unknown: number; relaxed: string[]; messages: string[] };
export type ZoneOverride = { id: string; kind: 'song' | 'artist'; value: string; reason: string | null; ends_at: number };
export type ZonePool = { zone_id: string; version: number; library: number; unanalysed: number; blocks: PoolBlock[]; overrides: ZoneOverride[] };
export type Selection = { explicit: Explicit; query?: string | null; unknown_only?: boolean; artist?: string | null; crate_id?: string | null; song_ids?: string[] | null };
export type BulkPreview = { count: number; changing: number; explicit: Explicit; summary: string; songs: { id: string; title: string; artist: string }[] };
export type BulkApplied = { batch_id: string; count: number; version: number; summary: string };
export type CsvRow = { line: string; isrc?: string; artist?: string; title?: string; explicit?: string; why?: string; by?: string };
export type CsvMatch = { matched: CsvRow[]; ambiguous: CsvRow[]; unmatched: CsvRow[]; invalid: CsvRow[]; counts: Record<'matched' | 'ambiguous' | 'unmatched' | 'invalid', number> };
export type Hint = { song_id: string; title: string; artist: string; explicit: Explicit; words?: string[]; why?: string };
export type WorthChecking = { worth_checking: Hint[]; not_checked: Hint[]; checked: number; library: number };

const enc = encodeURIComponent;
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const CONTENT_ROUTES = {
  pool: (zone: string) => `/business/zones/${enc(zone)}/content/pool`,
  overrides: (zone: string) => `/business/zones/${enc(zone)}/content/overrides`,
  override: (zone: string, id: string) => `/business/zones/${enc(zone)}/content/overrides/${enc(id)}`,
  variants: (name: string) => `/business/content/artist-variants?name=${enc(name)}`,
  cleanLink: (song: string) => `/business/content/songs/${enc(song)}/clean-link`,
  songFlag: (song: string) => `/business/content/songs/${enc(song)}/explicit`,
  bulkPreview: '/business/content/bulk/preview',
  bulkApply: '/business/content/bulk/apply',
  bulkUndo: (batch: string) => `/business/content/bulk/${enc(batch)}/undo`,
  importPreview: '/business/content/import/preview',
  importApply: '/business/content/import/apply',
  worthChecking: '/business/content/worth-checking',
} as const;

/** The content tools for one organisation workspace. */
export function contentClient(api: Api, workspaceId: string) {
  const call = <T,>(path: string, init?: RequestInit) => api<T>(path, init, workspaceId);
  return {
    pool: (zone: string) => call<ZonePool>(CONTENT_ROUTES.pool(zone)),
    addOverride: (zone: string, body: { kind: 'song' | 'artist'; value: string; label?: string; reason: string; minutes: number }) => call<{ id: string; ends_at: number }>(CONTENT_ROUTES.overrides(zone), post(body)),
    endOverride: (zone: string, id: string) => call<{ ended: string }>(CONTENT_ROUTES.override(zone, id), { method: 'DELETE' }),
    variants: async (name: string) => (await call<{ variants: string[] }>(CONTENT_ROUTES.variants(name))).variants,
    setCleanLink: (song: string, clean: string | null) => call<{ version: number }>(CONTENT_ROUTES.cleanLink(song), { method: 'PUT', body: JSON.stringify({ clean_song_id: clean }) }),
    setFlag: (song: string, explicit: Explicit) => call<{ version: number }>(CONTENT_ROUTES.songFlag(song), { method: 'PUT', body: JSON.stringify({ explicit }) }),
    bulkPreview: (selection: Selection) => call<BulkPreview>(CONTENT_ROUTES.bulkPreview, post(selection)),
    bulkApply: (selection: Selection) => call<BulkApplied>(CONTENT_ROUTES.bulkApply, post(selection)),
    bulkUndo: (batch: string) => call<{ restored: number }>(CONTENT_ROUTES.bulkUndo(batch), post({})),
    importPreview: (csv: string) => call<CsvMatch>(CONTENT_ROUTES.importPreview, post({ csv })),
    importApply: (csv: string) => call<{ batches: BulkApplied[]; count: number }>(CONTENT_ROUTES.importApply, post({ csv })),
    worthChecking: () => call<WorthChecking>(CONTENT_ROUTES.worthChecking),
  };
}

export type ContentClient = ReturnType<typeof contentClient>;

/** "Ends 21:30" style words for an override's end, in the viewer's own clock. */
export function endsWords(endsAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((endsAt - now) / 60));
  if (minutes < 60) return `Ends in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Ends in ${hours} h ${minutes % 60} min`;
}
