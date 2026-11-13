// The business state model (ADR-0453 D3, BZ-0453-02). One module derives every manager-facing
// state from server data with the exact triggers in the ADR, orders them by severity, and splits
// them into at most two banners and a Needs attention list. Customer-facing entries (kiosk,
// guest, display) never import this file.

import type { Org, Venue, Zone, Health } from './types';

export type StateKind =
  | 'silent_zone' | 'licence_expired' | 'payment_grace_final' | 'pilot_ended' | 'offline'
  | 'licence_expiring' | 'payment_grace' | 'pilot_ending' | 'over_seats' | 'degraded' | 'plan_locked'
  | 'long_pause';

/** Highest first (D3). `long_pause` (a staff pause over 30 minutes in opening hours, D10) is a
 * manager alert that is not silence, so it sits just under silent zones. */
export const SEVERITY: StateKind[] = [
  'silent_zone', 'long_pause', 'licence_expired', 'payment_grace_final', 'pilot_ended', 'offline',
  'licence_expiring', 'payment_grace', 'pilot_ending', 'over_seats', 'degraded', 'plan_locked',
];

export type BusinessState = {
  kind: StateKind;
  /** Stable key, so an alert announced once is not announced again. */
  key: string;
  venue_id?: string;
  zone_id?: string;
  /** Epoch seconds the state began, where known (silent since, licence end). */
  since?: number | null;
  /** Epoch seconds a deadline falls (grace end, licence date, pilot end). */
  until?: number | null;
};

export const SILENT_AFTER_S = 60;
export const HEALTH_STALE_S = 120;
export const LONG_PAUSE_S = 30 * 60;
export const LICENCE_WARN_DAYS = 30;
export const LICENCE_GRACE_DAYS = 14;
export const PILOT_WARN_DAYS = 14;
export const GRACE_FINAL_S = 72 * 3600;
const DAY = 86_400;

/** Offline: the browser says so, or three reads failed within 30 seconds (D3). */
export class OfflineTracker {
  private failures: number[] = [];
  constructor(private readonly nav: { onLine: boolean } = typeof navigator === 'undefined' ? { onLine: true } : navigator) {}
  failed(nowMs = Date.now()) { this.failures = [...this.failures.filter((at) => nowMs - at < 30_000), nowMs]; }
  succeeded() { this.failures = []; }
  offline(nowMs = Date.now()) {
    if (!this.nav.onLine) return true;
    return this.failures.filter((at) => nowMs - at < 30_000).length >= 3;
  }
}

/** Days from `now` to an ISO date's end (venue-local dates are compared by calendar day). */
export function daysUntil(isoDate: string, now: number): number {
  const end = Date.parse(`${isoDate}T23:59:59Z`) / 1000;
  return Math.floor((end - now) / DAY);
}

/** Health older than two minutes reads `not_reporting`, never a stale `playing` (S2 degraded). */
export function zoneShownState(zone: Zone, venue: Venue, now: number): Zone['state'] {
  if (!venue.open_now && zone.state !== 'paused_by_staff') return zone.paid ? 'closed' : 'plan_paused';
  if (!zone.paid) return 'plan_paused';
  if (venue.health_at != null && now - venue.health_at > HEALTH_STALE_S) return 'not_reporting';
  return zone.state;
}

/** A zone is silent inside opening hours after 60 s with no audio or no speaker, unless staff paused it. */
export function isSilent(zone: Zone, venue: Venue, now: number): boolean {
  if (!venue.open_now || !zone.paid) return false;
  if (zone.state === 'paused_by_staff') return false;
  if (zone.state !== 'silent' && zone.state !== 'not_paired') return false;
  const since = zone.state_since ?? now - SILENT_AFTER_S;
  return now - since >= SILENT_AFTER_S;
}

export function isLongPause(zone: Zone, venue: Venue, now: number): boolean {
  return venue.open_now && zone.state === 'paused_by_staff' && zone.state_since != null && now - zone.state_since >= LONG_PAUSE_S;
}

export type DeriveInput = { org: Org; venues: Venue[]; health?: Health | null; offline?: boolean; now: number };

