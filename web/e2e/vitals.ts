/**
 * P0136 / SF-0235-02 responsiveness budgets: the arithmetic behind the lab readings, kept apart from
 * Playwright so it can be unit tested (web/e2e/vitals.test.ts). The observers that collect the raw
 * entries live in web/e2e/perf-probe.ts; the method and results are in
 * docs/adr/completion/performance.md.
 *
 * Definitions follow the published Web Vitals ones:
 * - INP: Event Timing entries are grouped by interactionId and each interaction counts once, at its
 *   longest entry. With fewer than 50 interactions INP is the slowest; with more, one slowest
 *   interaction is ignored per 50 (the 98th percentile rule), so a single outlier in a long session
 *   does not stand for the whole page.
 * - CLS: layout shifts without recent input are grouped into session windows (a gap under 1 s, a
 *   window at most 5 s long); CLS is the largest window's total.
 *
 * These are LAB numbers from one machine and one run. A local app has no field data (no real-user
 * monitoring), so nothing here is a field p75; the report says so in its `kind` field.
 */

export type EventEntry = { id: number; duration: number; name?: string; target?: string };
export type ShiftEntry = { start: number; value: number };

/** The reference targets (web.dev "good"), used as lab budgets. */
export const BUDGETS = { inpMs: 200, cls: 0.1, lcpMs: 2500 } as const;

/** The label every lab report carries, so it can never be read as a field percentile. */
export const LAB_KIND = 'lab: one machine, one synthetic run; not field (real-user) data';

/** Interaction to Next Paint from Event Timing entries (only those with an interactionId). */
export function inpOf(entries: EventEntry[]): { inpMs: number; interactions: number; worst: EventEntry | null } {
  const byInteraction = new Map<number, EventEntry>();
  for (const entry of entries) {
    if (!entry.id) continue;
    const known = byInteraction.get(entry.id);
    if (!known || entry.duration > known.duration) byInteraction.set(entry.id, entry);
  }
  const slowestFirst = [...byInteraction.values()].sort((one, other) => other.duration - one.duration);
  if (!slowestFirst.length) return { inpMs: 0, interactions: 0, worst: null };
  const skip = Math.min(slowestFirst.length - 1, Math.floor(slowestFirst.length / 50));
  const chosen = slowestFirst[skip];
  return { inpMs: Math.round(chosen.duration), interactions: slowestFirst.length, worst: chosen };
}

/** Cumulative Layout Shift: the largest session window of shifts not caused by recent input. */
export function clsOf(shifts: ShiftEntry[]): number {
  const ordered = [...shifts].sort((one, other) => one.start - other.start);
  let best = 0;
  let total = 0;
  let first = -Infinity;
  let last = -Infinity;
  for (const shift of ordered) {
    if (shift.start - last >= 1000 || shift.start - first >= 5000) {
      total = 0;
      first = shift.start;
    }
    total += shift.value;
    last = shift.start;
    best = Math.max(best, total);
  }
  return Math.round(best * 1000) / 1000;
}

/** `interactions` counts those Event Timing reported (16 ms or more; faster ones are inside budget by
 * definition); `inputs` counts every click and key press the page saw, so a reading of 0 ms INP
 * can be told apart from a surface nobody touched. */
export type Reading = { surface: string; inpMs: number; interactions: number; inputs: number; worst: string; cls: number; lcpMs: number };

/** Which budgets a reading misses, in words; empty when it is inside all of them. */
export function overBudget(reading: Reading): string[] {
  const misses: string[] = [];
  if (reading.inpMs > BUDGETS.inpMs) misses.push(`${reading.surface}: INP ${reading.inpMs} ms over ${BUDGETS.inpMs} ms (${reading.worst})`);
  if (reading.cls > BUDGETS.cls) misses.push(`${reading.surface}: CLS ${reading.cls} over ${BUDGETS.cls}`);
  if (reading.lcpMs > BUDGETS.lcpMs) misses.push(`${reading.surface}: LCP ${reading.lcpMs} ms over ${BUDGETS.lcpMs} ms`);
  return misses;
}
