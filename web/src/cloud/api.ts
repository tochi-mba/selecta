// What the Cloud site knows about the API: the shapes it answers with, how a refusal is read,
// and the few formatting helpers every Cloud page shares.

export type Allowance = { used: number; limit: number | null; resets_at: number; period: 'day' | 'month' };
export type LucyTurns = Allowance & { fair_use: boolean; classes: (Allowance & { model_class: string; purpose: string })[] };
export type Usage = {
  storage: { used_bytes: number; committed_bytes: number; reserved_bytes: number; limit_bytes: number; over_by_bytes: number; state: string; over_since: number | null };
  analysis_today: Allowance;
  exports_month: Allowance & { retention_days: number; blocked: boolean };
  lucy_turns_month: LucyTurns;
};
export type Account = {
  user: { id: string; email: string; email_verified: boolean; suspended?: boolean; staff?: boolean; timezone?: string };
  workspace: { id: string; name: string; role: string };
  entitlement: { plan: string; plan_label?: string; plan_version: number; snapshot_version?: number | null; storage_limit_bytes: number; storage_used_bytes: number; storage_state: string };
  usage?: Usage;
  billing?: { consent_version: string };
  lucy?: { tier: string };
  features: Record<string, boolean>;
  feature_locks: Record<string, string>;
};
export type Asset = { id: string; name: string; size: number; sha256: string | null; format: string | null; duration_seconds: number | null; sample_rate: number | null; channels: number | null; created_at: number };
export type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
export type Page = 'home' | 'listen' | 'library' | 'uploads' | 'billing' | 'settings';

export const apiOrigin = (import.meta.env.VITE_SELECTA_API_ORIGIN ?? '').replace(/\/$/, '');
export const OVER_QUOTA = 'over_quota_read_only';

export class CloudError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export function idempotencyKey() {
  return crypto.randomUUID();
}

export function messageOf(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && 'message' in detail) return String((detail as { message: unknown }).message);
    if (detail && typeof detail === 'object' && 'code' in detail) return String((detail as { code: unknown }).code).replaceAll('_', ' ');
  }
  return fallback;
}

/** Decimal sizes as people read them: "18.4 GB", "820.0 MB". */
export function bytes(value: number) {
  const unit = value >= 1_000_000_000 ? 'GB' : 'MB';
  return `${(value / (unit === 'GB' ? 1_000_000_000 : 1_000_000)).toFixed(1)} ${unit}`;
}

/** When an allowance resets, in the listener's own words: "Resets 11 Nov", or with the time for
 * a daily one. `timeZone` is the account's, so the date matches the server's period. */
export function resetWords(epochSeconds: number, period: 'day' | 'month', timeZone?: string) {
  const when = new Date(epochSeconds * 1000);
  const options: Intl.DateTimeFormatOptions = period === 'day'
    ? { hour: 'numeric', minute: '2-digit', weekday: 'short' }
    : { day: 'numeric', month: 'short' };
  try {
    return `Resets ${when.toLocaleString('en-GB', { ...options, timeZone })}`;
  } catch {
    return `Resets ${when.toLocaleString('en-GB', options)}`;
  }
}

export function planName(account: Account) {
  const id = account.entitlement.plan;
  return account.entitlement.plan_label ?? `${id[0]?.toUpperCase() ?? ''}${id.slice(1)}`;
}

export function isOverQuota(account: Account | null) {
  if (!account) return false;
  return (account.usage?.storage.state ?? account.entitlement.storage_state) === OVER_QUOTA;
}

export function overBy(account: Account) {
  const storage = account.usage?.storage;
  if (storage) return storage.over_by_bytes;
  return Math.max(0, account.entitlement.storage_used_bytes - account.entitlement.storage_limit_bytes);
}
