import { accountFlagOn, type FlagId } from '../flags';
import { userLocale } from '../ui/format';
// What the Cloud site knows about the API: the shapes it answers with, how a refusal is read,
// and the few formatting helpers every Cloud page shares.

export type Allowance = { used: number; limit: number | null; resets_at: number; period: 'day' | 'month' };
export type LucyTurns = Allowance & { fair_use: boolean; classes: (Allowance & { model_class: string; purpose: string })[] };
export type Usage = {
  storage: { used_bytes: number; committed_bytes: number; reserved_bytes: number; limit_bytes: number; over_by_bytes: number; state: string; over_since: number | null };
  analysis_today: Allowance;
  exports_month: Allowance & { retention_days: number; blocked: boolean };
  lucy_turns_month: LucyTurns;
  /** Songs in the library against the plan's soft cap: mentioned calmly, never a refusal. */
  library?: { songs: number; soft_cap: number };
};
/** The billing moment the customer should hear about (billing/standing.py), or null for none.
 * `at` is epoch seconds; `key` changes whenever the event does, so a dismissal is per event. */
export type BillingStanding = {
  state: 'payment_failed' | 'action_required' | 'cancelling' | 'ended_payment_failed';
  plan_label: string;
  at: number | null;
  key: string;
  can_manage?: boolean;
};
export type Account = {
  user: { id: string; email: string; email_verified: boolean; suspended?: boolean; staff?: boolean; timezone?: string };
  workspace: { id: string; name: string; role: string };
  entitlement: { plan: string; plan_label?: string; plan_version: number; snapshot_version?: number | null; storage_limit_bytes: number; storage_used_bytes: number; storage_state: string };
  usage?: Usage;
  /** `checkout_available` false: this site cannot start a payment (no Stripe key or prices). Left
   * out by an older server, which means it can. */
  billing?: { consent_version: string; checkout_available?: boolean; standing?: BillingStanding | null };
  lucy?: { tier: string };
  /** One server-decided answer for the two independent Cloud grants (BF-0455-03). */
  experience?: { local_first: boolean; hosted: boolean };
  features: Record<string, boolean>;
  feature_locks: Record<string, string>;
};

export type CloudModeCopy = {
  heading: string;
  privacy: string;
  source: 'device' | 'hosted' | 'both' | 'none';
};

/** Member-facing words for the decided Cloud experience (BF-0455-06).
 *
 * Keep this keyed by the account snapshot rather than scattering flag checks and jargon through
 * pages. Hosted mode is intentionally described as available, never legacy or deprecated.
 */
export function cloudModeCopy(account: Pick<Account, 'experience'> | null): CloudModeCopy {
  const local = account?.experience?.local_first === true;
  const hosted = account?.experience?.hosted === true;
  if (local && hosted) return {
    heading: 'Use music on this device or from your Cloud library',
    privacy: 'Music you connect locally stays on this device. Your hosted library remains available in SelectaDJ Cloud.',
    source: 'both',
  };
  if (local) return {
    heading: 'Use music on this device',
    privacy: 'Your music stays on this device. SelectaDJ Cloud keeps only the details needed for your library and mixes.',
    source: 'device',
  };
  if (hosted) return {
    heading: 'Use your SelectaDJ Cloud library',
    privacy: 'Your hosted music remains available in SelectaDJ Cloud.',
    source: 'hosted',
  };
  return {
    heading: 'Connect music to begin',
    privacy: 'SelectaDJ has not been given access to music for this account.',
    source: 'none',
  };
}
export type Asset = { id: string; name: string; size: number; sha256: string | null; format: string | null; duration_seconds: number | null; sample_rate: number | null; channels: number | null; created_at: number };
export type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
export type Page = 'home' | 'listen' | 'library' | 'uploads' | 'billing' | 'settings';

