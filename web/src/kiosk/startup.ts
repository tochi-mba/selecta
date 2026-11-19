// What the kiosk does when the page loads (ADR-0445 "Power cuts and auto-start", ADR-0446
// "Clocks"). Pure, so the decision can be tested with a fake clock.
//
// - inside opening hours with trusted time: resume where the schedule says, with a 5 s fade-in,
//   and report `restarted_at`;
// - inside opening hours with autoplay blocked: Tap to start (and the manager is alerted);
// - closed: show Closed and wait;
// - time not trusted (no server contact since boot and an implausible clock): never start by
//   itself; Tap to start with "Time unknown", so a power return at 03:00 can't wake the street.

import type { ClockStatus } from '../business/offline/offlineClock';

export const FADE_IN_S = 5;
export const WARMING_LEAD_S = 45 * 60;

export type DayState = 'open' | 'warming' | 'closed';
export type Period = { opens_at: number; closes_at: number };

/** Mirrors `zone_state` in src/selecta/business/offline.py. */
export function dayStateAt(periods: readonly Period[] | undefined, now: number): { state: DayState; closeAt: number | null; opensAt: number | null } {
  let opensAt: number | null = null;
  for (const period of periods ?? []) {
    if (period.opens_at <= now && now < period.closes_at) return { state: 'open', closeAt: period.closes_at, opensAt: period.opens_at };
    if (period.opens_at - WARMING_LEAD_S <= now && now < period.opens_at) return { state: 'warming', closeAt: period.closes_at, opensAt: period.opens_at };
    if (period.opens_at > now && (opensAt === null || period.opens_at < opensAt)) opensAt = period.opens_at;
  }
  return { state: 'closed', closeAt: null, opensAt };
}

export type StartupInput = { paired: boolean; clock: ClockStatus; day: DayState; autoplayAllowed: boolean };
export type StartupAction =
  | { kind: 'pair' }
  | { kind: 'closed' }
  | { kind: 'resume'; fadeInS: number }
  | { kind: 'tap'; reason: 'autoplay' | 'time_unknown' };

export function startupAction(input: StartupInput): StartupAction {
  if (!input.paired) return { kind: 'pair' };
  if (input.clock === 'untrusted') return { kind: 'tap', reason: 'time_unknown' };
  if (input.day === 'closed') return { kind: 'closed' };
  if (!input.autoplayAllowed) return { kind: 'tap', reason: 'autoplay' };
  return { kind: 'resume', fadeInS: FADE_IN_S };
}

// The last page's mark, so a restart can say why it happened.
const SESSION_KEY = 'selectadj-kiosk-session';
export type RestartReason = 'first_start' | 'power_or_crash' | 'crash' | 'update' | 'staff_reload';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Why this page started. "running" left behind means the last page never hid cleanly. */
export function restartReason(store: StorageLike | null = storage()): RestartReason {
  let mark: string | null = null;
  try {
    mark = store?.getItem(SESSION_KEY) ?? null;
  } catch {
    mark = null;
  }
  if (mark === null) return 'first_start';
  if (mark === 'update' || mark === 'staff_reload') return mark;
  return mark === 'closed' ? 'power_or_crash' : 'crash';
}

/** "running" while up, "closed" on a clean hide, or why the page is about to reload. */
export function markSession(mark: 'running' | 'closed' | 'update' | 'staff_reload', store: StorageLike | null = storage()): void {
  try {
    store?.setItem(SESSION_KEY, mark);
  } catch {
    // private mode: the reason is unknown next time
  }
}
