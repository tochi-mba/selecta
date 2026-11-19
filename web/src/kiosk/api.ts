// The kiosk's calls to SelectaDJ (ADR-0445 routes, and the ADR-0446 horizon and resync). The
// kiosk token and the pairing secret are HttpOnly cookies on /api/kiosk, so the page never sees
// them. Every answer from /api/kiosk/view goes through the allowlist in view.ts before anything
// else reads it. Heartbeats are signed with the device key over the nonce from the last answer.

import type { Manifest } from '../business/offline/zoneCache';
import { KioskView, sanitiseKioskView } from './view';

export const KIOSK_ROUTES = {
  pairings: '/api/kiosk/pairings',
  pairingStatus: '/api/kiosk/pairings/status',
  view: '/api/kiosk/view',
  heartbeat: '/api/kiosk/heartbeat',
  health: '/api/kiosk/health',
  horizon: '/api/kiosk/horizon',
  segmentUrl: '/api/kiosk/segment-url',
  resync: '/api/kiosk/resync',
  // Rooms for Business on the zone's player (ADR-0451)
  nextRequest: '/api/kiosk/requests/next',
  requestPlayed: (id: string) => `/api/kiosk/requests/${encodeURIComponent(id)}/played`,
  screenCode: '/api/kiosk/screen-code',
  // Not named by ADR-0445: checks the venue's staff PIN for the hidden panel.
  pin: '/api/kiosk/pin',
} as const;

export type Pairing = { code: string; expiresAt: number | null; serverTime: number | null };
export type PairingStatus = {
  state: 'waiting' | 'expired' | 'paired' | 'collected' | 'revoked' | 'unknown';
  deviceId: string | null;
  nonce: string | null;
  serverTime: number | null;
  /** The offline-bundle keys to pin, handed over once with the token. */
  permitKeys: string[];
};

export type SessionWire = {
  song_index: number;
  offset_ms: number;
  anchor_at: number | null;
  state: 'playing' | 'paused' | 'stopped';
  active_device_id: string | null;
  fence: number;
  volume?: number | null;
};

export type HeartbeatAnswer = {
  outcome: string;
  serverTime: number;
  session: SessionWire | null;
  latest: { version: string; urgent: boolean } | null;
  role: string | null;
};

/** Every field ADR-0445 lists for the health report. */
export type HealthReport = {
  kiosk_version: string;
  browser: string;
  audio_context: 'running' | 'suspended' | 'closed' | 'interrupted' | 'unknown';
  autoplay_allowed: boolean;
  wake_lock: boolean;
  output_dbfs: number | null;
  playing_state: 'playing' | 'paused' | 'stopped' | 'buffering' | 'closed' | 'error';
  hours_ahead: number;
  storage_used_bytes: number | null;
  storage_available_bytes: number | null;
  network: 'online' | 'offline';
  clock_offset_ms: number;
  restarted_at: number | null;
  restart_reason: string | null;
  battery: { level: number; charging: boolean } | null;
  persisted?: boolean;
};

/** A guest request whose turn has come, already put into the zone's programme by the server. */
export type NextRequest = { id: string; local_song_id: number | null; title: string; artist: string; queued: boolean };
export type ScreenCode = { on: boolean; code: string | null; changes_at: number | null };

export type HorizonManifest = Manifest & { issued_at?: number; valid_until?: number; server_time?: number; state?: string };

/** A failed call; `status` 0 means the server couldn't be reached. Never shown to customers. */
export class KioskCallError extends Error {
  constructor(readonly status: number, readonly code: string | null = null, readonly detail: Record<string, unknown> = {}) {
    super(`kiosk call failed (${status}${code ? ` ${code}` : ''})`);
  }
}

/** The player was unpaired, replaced, or its sign-in no longer works: show pairing again. */
export const isRevoked = (error: unknown) =>
  error instanceof KioskCallError && error.status === 401 && error.code !== 'kiosk_key_mismatch';

export type KioskApiOptions = {
  fetch?: typeof fetch;
  origin?: string;
  sign?: (nonce: string) => Promise<string>;
  version?: string;
};

export type KioskApi = ReturnType<typeof kioskApi>;

const origin = () => ((import.meta.env?.VITE_SELECTA_API_ORIGIN as string | undefined) ?? '').replace(/\/$/, '');
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function detailOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const detail = (body as { detail?: unknown }).detail;
  return detail && typeof detail === 'object' ? detail as Record<string, unknown> : body as Record<string, unknown>;
}

