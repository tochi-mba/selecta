import { musicHomeOf, musicHomeStart, type MusicHome } from '../copy';
import { accountFlagOn, type FlagId } from '../flags';
import { userLocale } from '../ui/format';
import type { LucyWindows } from './lucyUsage';
// What the Cloud site knows about the API: the shapes it answers with, how a refusal is read,
// and the few formatting helpers every Cloud page shares.

export type Allowance = { used: number; limit: number | null; resets_at: number; period: 'day' | 'month' };
export type LucyTurns = Allowance & { fair_use: boolean; classes: (Allowance & { model_class: string; purpose: string })[] };
export type Usage = {
  storage: { used_bytes: number; committed_bytes: number; reserved_bytes: number; limit_bytes: number; over_by_bytes: number; state: string; over_since: number | null };
  analysis_today: Allowance;
  exports_month: Allowance & { retention_days: number; blocked: boolean };
  lucy_turns_month: LucyTurns;
  /** ADR-0484: Lucy's usage as a share left of the session and the week. Absent from a server
   * that still counts turns; the meters then stay as they were. */
  lucy_windows?: LucyWindows | null;
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

export type MusicHomeCopy = {
  heading: string;
  privacy: string;
  source: MusicHome | 'none';
};

/** Member-facing words for where the account's music lives (BF-0455-06), from copy.ts.
 *
 * Keyed by the account snapshot rather than scattering flag checks and jargon through pages. The
 * cloud library is described as available, never legacy or deprecated.
 */
export function musicHomeCopy(account: (Pick<Account, 'experience'> & Partial<Pick<Account, 'features'>>) | null): MusicHomeCopy {
  const source = musicHomeOf(account?.experience?.local_first === true, account?.experience?.hosted === true);
  // cloud.move_to_cloud (it needs the cloud library grant): uploads from this device are copies
  return { ...musicHomeStart(source, accountFlagOn('cloud.move_to_cloud', account?.features)), source };
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

/** The server's own plain words for a refusal, or `fallback`. Never a code, JSON or a stack. */
export function messageOf(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && 'message' in detail) return String((detail as { message: unknown }).message);
    // a bare code is never shown as words ("billing not permitted"): the caller's plain fallback is
  }
  return fallback;
}

/** Plain words for a refusal that carried none of its own, by its HTTP status. */
export function statusWords(status: number): string {
  if (status === 401) return 'Your sign-in has ended. Sign in again to carry on.';
  if (status === 403) return 'This account can’t do that.';
  if (status === 404) return 'That isn’t here any more.';
  if (status === 409) return 'That changed somewhere else. Reload and try again.';
  if (status === 413) return 'That is too large to send.';
  if (status === 429) return 'That’s a lot of requests at once. Wait a moment and try again.';
  // 503 is what Render's maintenance mode and a deploy that is not ready yet answer
  if (status === 503) return 'SelectaDJ is being updated and is back in a moment. Anything playing keeps playing.';
  if (status >= 500) return 'SelectaDJ’s service isn’t answering right now. Try again in a moment.';
  return 'That didn’t work. Try again, or contact support if it keeps happening.';
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
