import type { Account } from '../cloud/api';
import type { LucyWindows } from '../cloud/lucyUsage';

const GB = 1_000_000_000;
const NOV_11 = Date.UTC(2026, 10, 11) / 1000;
const DEC_1 = Date.UTC(2026, 11, 1) / 1000;

/** An account answer as the Cloud API gives it, for component tests. */
/** Lucy's usage as the new read model sends it (ADR-0484), for tests that turn the new meter on. */
export const LUCY_WINDOWS: LucyWindows = {
  session: { left: 72, state: 'ok', resets_at: Date.UTC(2026, 10, 25, 16, 40) / 1000, back_words: '16:40', segments: 4, open: true },
  week: { left: 90, state: 'ok', resets_at: Date.UTC(2026, 10, 26, 9) / 1000, back_words: 'Thursday 09:00', segments: 5 },
  lighter: false,
  extra: null,
};

/** `lucyWindows` adds `usage.lucy_windows`; left out, the answer is the one a server that still
 * counts turns gives. */
export function cloudAccount(overrides: { plan?: string; used?: number; limit?: number; over?: boolean; lucyWindows?: LucyWindows } = {}): Account {
  const used = overrides.used ?? 4.2 * GB;
  const limit = overrides.limit ?? 10 * GB;
  const over = overrides.over ?? used > limit;
  const plan = overrides.plan ?? 'free';
  return {
    user: { id: 'user-1', email: 'listener@example.test', email_verified: true, timezone: 'UTC' },
    workspace: { id: 'ws-1', name: 'My music', role: 'owner' },
    entitlement: { plan, plan_label: plan[0].toUpperCase() + plan.slice(1), plan_version: 1, snapshot_version: plan === 'free' ? null : 2, storage_limit_bytes: limit, storage_used_bytes: used, storage_state: over ? 'over_quota_read_only' : 'ok' },
    usage: {
      storage: { used_bytes: used, committed_bytes: used, reserved_bytes: 0, limit_bytes: limit, over_by_bytes: Math.max(0, used - limit), state: over ? 'over_quota_read_only' : 'ok', over_since: over ? 1 : null },
      analysis_today: { used: 12, limit: 150, resets_at: NOV_11, period: 'day' },
      exports_month: { used: 1, limit: 3, resets_at: DEC_1, period: 'month', retention_days: 7, blocked: over },
      lucy_turns_month: { used: 9, limit: 40, fair_use: false, resets_at: DEC_1, period: 'month', classes: [{ model_class: 'haiku', purpose: 'everyday', used: 9, limit: 40, resets_at: DEC_1, period: 'month' }] },
      ...(overrides.lucyWindows ? { lucy_windows: overrides.lucyWindows } : {}),
    },
    billing: { consent_version: 'terms-2026-11' },
    lucy: { tier: 'Lucy Basic' },
    features: {},
    feature_locks: {},
  };
}
