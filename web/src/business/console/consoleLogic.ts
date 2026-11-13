// Pure pieces of the HQ console (ADR-0453 D7): sorting, filtering and searching venues, the
// `Needs you` mark, the reason a change control is disabled, and the per-zone limiter for
// now-playing announcements. Kept free of React so the 500-venue timing can be measured directly.

import { CONSOLE_COPY } from '../copy/console';
import { MANAGER_COPY } from '../copy/states';
import { daysUntil, isSilent, readOnly, venueRank, zoneShownState } from '../state';
import type { Org, Venue, ZonePlayState } from '../types';

export type SortKey = 'severity' | 'name' | 'region';
export type StatusFilter = 'all' | 'silent' | 'not_reporting' | 'paused_by_staff' | 'playing' | 'closed' | 'needs_you';
export type GridOptions = { sort: SortKey; region: string; status: StatusFilter; tag: string; query: string };
export const DEFAULT_OPTIONS: GridOptions = { sort: 'severity', region: '', status: 'all', tag: '', query: '' };

/** A venue that needs a person: its licence date has passed or no licence was entered. */
export function needsYou(venue: Venue, now: number): boolean {
  if (!venue.licence) return true;
  return daysUntil(venue.licence.expires_on, now) < 0;
}

export function hasSilentZone(venue: Venue, now: number): boolean {
  return venue.zones.some((zone) => isSilent(zone, venue, now) || zoneShownState(zone, venue, now) === 'silent');
}

const fold = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function matchesStatus(venue: Venue, status: StatusFilter, now: number, shown: ZonePlayState[]): boolean {
  if (status === 'all') return true;
  if (status === 'needs_you') return needsYou(venue, now);
  if (status === 'playing') return shown.some((state) => state === 'playing' || state === 'playing_saved' || state === 'quiet_hours');
  return shown.includes(status);
}

/** Filter, search and sort in one pass with precomputed keys, so 500 venues stay well under 100 ms. */
export function arrangeVenues(venues: Venue[], options: GridOptions, now: number): Venue[] {
  const query = fold(options.query.trim());
  const keyed: { venue: Venue; silent: number; rank: number; name: string; region: string }[] = [];
  for (const venue of venues) {
    if (options.region && (venue.region ?? '') !== options.region) continue;
    if (options.tag && !(venue.tags ?? []).includes(options.tag)) continue;
    const name = fold(venue.name);
    if (query && !name.includes(query)) continue;
    const shown = venue.zones.map((zone) => zoneShownState(zone, venue, now));
    if (!matchesStatus(venue, options.status, now, shown)) continue;
    keyed.push({ venue, silent: hasSilentZone(venue, now) ? 0 : 1, rank: venueRank(venue, now) + (needsYou(venue, now) ? -0.5 : 0), name, region: fold(venue.region ?? '') });
  }
  const byName = (a: typeof keyed[number], b: typeof keyed[number]) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (options.sort === 'name') keyed.sort(byName);
  else if (options.sort === 'region') keyed.sort((a, b) => (a.region < b.region ? -1 : a.region > b.region ? 1 : 0) || byName(a, b));
  else keyed.sort((a, b) => a.silent - b.silent || a.rank - b.rank || byName(a, b));
  return keyed.map((item) => item.venue);
}

export function regionsOf(venues: Venue[]): string[] {
  return [...new Set(venues.map((venue) => venue.region).filter((region): region is string => !!region))].sort();
}

export function tagsOf(venues: Venue[]): string[] {
  return [...new Set(venues.flatMap((venue) => venue.tags ?? []))].sort();
}

/** Why a control that changes things is disabled right now, or null when it is allowed (D7). */
export function changeBlocked({ org, now, offline }: { org: Org; now: number; offline: boolean }): string | null {
  if (readOnly(org, now)) return org.billing.status === 'grace_ended' ? MANAGER_COPY.readOnlyAction : MANAGER_COPY.pilotReadOnly;
  if (offline) return MANAGER_COPY.offlineControls;
  if (org.role === 'viewer') return CONSOLE_COPY.viewerReadOnly;
  return null;
}

export const ANNOUNCE_EVERY_MS = 30_000;

/** Now-playing announcements at most once every 30 s per zone (D5). The first song a zone is seen
 * with is not news. A change inside the 30 s is held and said on the first look after it. */
export class AnnouncementLimiter {
  private said = new Map<string, { song: string; at: number }>();
  constructor(private readonly everyMs = ANNOUNCE_EVERY_MS) {}
  offer(zoneId: string, songId: string, nowMs: number): boolean {
    const last = this.said.get(zoneId);
    if (!last) { this.said.set(zoneId, { song: songId, at: -Infinity }); return false; }
    if (last.song === songId) return false;
    if (nowMs - last.at < this.everyMs) return false;
    this.said.set(zoneId, { song: songId, at: nowMs });
    return true;
  }
}
