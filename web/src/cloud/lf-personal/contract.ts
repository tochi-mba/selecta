import type { Api, Account } from '../api';

/**
 * LF-0476 browser boundary. This is a PROPOSED v1 metadata-only contract; the ADR
 * deliberately does not define REST endpoints yet. Keep it isolated here until
 * the local engine/control API owners provide the final paths and shapes.
 */
export const PERSONAL_FLAG = 'local_first.personal';
export const PERSONAL_SNAPSHOT_PATH = '/local-first/personal/snapshot';
export const LOCAL_ENGINE_URL = 'http://127.0.0.1:8733/';
export const ENGINE_INSTALL_GUIDE = 'https://github.com/tochi-mba/selecta/blob/main/README.md';

export function personalEnabled(account: Account | null): boolean {
  // Opt-in only. Unflagged accounts retain historical UI/API behaviour.
  return account?.features[PERSONAL_FLAG] === true;
}

export type MediaState =
  | 'ready' | 'needs_analysis' | 'candidate_match' | 'missing' | 'source_disconnected'
  | 'permission_required' | 'unsupported' | 'version_mismatch' | 'policy_blocked'
  | 'engine_offline' | 'device_unknown' | 'cache_invalid' | 'unknown';
export type Connectivity = 'online' | 'degraded' | 'offline' | 'unknown';
export type EngineState = 'ready' | 'starting' | 'stopped' | 'not_installed' | 'offline' | 'unknown';
export type SourceState = 'ready' | 'scanning' | 'source_disconnected' | 'permission_required' | 'needs_analysis' | 'unsupported' | 'unknown';

export type PersonalDevice = {
  id: string;
  name: string;
  role: 'engine' | 'controller';
  connectivity: Connectivity;
  engine: EngineState;
  lastVerifiedAt: string | null;
  checkedTracks: number | null;
  totalTracks: number | null;
  output: 'verified' | 'silent' | 'untested' | 'unknown';
  platform: string | null;
};

export type PersonalSource = {
  id: string;
  deviceId: string;
  label: string;
  state: SourceState;
  lastScannedAt: string | null;
  tracks: number | null;
  analysed: number | null;
  unsupported: number | null;
};

export type RecentRecipe = {
  id: string;
  title: string;
  revision: string;
  deviceId: string | null;
  verified: number | null;
  total: number | null;
  status: MediaState;
  lastVerifiedAt: string | null;
};

export type PersonalSnapshot = {
  version: 1;
  devices: PersonalDevice[];
  sources: PersonalSource[];
  recentRecipes: RecentRecipe[];
  playback: { deviceId: string; output: string; status: 'playing' | 'paused' | 'silent' | 'unknown' } | null;
  storage: { deviceId: string; usedBytes: number | null; freeBytes: number | null; cacheBytes: number | null }[];
};

/** Only explicitly approved public metadata is passed to React. Never echo arbitrary
 * server error details or `path` / `filename` / fingerprint-like fields. */
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value.slice(0, 500) : []; }
function id(value: unknown): string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : '';
}
export function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const result = value.trim().slice(0, 100);
  // Labels may be device-supplied. Refuse any path-like value before rendering remotely.
  return /[\\/]|file:|[\r\n\u0000-\u001f]/i.test(result) ? fallback : result;
}
function finiteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function time(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback;
}
const MEDIA: readonly MediaState[] = ['ready', 'needs_analysis', 'candidate_match', 'missing', 'source_disconnected', 'permission_required', 'unsupported', 'version_mismatch', 'policy_blocked', 'engine_offline', 'device_unknown', 'cache_invalid', 'unknown'];
const SOURCE: readonly SourceState[] = ['ready', 'scanning', 'source_disconnected', 'permission_required', 'needs_analysis', 'unsupported', 'unknown'];