export function kioskApi(options: KioskApiOptions = {}) {
  const base = options.origin ?? origin();
  let nonce: string | null = null;

  async function send(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const go = options.fetch ?? fetch;
    let response: Response;
    try {
      response = await go(`${base}${path}`, {
        ...init,
        credentials: 'include',
        headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      });
    } catch {
      throw new KioskCallError(0);
    }
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = detailOf(body);
      throw new KioskCallError(response.status, str(detail.code), detail);
    }
    return (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  }
  const post = (path: string, body: unknown) => send(path, { method: 'POST', body: JSON.stringify(body) });

  return {
    setNonce(value: string | null) { nonce = value; },
    nonce: () => nonce,
    /** A new six-character pairing code (single use, 10 minutes). */
    async startPairing(device: { public_key: string; machine_id: string; device_name?: string }): Promise<Pairing> {
      const body = await post(KIOSK_ROUTES.pairings, device);
      const code = (str(body.pairing_code) ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 6);
      return { code, expiresAt: num(body.expires_at), serverTime: num(body.server_time) };
    },
    async pairingStatus(): Promise<PairingStatus> {
      const body = await send(KIOSK_ROUTES.pairingStatus);
      const state = str(body.state) as PairingStatus['state'] | null;
      if (str(body.nonce)) nonce = str(body.nonce);
      const keys = Array.isArray(body.permit_keys) ? body.permit_keys.filter((k): k is string => typeof k === 'string') : [];
      return { state: state ?? 'unknown', deviceId: str(body.device_id), nonce, serverTime: num(body.server_time), permitKeys: keys };
    },
    /** The zone's view, already through the allowlist. */
    async view(): Promise<KioskView> {
      return sanitiseKioskView(await send(KIOSK_ROUTES.view));
    },
    /** One signed check-in. A stale nonce (a lost answer) is refreshed and retried once. */
    async heartbeat(position: { song_index: number; offset_ms: number; state: string; fence?: number | null }): Promise<HeartbeatAnswer> {
      if (!options.sign) throw new KioskCallError(401, 'kiosk_not_paired');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        // After a restart the page has no nonce: the signed placeholder proves the key, and the
        // server answers with the current nonce to sign (a stale nonce, never a key mismatch).
        const current = nonce ?? 'restart';
        try {
          const body = await post(KIOSK_ROUTES.heartbeat, {
            ...position,
            fence: position.fence ?? undefined,
            nonce: current,
            signature: await options.sign(current),
            kiosk_version: options.version ?? '',
          });
          nonce = str(body.nonce) ?? nonce;
          const latest = body.latest as { version?: unknown; urgent?: unknown } | undefined;
          return {
            outcome: str(body.outcome) ?? 'refused',
            serverTime: num(body.server_time) ?? Date.now() / 1000,
            session: (body.session as SessionWire | null) ?? null,
            latest: latest && str(latest.version) ? { version: String(latest.version), urgent: latest.urgent === true } : null,
            role: str(body.role),
          };
        } catch (error) {
          if (attempt === 0 && error instanceof KioskCallError && error.code === 'kiosk_nonce_stale' && str(error.detail.nonce)) {
            nonce = str(error.detail.nonce);
            continue;
          }
          throw error;
        }
      }
      throw new KioskCallError(409, 'kiosk_nonce_stale');
    },
    async health(report: HealthReport): Promise<void> {
      await post(KIOSK_ROUTES.health, report);
    },
    async horizon(quotaBytes?: number | null): Promise<HorizonManifest> {
      const query = quotaBytes ? `?quota_bytes=${Math.floor(quotaBytes)}` : '';
      return await send(`${KIOSK_ROUTES.horizon}${query}`) as unknown as HorizonManifest;
    },
    /** A fresh short-lived URL for one horizon file, asked for just before downloading it. */
    async segmentUrl(key: string): Promise<string> {
      const body = await post(KIOSK_ROUTES.segmentUrl, { key });
      const url = str(body.url);
      if (!url) throw new KioskCallError(503, 'storage_unavailable');
      return url;
    },
    async resync(entries: unknown[]): Promise<{ inserted: number; duplicates: number }> {
      const body = await post(KIOSK_ROUTES.resync, { entries });
      return { inserted: num(body.inserted) ?? 0, duplicates: num(body.duplicates) ?? 0 };
    },
    async nextRequest(): Promise<NextRequest | null> {
      const body = await send(KIOSK_ROUTES.nextRequest);
      const raw = body.request as Record<string, unknown> | null | undefined;
      if (!raw || !str(raw.id)) return null;
      return { id: String(raw.id), local_song_id: num(raw.local_song_id), title: str(raw.title) ?? '', artist: str(raw.artist) ?? '', queued: raw.queued === true };
    },
    async requestPlayed(id: string): Promise<void> {
      await post(KIOSK_ROUTES.requestPlayed(id), {});
    },
    async screenCode(): Promise<ScreenCode> {
      const body = await send(KIOSK_ROUTES.screenCode);
      return { on: body.on === true, code: str(body.code), changes_at: num(body.changes_at) };
    },
    /** True when the staff PIN matches. The PIN is never stored on the page. */
    async checkPin(pin: string): Promise<boolean> {
      try {
        const body = await post(KIOSK_ROUTES.pin, { pin });
        return body.ok === true;
      } catch {
        return false;
      }
    },
  };
}

/** "Chrome 131", "Edge 131", "Firefox 133", "Safari 18", or the first product token. */
export function browserName(agent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const tried: [RegExp, string][] = [[/Edg\/(\d+)/, 'Edge'], [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'], [/Firefox\/(\d+)/, 'Firefox'], [/Version\/(\d+).*Safari/, 'Safari']];
  for (const [pattern, name] of tried) {
    const found = pattern.exec(agent);
    if (found) return `${name} ${found[1]}`;
  }
  return agent.split(' ')[0] || 'unknown';
}
