// Wire shapes and pure reshaping for opening hours (ADR-0444) and the business usage meters and
// continuity figure (ADR-0448). client.ts calls the routes; this file only reshapes.

import { minutesOf } from './clientAdapters';
import type { OpeningSpan, WeekHours } from './types';

const DAYS: (keyof WeekHours)[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type HoursPeriod = { id: string; zone_id: string | null; weekday: number; opens: string; closes: string; all_day: boolean };
export type HourException = { id: string; zone_id: string | null; date: string; until: string | null; closed: boolean; periods: [string, string][]; repeat_yearly: boolean; note: string };
export type HoursAnswer = { time_zone: string; closing_mode?: 'natural' | 'exact'; periods: HoursPeriod[]; exceptions: HourException[] };
export type HolidaySuggestion = { date: string; closed: boolean; note: string };
export type ZoneDayState = {
  state: 'closed' | 'warming' | 'opening' | 'open' | 'closing';
  since: string | null; next_state: string | null; next_change: string | null; time_zone: string; open_late_until: string | null;
};
export type CloseNowAnswer = { id: string; fade_seconds: number; undo_seconds: number };

/** The venue's own weekly hours (zone_id null) as the editor's WeekHours. */
export function weekOf(answer: HoursAnswer, zoneId: string | null = null): WeekHours {
  const week: WeekHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  for (const period of answer.periods ?? []) {
    if ((period.zone_id ?? null) !== zoneId) continue;
    const day = DAYS[period.weekday];
    if (!day) continue;
    let span: OpeningSpan;
    if (period.all_day) span = { open: 0, close: 1440 };
    else {
      const open = minutesOf(period.opens);
      const close = minutesOf(period.closes);
      span = { open, close: close <= open ? close + 1440 : close };
    }
    week[day] = [...week[day], span].sort((a, b) => a.open - b.open);
  }
  return week;
}

/** Venue-wide exceptions, soonest first. */
export function exceptionsOf(answer: HoursAnswer): HourException[] {
  return [...(answer.exceptions ?? [])].filter((item) => !item.zone_id).sort((a, b) => a.date.localeCompare(b.date));
}

/** Suggestions not already covered by an exception on the same date. */
export function newSuggestions(suggestions: HolidaySuggestion[], exceptions: HourException[]): HolidaySuggestion[] {
  const taken = new Set(exceptions.map((item) => item.date));
  return suggestions.filter((item) => !taken.has(item.date));
}

export type Meter = { used: number; limit: number | null };
export type UsageAnswer = {
  organisation_id: string;
  always_open_confirmed?: boolean;
  storage: Meter & { read_only: boolean; message: string; unassigned_bytes: number };
  derived: Meter;
  seats: Meter & { billed_extra: number; extra_needed: number };
  zones: Meter;
  analysis: Meter & { resets_at: number };
  lucy: Record<string, Meter & { remaining: number; resets_at: number }>;
  venues: { venue_id: string; name: string; entitled: boolean; pilot: boolean; storage_bytes: number; zones: Meter; render: { zone_id: string; cpu_used_s: number; cpu_budget_s: number; skipped: number }[] }[];
};
export type ZoneMonthRow = {
  venue_id: string; venue_name: string; zone_id: string;
  scheduled_minutes: number; playing_minutes: number; silent_minutes: number; unknown_minutes: number; excluded_minutes: number;
  transitions: number; transitions_ready: number; continuity: number | null; readiness: number | null; credit_percent: number; computed_at: number;
};
export type CreditProposal = { id: string; venue_id: string; month: string; percent: number; amount_minor: number; currency: string; state: 'proposed' | 'approved' | 'rejected' };
export type SloAnswer = { organisation_id: string; month: string; targets: { continuity: number; readiness: number }; zones: ZoneMonthRow[]; credits: CreditProposal[] };

/** Decimal gigabytes as people read them: "18.4 GB". */
export function gigabytes(bytes: number): string {
  const value = bytes / 1_000_000_000;
  return Number.isInteger(value) ? `${value} GB` : `${value.toFixed(1)} GB`;
}

/** "99.95%", or "Not measured yet" when there is nothing to measure. */
export function percentWords(value: number | null): string {
  if (value == null) return 'Not measured yet';
  return `${(Math.floor(value * 10000) / 100).toFixed(2)}%`;
}

/** A meter as words: "120 of 400", or just the number when there is no limit. */
export function meterWords(meter: Meter, format: (value: number) => string = (value) => value.toLocaleString('en-GB')): string {
  return meter.limit == null ? format(meter.used) : `${format(meter.used)} of ${format(meter.limit)}`;
}