export function parsePersonalSnapshot(value: unknown): PersonalSnapshot {
  const raw = object(value);
  if (raw.schema_version !== 1) throw new Error('The device service returned an unsupported snapshot version.');
  const devices = list(raw.devices).map((item) => {
    const d = object(item);
    const device: PersonalDevice = {
      id: id(d.id),
      name: safeLabel(d.display_name, 'Unnamed device'),
      role: oneOf(d.role, ['engine', 'controller'] as const, 'controller'),
      connectivity: oneOf(d.connectivity, ['online', 'degraded', 'offline', 'unknown'] as const, 'unknown'),
      engine: oneOf(d.engine_state, ['ready', 'starting', 'stopped', 'not_installed', 'offline', 'unknown'] as const, 'unknown'),
      lastVerifiedAt: time(d.last_verified_at),
      checkedTracks: finiteCount(d.verified_tracks),
      totalTracks: finiteCount(d.total_tracks),
      output: oneOf(d.output_state, ['verified', 'silent', 'untested', 'unknown'] as const, 'unknown'),
      platform: typeof d.platform === 'string' ? safeLabel(d.platform, 'Unknown') : null,
    };
    return device;
  }).filter((d) => d.id);
  const sourceIds = new Set<string>();
  const sources = list(raw.sources).map((item) => {
    const s = object(item);
    const source: PersonalSource = {
      id: id(s.id), deviceId: id(s.device_id),
      label: safeLabel(s.display_name, 'Local music source'),
      state: oneOf(s.state, SOURCE, 'unknown'),
      lastScannedAt: time(s.last_scanned_at),
      tracks: finiteCount(s.total_tracks),
      analysed: finiteCount(s.analysed_tracks),
      unsupported: finiteCount(s.unsupported_tracks),
    };
    return source;
  }).filter((s) => {
    if (!s.id || !s.deviceId || sourceIds.has(s.id)) return false;
    sourceIds.add(s.id);
    return devices.some((d) => d.id === s.deviceId);
  });
  const recentRecipes = list(raw.recent_recipes).map((item) => {
    const r = object(item);
    const recipe: RecentRecipe = {
      id: id(r.recipe_id), title: safeLabel(r.title, 'Untitled mix'),
      revision: id(r.revision_id),
      deviceId: id(r.target_device_id) || null,
      verified: finiteCount(r.verified_tracks),
      total: finiteCount(r.total_tracks),
      status: oneOf(r.status, MEDIA, 'unknown'),
      lastVerifiedAt: time(r.last_verified_at),
    };
    return recipe;
  }).filter((r) => r.id && r.revision).slice(0, 8);
  const p = object(raw.playback_owner);
  const playback = id(p.device_id) ? {
    deviceId: id(p.device_id),
    output: safeLabel(p.output_name, 'Selected output'),
    status: oneOf(p.status, ['playing', 'paused', 'silent', 'unknown'] as const, 'unknown'),
  } : null;
  const storage = list(raw.local_storage).map((item) => {
    const s = object(item);
    return { deviceId: id(s.device_id), usedBytes: finiteCount(s.used_bytes), freeBytes: finiteCount(s.free_bytes), cacheBytes: finiteCount(s.cache_bytes) };
  }).filter((s) => s.deviceId && devices.some((d) => d.id === s.deviceId));
  return { version: 1, devices, sources, recentRecipes, playback, storage };
}

export async function readPersonalSnapshot(api: Api, workspaceId: string, signal?: AbortSignal): Promise<PersonalSnapshot> {
  return parsePersonalSnapshot(await api<unknown>(PERSONAL_SNAPSHOT_PATH, { signal }, workspaceId));
}

/** A code is a short-lived pairing credential, not an audio or filesystem capability. */
export async function claimSpeaker(api: Api, workspaceId: string, code: string): Promise<void> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,24}$/.test(normalized)) throw new Error('Enter the pairing code shown by the speaker.');
  await api('/local-first/pairings/claim', { method: 'POST', body: JSON.stringify({ schema_version: 1, code: normalized }) }, workspaceId);
}

/** This requests a new scan; it never claims one happened or supplies any local path. */
export async function requestLocalScan(api: Api, workspaceId: string, deviceId: string): Promise<void> {
  const safeId = id(deviceId);
  if (!safeId) throw new Error('Select a known local engine.');
  await api(`/local-first/devices/${encodeURIComponent(safeId)}/scan`, { method: 'POST', body: JSON.stringify({ schema_version: 1 }) }, workspaceId);
}

export const MEDIA_EXPLANATIONS: Record<MediaState, string> = {
  ready: 'Verified on this device', needs_analysis: 'Local analysis is not complete',
  candidate_match: 'Possible alternate recording; review before using', missing: 'Recording not found here',
  source_disconnected: 'Reconnect the music drive', permission_required: 'Authorise the local music folder',
  unsupported: 'This device cannot decode or prepare the recording',
  version_mismatch: 'Different recording or master; review before using',
  policy_blocked: 'Not permitted on this device', engine_offline: 'Start or reconnect the local engine',
  device_unknown: 'No recent device check', cache_invalid: 'Local prepared audio needs rebuilding',
  unknown: 'Not verified',
};

export function recentCheck(iso: string | null, now = Date.now(), maxAgeMs = 120_000): boolean {
  if (!iso) return false;
  const age = now - Date.parse(iso);
  return Number.isFinite(age) && age >= -30_000 && age <= maxAgeMs;
}

export function verificationWords(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Never verified on this device';
  const when = new Date(iso);
  if (!Number.isFinite(when.valueOf())) return 'Verification time unknown';
  const text = when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return recentCheck(iso, now) ? `Verified ${text}` : `Last checked ${text}; results may be stale`;
}
