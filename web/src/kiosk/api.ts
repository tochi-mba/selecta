// The kiosk's calls to SelectaDJ (ADR-0445 routes). The kiosk token is an HttpOnly cookie on
// /api/kiosk, so the page never sees it; every answer from /api/kiosk/view goes through the
// allowlist in view.ts before anything else reads it.
//
// Signing heartbeats with the device key (ADR-0445) belongs to the player work (BZ-2/BZ-3);
// pass `sign` to add a signature over the server's nonce.

import { KioskView, sanitiseKioskView } from './view';

export const KIOSK_ROUTES = {
  pairings: '/api/kiosk/pairings',
  pairingStatus: '/api/kiosk/pairings/status',
  view: '/api/kiosk/view',
  heartbeat: '/api/kiosk/heartbeat',
  health: '/api/kiosk/health',
  // Assumed route (not named by ADR-0445): checks the venue's staff PIN for the hidden panel.
  pin: '/api/kiosk/pin',
} as const;

export type Pairing = { code: string; pairingId: string; expiresAt: number | null; deviceName: string | null };
export type PairingStatus = { paired: boolean; deviceId: string | null; nonce: string | null };

export type HealthReport = {
  kiosk_version: string;
  browser: string;
  state: string;
  saved_hours_ahead: number;
  audio_unlocked: boolean;
  wake_lock_held: boolean;
  network: 'online' | 'offline';
};

/** A failed call; `status` 0 means the server couldn't be reached. Never shown to customers. */
export class KioskCallError extends Error {
  constructor(readonly status: number) {
    super(`kiosk call failed (${status})`);
  }
}

export type KioskApiOptions = {
  fetch?: typeof fetch;
  origin?: string;
  sign?: (nonce: string) => Promise<string>;
};

export type KioskApi = ReturnType<typeof kioskApi>;

const origin = () => ((import.meta.env?.VITE_SELECTA_API_ORIGIN as string | undefined) ?? '').replace(/\/$/, '');

export function kioskApi(options: KioskApiOptions = {}) {
  const base = options.origin ?? origin();
  let nonce: string | null = null;

  async function send(path: string, init: RequestInit = {}): Promise<unknown> {
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
    if (!response.ok) throw new KioskCallError(response.status);
    return body;
  }
  const post = (path: string, body: unknown) => send(path, { method: 'POST', body: JSON.stringify(body) });
  const field = (body: unknown, ...names: string[]): unknown => {
    if (!body || typeof body !== 'object') return undefined;
    for (const name of names) {
      const value = (body as Record<string, unknown>)[name];
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

  return {
    /** A new six-character pairing code (single use, about 10 minutes). */
    async startPairing(extra: { machine_id?: string; public_key?: unknown } = {}): Promise<Pairing> {
      const body = await post(KIOSK_ROUTES.pairings, extra);
      const code = (str(field(body, 'pairing_code', 'code')) ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 6);
      const expires = field(body, 'expires_at');
      return {
        code,
        pairingId: str(field(body, 'pairing_id')) ?? '',
        // seconds or milliseconds since 1970; anything smaller than 1e12 is seconds
        expiresAt: typeof expires === 'number' ? (expires < 1e12 ? expires * 1000 : expires) : null,
        deviceName: str(field(body, 'device_name')),
      };
    },
    async pairingStatus(pairingId: string): Promise<PairingStatus> {
      const query = pairingId ? `?pairing_id=${encodeURIComponent(pairingId)}` : '';
      const body = await send(`${KIOSK_ROUTES.pairingStatus}${query}`);
      const paired = field(body, 'paired') === true || field(body, 'state', 'status') === 'paired';
      nonce = str(field(body, 'nonce')) ?? nonce;
      return { paired, deviceId: str(field(body, 'device_id')), nonce };
    },
    /** The zone's view, already through the allowlist. */
    async view(): Promise<KioskView> {
      return sanitiseKioskView(await send(KIOSK_ROUTES.view));
    },
    async heartbeat(facts: { playing: boolean; device_id?: string | null }): Promise<void> {
      const body: Record<string, unknown> = { playing: facts.playing, nonce };
      if (facts.device_id) body.device_id = facts.device_id;
      if (nonce && options.sign) body.signature = await options.sign(nonce);
      const answer = await post(KIOSK_ROUTES.heartbeat, body);
      nonce = str(field(answer, 'nonce')) ?? nonce;
    },
    async health(report: HealthReport): Promise<void> {
      await post(KIOSK_ROUTES.health, report);
    },
    /** True when the staff PIN matches. The PIN is never stored on the page. */
    async checkPin(pin: string): Promise<boolean> {
      try {
        const body = await post(KIOSK_ROUTES.pin, { pin });
        return field(body, 'ok') === true;
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
