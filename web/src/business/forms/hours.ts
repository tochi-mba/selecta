// Opening-hours arithmetic for OpeningHoursEditor and the first-service summary (ADR-0444, D6).
// Minutes after midnight in venue time; a close past 1440 is the next day (overnight hours).

import { clock } from '../time';
import type { OpeningSpan, WeekHours } from '../types';

export type DayKey = keyof WeekHours;
export const DAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_SHORT: Record<DayKey, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export const DAY_LONG: Record<DayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export const emptyWeek = (): WeekHours => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

/** "18:00" to minutes, or null. */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Open and close times as typed: a close at or before the open is the next day. */
export function spanFrom(open: number, close: number): OpeningSpan {
  return { open, close: close <= open ? close + 1440 : close };
}

/** "Fri 18:00 to 02:00 next day". */
export function spanWords(day: DayKey, span: OpeningSpan): string {
  return `${DAY_SHORT[day]} ${clock(span.open)} to ${clock(span.close)}`;
}

const minutesOf = (spans: OpeningSpan[]) => spans.reduce((sum, span) => sum + Math.max(0, span.close - span.open), 0);

function hoursText(minutes: number) {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? '' : 's'}`;
}

/** "Open 7 days, 66 hours a week" (D6). */
export function hoursSummary(hours: WeekHours): string {
  const openDays = DAYS.filter((day) => minutesOf(hours[day] ?? []) > 0);
  if (!openDays.length) return 'Closed every day';
  const total = DAYS.reduce((sum, day) => sum + minutesOf(hours[day] ?? []), 0);
  return `Open ${openDays.length} day${openDays.length === 1 ? '' : 's'}, ${hoursText(total)} a week`;
}

/** Copies one day's spans to the chosen days. */
export function copyDay(hours: WeekHours, from: DayKey, to: DayKey[]): WeekHours {
  const next = { ...hours };
  for (const day of to) next[day] = (hours[from] ?? []).map((span) => ({ ...span }));
  return next;
}

/** The weekday key and minutes after midnight at `epochSeconds` in a time zone. */
export function localDayMinutes(epochSeconds: number, timeZone: string): { day: DayKey; minutes: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const day = get('weekday').slice(0, 3).toLowerCase() as DayKey;
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

/** The next opening after `now`: today if it opens later today, otherwise the next open day. */
export function nextOpening(hours: WeekHours, now: number, timeZone: string, closedDates: string[] = []): { day: DayKey; open: number; inDays: number } | null {
  const here = localDayMinutes(now, timeZone);
  const start = DAYS.indexOf(here.day);
  for (let offset = 0; offset < 8; offset += 1) {
    const day = DAYS[(start + offset) % 7];
    const date = isoPlusDays(here.date, offset);
    if (closedDates.includes(date)) continue;
    const spans = [...(hours[day] ?? [])].sort((a, b) => a.open - b.open);
    const span = spans.find((item) => offset > 0 || item.open > here.minutes);
    if (span) return { day, open: span.open, inDays: offset };
  }
  return null;
}

function isoPlusDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