/** Every D3 state that applies right now, highest severity first. */
export function deriveStates({ org, venues, health, offline, now }: DeriveInput): BusinessState[] {
  const out: BusinessState[] = [];
  for (const venue of venues) {
    for (const zone of venue.zones) {
      if (isSilent(zone, venue, now)) out.push({ kind: 'silent_zone', key: `silent:${zone.id}:${zone.state_since ?? ''}`, venue_id: venue.id, zone_id: zone.id, since: zone.state_since ?? null });
      else if (isLongPause(zone, venue, now)) out.push({ kind: 'long_pause', key: `pause:${zone.id}:${zone.state_since}`, venue_id: venue.id, zone_id: zone.id, since: zone.state_since });
      if (!zone.paid) out.push({ kind: 'plan_locked', key: `zone-unpaid:${zone.id}`, venue_id: venue.id, zone_id: zone.id });
    }
    if (venue.licence) {
      const days = daysUntil(venue.licence.expires_on, now);
      if (days < 0) out.push({ kind: 'licence_expired', key: `licence-expired:${venue.id}`, venue_id: venue.id, until: Date.parse(`${venue.licence.expires_on}T00:00:00Z`) / 1000 + LICENCE_GRACE_DAYS * DAY });
      else if (days <= LICENCE_WARN_DAYS) out.push({ kind: 'licence_expiring', key: `licence-expiring:${venue.id}`, venue_id: venue.id, until: Date.parse(`${venue.licence.expires_on}T00:00:00Z`) / 1000 });
    }
  }
  const billing = org.billing;
  if (billing.status === 'grace' && billing.grace_ends_at != null) {
    const final = billing.grace_ends_at - now <= GRACE_FINAL_S;
    out.push({ kind: final ? 'payment_grace_final' : 'payment_grace', key: `grace:${billing.grace_ends_at}`, until: billing.grace_ends_at });
  } else if (billing.status === 'grace_ended') {
    out.push({ kind: 'payment_grace_final', key: 'grace-ended', until: billing.grace_ends_at ?? null });
  }
  const pilot = org.pilot;
  if (pilot && pilot.status !== 'converted') {
    if (pilot.status === 'ended' || pilot.ends_at <= now) out.push({ kind: 'pilot_ended', key: 'pilot-ended', until: pilot.ends_at });
    else if (pilot.ends_at - now <= PILOT_WARN_DAYS * DAY) out.push({ kind: 'pilot_ending', key: `pilot-ending:${pilot.ends_at}`, until: pilot.ends_at });
  }
  if (org.seats.held > org.seats.included + org.seats.paid) out.push({ kind: 'over_seats', key: 'over-seats' });
  if (offline) out.push({ kind: 'offline', key: 'offline' });
  const stale = venues.some((venue) => venue.health_at != null && now - venue.health_at > HEALTH_STALE_S);
  if (!offline && (health?.stream === 'polling' || health?.payments_down || health?.renders_slow || health?.commands_slow || stale)) out.push({ kind: 'degraded', key: 'degraded' });
  for (const [feature, plan] of Object.entries(org.feature_locks)) out.push({ kind: 'plan_locked', key: `locked:${feature}:${plan}` });
  return sortBySeverity(out);
}

export function sortBySeverity(states: BusinessState[]): BusinessState[] {
  return [...states].sort((a, b) => SEVERITY.indexOf(a.kind) - SEVERITY.indexOf(b.kind) || (a.since ?? 0) - (b.since ?? 0));
}

/** Only the highest two become banners; the rest collect in Needs attention (D3). Plan-locked
 * states never take a banner: they are teasers where the feature lives. */
export function splitBanners(states: BusinessState[]): { banners: BusinessState[]; attention: BusinessState[] } {
  const bannerable = states.filter((state) => state.kind !== 'plan_locked');
  const banners = bannerable.slice(0, 2);
  const attention = states.filter((state) => !banners.includes(state));
  return { banners, attention };
}

/** Management is read-only after grace ends or a pilot ends (D7). */
export function readOnly(org: Org, now: number): boolean {
  if (org.billing.status === 'grace_ended') return true;
  const pilot = org.pilot;
  return Boolean(pilot && pilot.status !== 'converted' && (pilot.status === 'ended' || pilot.ends_at <= now));
}

export function canManageBilling(org: Org) { return org.role === 'owner' || org.role === 'admin'; }
export function isManager(org: Org) { return org.role === 'owner' || org.role === 'admin' || org.role === 'venue_manager'; }

/** Zone severity for sorting the grid: silent first, then not reporting, paused, and so on. */
const ZONE_ORDER: Zone['state'][] = ['silent', 'not_paired', 'not_reporting', 'paused_by_staff', 'plan_paused', 'playing_saved', 'quiet_hours', 'playing', 'closed'];
export function zoneRank(state: Zone['state']) { return ZONE_ORDER.indexOf(state); }
export function venueRank(venue: Venue, now: number) {
  return Math.min(...venue.zones.map((zone) => zoneRank(zoneShownState(zone, venue, now))), ZONE_ORDER.length);
}
