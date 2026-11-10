// The admin console's side of the admin API: an admin session, then requests that carry it.
//
// The session id lives in memory only. Losing it (a reload) means entering the console again,
// which needs a fresh sign-in: that is the point of a one-hour staff session.

/** Where the API lives: the Cloud site's own origin unless the build names another. */
export const apiOrigin = (import.meta.env.VITE_SELECTA_API_ORIGIN ?? '').replace(/\/$/, '');

export type Reading = { value: number | null; as_of: number | null; age_s: number | null; state: 'fresh' | 'stale' | 'unknown' };
export type Metric = Reading & { name: string; labels: Record<string, string> };
export type Me = { user_id: string; roles: { role: string; title: string; scope: string }[]; permissions: string[]; session: { id: string; expires_at: number } };
export type AdminFetch = <T>(path: string, init?: RequestInit) => Promise<T>;
export type TokenSource = () => Promise<string>;

export class AdminError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly detail?: Record<string, unknown>) { super(message); }
}

const MESSAGES: Record<string, string> = {
  admin_session_required: 'Enter the admin console first.',
  admin_session_ended: 'Your admin session has ended. Enter the console again.',
  fresh_sign_in_required: 'Sign in again to enter the admin console: it needs a sign-in from the last five minutes.',
  staff_organization_required: 'This account is not a staff account.',
  step_up_required: 'Confirm MFA again to do this: sign in again, then enter the console.',
  forbidden: 'Your role does not allow this.',
  self_approval: 'Someone else has to approve this.',
  not_ready: 'This action is still waiting for its delay or an approval.',
};

async function send<T>(path: string, init: RequestInit, token: TokenSource, session?: string, origin = apiOrigin): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await token()}`);
  if (session) headers.set('X-Admin-Session', session);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${origin}/api${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? (payload as { detail: unknown }).detail : payload;
    const record = detail && typeof detail === 'object' ? detail as Record<string, unknown> : {};
    const code = typeof record.code === 'string' ? record.code : undefined;
    const message = (code && MESSAGES[code]) || (typeof record.message === 'string' ? record.message : `Request failed (${response.status}).`);
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

export function post(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

/** "12 s ago", "4 min ago", "2 h ago": how old a number is, in words. */
export function age(seconds: number | null) {
  if (seconds === null) return 'never measured';
  if (seconds < 60) return `${Math.round(seconds)} s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

/** Decimal sizes as people read them: "18.4 GB", "820.0 MB". */
export function bytes(value: number) {
  const unit = value >= 1_000_000_000 ? 'GB' : 'MB';
  return `${(value / (unit === 'GB' ? 1_000_000_000 : 1_000_000)).toFixed(1)} ${unit}`;
}

export function when(epoch: number | null | undefined) {
  if (!epoch) return '';
  return new Date(epoch * 1000).toLocaleString();
}
