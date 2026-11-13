import type { Api, SessionState, SessionView } from './usePlaybackDevice';

// Typed calls to the zone playback routes (ADR-0443). A business workspace has one playback
// session per zone; these mirror the personal /playback routes with the zone in the path. Every
// call names the organisation's workspace (X-Workspace-ID) through the injected `Api`, the same
// helper the rest of the cloud app uses. `fetchApi` builds such an `Api` over any fetch, so tests
// (and pages outside CloudApp) can inject one.

export type ZoneSessionState = SessionState & {
  zone_id: string;
  /** Zone volume, 0 to 100, already within the zone's cap. The speaker applies it as gain. */
  volume: number;
  /** Set while a stand-in speaker (a staff phone or the standby) should hand back. */
  hand_back_to_device_id: string | null;
};
export type ZoneSessionView = Omit<SessionView, 'session'> & { session: ZoneSessionState | null };
export type ZoneSummary = {
  zone_id: string;
  zone_name: string;
  venue_id: string;
  venue_name: string;
  status: string;
  session: ZoneSessionState | null;
  speaker_name: string | null;
  speaker_is_person: boolean;
};
export type HeartbeatBody = { device_id: string; song_index: number; offset_ms: number; state: 'playing' | 'paused'; seq: number };
export type HeartbeatAnswer = { outcome: string; session: ZoneSessionState; server_time: number };
export type TakeOverAnswer = { session: ZoneSessionState; previous_device: { name: string } | null; server_time: number };
export type ReconnectAnswer = { action: string; session: ZoneSessionState | null; message: string | null };
export type CommandBody = { device_id: string; command: string; args?: Record<string, unknown>; based_on_seq: number; idempotency_key: string };

/** Refusal codes the zone routes answer with. */
export type ZoneErrorCode =
  | 'device_in_other_zone' | 'person_speaker_off' | 'zone_paused' | 'stale_command' | 'confirm_needed'
  | 'not_found' | string;

/** A refused zone call. `code` is the server's code (404 with none becomes `not_found`);
 * `zoneId` is the other zone for `device_in_other_zone`. */
export class ZonePlaybackError extends Error {
  constructor(message: string, readonly status: number, readonly code: ZoneErrorCode | undefined, readonly zoneId: string | null = null, readonly payload?: unknown) {
    super(message);
    this.name = 'ZonePlaybackError';
  }
}

const enc = encodeURIComponent;
export const ZONE_ROUTES = {
  list: '/zones/playback',
  holding: (deviceId: string) => `/zones/holding?device_id=${enc(deviceId)}`,
  session: (zoneId: string, deviceId: string) => `/zones/${enc(zoneId)}/playback/session?device_id=${enc(deviceId)}`,
  action: (zoneId: string, name: 'heartbeat' | 'take-over' | 'reconnect' | 'commands' | 'hand-back') => `/zones/${enc(zoneId)}/playback/${name}`,
} as const;

/** The refusal's detail object, wherever the server put it (FastAPI nests it under `detail`). */
function detailOf(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const detail = (payload as { detail?: unknown }).detail;
  if (detail && typeof detail === 'object') return detail as Record<string, unknown>;
  return payload as Record<string, unknown>;
}

/** Turn whatever the Api threw into a ZonePlaybackError, keeping its status, code and message. */
export function toZoneError(problem: unknown): ZonePlaybackError {
  if (problem instanceof ZonePlaybackError) return problem;
  const raw = (problem ?? {}) as { message?: string; status?: number; code?: string; payload?: unknown };
  const detail = detailOf(raw.payload);
  const status = typeof raw.status === 'number' ? raw.status : 0;
  const code = raw.code ?? (typeof detail.code === 'string' ? detail.code : undefined) ?? (status === 404 ? 'not_found' : undefined);
  const zoneId = typeof detail.zone_id === 'string' ? detail.zone_id : null;
  const message = typeof detail.message === 'string' ? detail.message : (raw.message || `Request failed (${status}).`);
  return new ZonePlaybackError(message, status, code, zoneId, raw.payload);
}

