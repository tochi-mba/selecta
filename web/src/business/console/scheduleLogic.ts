// Pure helpers for the schedule board (ADR-0453 D7, BZ-0453-10): venue-time clocks, overnight
// blocks split at midnight, the versions sent with an apply, and conflict choices.

import type { ApplyPreview, BusinessClient } from '../client';
import type { Daypart, Venue, ZoneSchedule } from '../types';

/** "18:30" to minutes; "26:00" is 02:00 the next day (overnight). Null when it is not a time. */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 47) return null;
  return hours * 60 + minutes;
}

export const toClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Where a daypart sits on a 24 hour track, as percentages; an overnight block becomes two pieces. */
export function blockPieces(part: Daypart): { left: number; width: number }[] {
  const day = 1440;
  const start = Math.max(0, part.start);
  const end = Math.max(start, part.end);
  const pct = (minutes: number) => (minutes / day) * 100;
  if (end <= day) return [{ left: pct(start), width: pct(end - start) }];
  const pieces = [{ left: pct(start), width: pct(day - start) }];
  const spill = Math.min(end - day, day);
  if (spill > 0) pieces.push({ left: 0, width: pct(spill) });
  return pieces;
}

/** The version of every zone schedule in the chosen venues, as the apply needs (ADR-0444). */
export function versionsFor(venueIds: string[], venues: Venue[], schedules: Record<string, ZoneSchedule | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const venue of venues) {
    if (!venueIds.includes(venue.id)) continue;
    for (const zone of venue.zones) {
      const schedule = schedules[zone.id];
      if (schedule) out[zone.id] = schedule.version;
    }
  }
  return out;
}

export type ConflictChoice = 'mine' | 'theirs';

/** The venues still changed after the person chose per conflicting venue. */
export function venuesAfterChoices(venueIds: string[], preview: ApplyPreview, choices: Record<string, ConflictChoice>): string[] {
  const theirs = new Set(preview.conflicts.filter((conflict) => (choices[conflict.venue_id] ?? 'mine') === 'theirs').map((conflict) => conflict.venue_id));
  return venueIds.filter((id) => !theirs.has(id));
}

/** "Sam" from "Sam Manager", so the conflict line reads like a person. */
export function firstName(name?: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'someone';
}

/** Read every zone's schedule, a few at a time, so 500 venues do not open 1,500 requests at once. */
export async function loadSchedules(client: Pick<BusinessClient, 'schedule'>, zoneIds: string[], limit = 8): Promise<Record<string, ZoneSchedule>> {
  const out: Record<string, ZoneSchedule> = {};
  let next = 0;
  const worker = async () => {
    while (next < zoneIds.length) {
      const id = zoneIds[next++];
      try {
        const schedule = await client.schedule(id);
        if (schedule) out[id] = { ...schedule, zone_id: id };
      } catch { /* a zone that will not load shows "No schedule yet"; the rest still load */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, zoneIds.length) }, worker));
  return out;
}