/** The plan that unlocks a feature this account can see only as a teaser, or undefined. */
export function lockedTo(account: Pick<Account, 'feature_locks'> | null, flag: string): string | undefined {
  return account?.feature_locks[flag] || undefined;
}

/** The flag a page needs, if any: with it off the page is gone, from the menu and the address. */
// Reading an existing library is independent from the hosted-media write grant (ADR-0456).
// Revoking uploads must never make somebody's stored music disappear.
const PAGE_FLAGS: Partial<Record<Page, FlagId>> = {
  library: 'cloud.stored_media',
  uploads: 'cloud.uploads',
};

export function pageShown(account: Pick<Account, 'features'> | null, page: Page) {
  const flag = PAGE_FLAGS[page];
  // the server decides per account, in `/api/account` (again after each `flags.changed`); off
  // means gone: no page, button or word for it (ADR-0414, ADR-0390)
  return !flag || accountFlagOn(flag, account?.features ?? null);
}

export const apiOrigin =(import.meta.env.VITE_SELECTA_API_ORIGIN ?? '').replace(/\/$/, '');
export const OVER_QUOTA = 'over_quota_read_only';

export class CloudError extends Error {
  /** `payload` is the refusal's JSON body, for callers that read more than the message (a crate
   * refused because schedules use it carries the list of uses). */
  constructor(message: string, readonly status: number, readonly code?: string, readonly payload?: unknown) { super(message); }
}

export function idempotencyKey() {
  return crypto.randomUUID();
}

/** The request with an Idempotency-Key added when it is a write that has none (`on` is the
 * `cloud.idempotency` flag). A caller that sets its own key keeps it. */
export function withIdempotencyKey(init: RequestInit | undefined, on: boolean): RequestInit | undefined {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (!on || method === 'GET' || method === 'HEAD') return init;
  const headers = new Headers(init?.headers);
  if (headers.has('Idempotency-Key')) return init;
  headers.set('Idempotency-Key', idempotencyKey());
  return { ...init, headers };
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

/** When an allowance resets, in the listener's own language: "Resets 11 Nov" (or "Dec 1"), or with the time for
 * a daily one. `timeZone` is the account's, so the date matches the server's period. */
export function resetWords(epochSeconds: number, period: 'day' | 'month', timeZone?: string) {
  const when = new Date(epochSeconds * 1000);
  const options: Intl.DateTimeFormatOptions = period === 'day'
    ? { hour: 'numeric', minute: '2-digit', weekday: 'short' }
    : { day: 'numeric', month: 'short' };
  try {
    return `Resets ${when.toLocaleString(userLocale(), { ...options, timeZone })}`;
  } catch {
    return `Resets ${when.toLocaleString(userLocale(), options)}`;
  }
}

export function planName(account: Account) {
  const id = account.entitlement.plan;
  return account.entitlement.plan_label ?? `${id[0]?.toUpperCase() ?? ''}${id.slice(1)}`;
}

/** Whether this account holds hosted storage at all (ADR-0464, BF-0456-06): the hosted media
 * grant, or bytes already stored. Browser-first accounts have none, so no storage amount, meter
 * or quota warning is ever shown to them. */
export function holdsHostedStorage(account: Account | null): boolean {
  if (!account) return false;
  const mode = (account.usage as (Account['usage'] & { storage_mode?: string }) | undefined)?.storage_mode;
  if (mode) return mode !== 'none';
  // The server's own rule (usage/meters.py storage_mode): the grant, or bytes already stored.
  return account.experience?.hosted !== false || account.entitlement.storage_used_bytes > 0;
}

export function isOverQuota(account: Account | null) {
  if (!account || !holdsHostedStorage(account)) return false;
  return (account.usage?.storage.state ?? account.entitlement.storage_state) === OVER_QUOTA;
}

export function overBy(account: Account) {
  const storage = account.usage?.storage;
  if (storage) return storage.over_by_bytes;
  return Math.max(0, account.entitlement.storage_used_bytes - account.entitlement.storage_limit_bytes);
}