/** An `Api` over a given fetch: JSON in and out, X-Workspace-ID set, refusals thrown with
 * `status`, `code` and `payload` like CloudApp's helper. */
export function fetchApi(fetchImpl: typeof fetch, base = '/api', headers: Record<string, string> = {}): Api {
  return async <T,>(path: string, init: RequestInit = {}, workspaceId?: string): Promise<T> => {
    const sent = new Headers(init.headers);
    for (const [name, value] of Object.entries(headers)) sent.set(name, value);
    if (workspaceId) sent.set('X-Workspace-ID', workspaceId);
    if (init.body && !sent.has('Content-Type')) sent.set('Content-Type', 'application/json');
    const response = await fetchImpl(`${base}${path}`, { ...init, headers: sent });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const detail = detailOf(payload);
      const code = typeof detail.code === 'string' ? detail.code : undefined;
      const message = typeof detail.message === 'string' ? detail.message : `Request failed (${response.status}).`;
      throw new ZonePlaybackError(message, response.status, code ?? (response.status === 404 ? 'not_found' : undefined), typeof detail.zone_id === 'string' ? detail.zone_id : null, payload);
    }
    return payload as T;
  };
}

export type ZonePlayback = ReturnType<typeof zonePlayback>;

/** The zone playback calls for one organisation workspace. Every refusal is a ZonePlaybackError. */
export function zonePlayback(api: Api, workspaceId: string) {
  const call = async <T,>(path: string, body?: unknown): Promise<T> => {
    const init: RequestInit = body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) };
    try { return await api<T>(path, init, workspaceId); } catch (problem) { throw toZoneError(problem); }
  };
  return {
    zones: () => call<{ zones: ZoneSummary[] }>(ZONE_ROUTES.list).then((answer) => answer.zones),
    /** The zone this device holds the lease of, or null. A phone holding one hands back before
     * it can switch to its personal workspace. */
    holdingZone: (deviceId: string) => call<{ zone_id: string | null }>(ZONE_ROUTES.holding(deviceId)).then((answer) => answer.zone_id),
    session: (zoneId: string, deviceId: string) => call<ZoneSessionView>(ZONE_ROUTES.session(zoneId, deviceId)),
    heartbeat: (zoneId: string, body: HeartbeatBody) => call<HeartbeatAnswer>(ZONE_ROUTES.action(zoneId, 'heartbeat'), body),
    /** Play here. Without `confirm`, a zone whose kiosk is playing answers `confirm_needed`. */
    takeOver: (zoneId: string, deviceId: string, opts: { startPlaying?: boolean; confirm?: boolean } = {}) =>
      call<TakeOverAnswer>(ZONE_ROUTES.action(zoneId, 'take-over'), { device_id: deviceId, start_playing: opts.startPlaying ?? true, confirm: opts.confirm ?? false }),
    reconnect: (zoneId: string, deviceId: string) => call<ReconnectAnswer>(ZONE_ROUTES.action(zoneId, 'reconnect'), { device_id: deviceId }),
    command: (zoneId: string, body: CommandBody) => call<unknown>(ZONE_ROUTES.action(zoneId, 'commands'), body),
    /** Zone volume, 0 to 100; the server clamps it to the zone's cap. */
    setVolume: (zoneId: string, deviceId: string, volume: number, basedOnSeq: number, idempotencyKey: string) =>
      call<unknown>(ZONE_ROUTES.action(zoneId, 'commands'), {
        device_id: deviceId, command: 'set_volume', args: { volume: Math.max(0, Math.min(100, Math.round(volume))) }, based_on_seq: basedOnSeq, idempotency_key: idempotencyKey,
      }),
    /** "Hand back to Bar player": give the lease back with where the music is now. */
    handBack: (zoneId: string, deviceId: string, songIndex: number, offsetMs: number) =>
      call<unknown>(ZONE_ROUTES.action(zoneId, 'hand-back'), { device_id: deviceId, song_index: songIndex, offset_ms: offsetMs }),
  };
}
