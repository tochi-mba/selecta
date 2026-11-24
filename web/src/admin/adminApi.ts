import { relativeTime, userLocale } from '../ui/format';
// The admin console's side of the admin API: an admin session, then requests that carry it.
//
// The session id lives in memory only. Losing it (a reload) means entering the console again,
// which needs a fresh sign-in: that is the point of a one-hour staff session.

/** Where the API lives: the Cloud site's own origin unless the build names another. */
export const apiOrigin = (import.meta.env.VITE_SELECTA_API_ORIGIN ?? '').replace(/\/$/, '');

export type Reading = { value: number | null; as_of: number | null; age_s: number | null; state: 'fresh' | 'stale' | 'unknown' };
export type Metric = Reading & { name: string; labels: Record<string, string> };
export type Tier = 'safe' | 'careful' | 'dangerous' | 'delayed';
export type ActionSpec = { id: string; permission: string; tier: Tier; label: string; per_hour: number | null; reverse: string | null; confirm: string | null; reversible: boolean };
export type RoleInfo = { role: string; title: string; scope: string; expires_at?: number | null; purpose?: string; cannot?: string; issued_by?: string; reason?: string; since?: number };
export type Me = {
  user_id: string; email?: string; roles: RoleInfo[]; permissions: string[];
  session: { id: string; expires_at: number; mfa_at?: number };
  environment?: string; changes_until?: number | null; session_started?: number; can_write?: boolean;
  actions?: ActionSpec[]; role_matrix?: Record<string, { title: string; permissions: string[]; purpose?: string; cannot?: string }>;
  permission_info?: Record<string, string>;
  preferences?: Record<string, unknown>;
};
export type AdminFetch = <T>(path: string, init?: RequestInit) => Promise<T>;
export type TokenSource = () => Promise<string>;

export class AdminError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly detail?: Record<string, unknown>) { super(message); }
}

const MESSAGES: Record<string, string> = {
  admin_session_required: 'Enter the admin console first.',
  admin_session_ended: 'Your admin session has ended, or your roles changed. Enter the console again.',
  fresh_sign_in_required: 'Sign in again to enter the admin console: it needs a sign-in from the last five minutes.',
  staff_organization_required: 'This account is not a staff account.',
  step_up_required: 'This needs a sign-in from the last 5 minutes. Sign in again, then do it again.',
  forbidden: 'Your role does not allow this.',
  self_approval: 'Staff can’t do this to their own account or workspace, or approve their own action.',
  not_ready: 'This action is still waiting for its delay or an approval.',
  view_mode: 'The console is in view mode. Press Make changes first.',
  record_changed: 'This record changed. Review it again.',
  confirm_mismatch: 'Type exactly what the dialog asks for to confirm.',
  blast_limit: 'You reached this hour’s limit for this action. Every Owner has been told.',
  request_in_progress: 'That is still being done from your last press. Wait a moment.',
  last_owner: 'That would leave SelectaDJ with no Owner. Make another Owner first.',
  dry_run_required: 'Run the dry run first.',
};

/** Plain words for a refusal code (exported for tests and the help panel). */
export function refusalWords(code: string) { return MESSAGES[code]; }

async function send<T>(path: string, init: RequestInit, token: TokenSource, session?: string, origin = apiOrigin): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await token()}`);
  if (session) headers.set('X-Admin-Session', session);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${origin}/api${path}`, { ...init, headers });
  const type = response.headers.get('content-type') ?? '';
  const payload = type.includes('json') ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? (payload as { detail: unknown }).detail : payload;
    const record = detail && typeof detail === 'object' ? detail as Record<string, unknown> : {};
    const code = typeof record.code === 'string' ? record.code : undefined;
    const message = (code && MESSAGES[code]) || (typeof record.message === 'string' ? record.message : `The server refused this (${response.status}).`);
    throw new AdminError(message, response.status, code, record);
  }
  return payload as T;
}

export async function startAdminSession(token: TokenSource, origin = apiOrigin) {
  return send<{ id: string; expires_at: number }>('/admin/session', { method: 'POST' }, token, undefined, origin);
}

export function adminFetch(token: TokenSource, session: string, origin = apiOrigin): AdminFetch {
  return <T,>(path: string, init: RequestInit = {}) => send<T>(path, init, token, session, origin);
}

/** A fresh idempotency key: one per press, so a double press or a retry does one thing. */
export function pressKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function post(body: unknown, key?: string): RequestInit {
  return { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key ?? pressKey() } };
}

/** How old a number is, in the reader's language: "just now", "4 minutes ago", "2 hours ago". */
export function age(seconds: number | null) {
  if (seconds === null) return 'never measured';
  return relativeTime(seconds);
}

/** Decimal sizes as people read them: "18.4 GB", "820.0 MB". */
export function bytes(value: number) {
  const unit = value >= 1_000_000_000 ? 'GB' : 'MB';
  return `${(value / (unit === 'GB' ? 1_000_000_000 : 1_000_000)).toFixed(1)} ${unit}`;
}

export function when(epoch: number | null | undefined) {
  if (!epoch) return '';
  return new Date(epoch * 1000).toLocaleString(userLocale());
}

/** "3 minutes ago" or "in 12 minutes" for an epoch time. */
export function since(epoch: number | null | undefined, now = Date.now() / 1000) {
  if (!epoch) return '';
  const delta = now - epoch;
  if (delta >= 0) return relativeTime(delta);
  const ahead = -delta;
  if (ahead < 60) return 'in under a minute';
  if (ahead < 3600) return `in ${Math.round(ahead / 60)} min`;
  if (ahead < 86_400) return `in ${Math.round(ahead / 3600)} h`;
  return `in ${Math.round(ahead / 86_400)} days`;
}

export function money(minor: number, currency: string) {
  try { return new Intl.NumberFormat(userLocale(), { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100); }
  catch { return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`; }
}
