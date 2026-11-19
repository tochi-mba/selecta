// Made-up business data for tests and the e2e harness, one scenario per ADR-0453 D3 state.
// Names are invented; no real venue, person or library appears here.

import type { Device, Org, Overview, Venue, Zone } from './types';

export const NOW = Date.UTC(2026, 10, 14, 14, 30) / 1000; // Sat 14 November 2026, 14:30 UTC
const DAY = 86_400;

export type Scenario =
  | 'normal' | 'empty' | 'silent' | 'long_pause' | 'over_seats' | 'licence_expiring' | 'licence_expired'
  | 'grace' | 'grace_final' | 'grace_ended' | 'plan_locked' | 'pilot' | 'pilot_ending' | 'pilot_ended'
  | 'degraded' | 'stress';

export function zone(venueId: string, id: string, name: string, extra: Partial<Zone> = {}): Zone {
  return {
    id, venue_id: venueId, name, state: 'playing', state_since: NOW - 600, paid: true, volume: 55, volume_cap: 70,
    now: { id: `${id}-s1`, title: 'Harbour Lights', artist: 'The Paper Kites Collective' },
    next: { id: `${id}-s2`, title: 'Slow Tide', artist: 'Mara Okafor' }, progress: 0.4, requests_waiting: 2,
    speaker_device_id: `${id}-kiosk`, ...extra,
  };
}

export function venue(id: string, name: string, extra: Partial<Venue> = {}): Venue {
  return {
    id, name, address: '12 Example Street, London', region: 'London', tags: ['bar'], time_zone: 'Europe/London', phone: '020 7946 0000',
    open_now: true, next_open_at: NOW + DAY, next_close_at: NOW + 9 * 3600, health_at: NOW - 20,
    licence: { kind: 'themusiclicence', number: 'TML-000123', expires_on: '2027-06-30', attested_at: NOW - 30 * DAY },
    stay_open_late: { allowance_minutes: 60, until: null },
    hours: { mon: [{ open: 600, close: 1380 }], tue: [{ open: 600, close: 1380 }], wed: [{ open: 600, close: 1380 }], thu: [{ open: 600, close: 1380 }], fri: [{ open: 600, close: 1560 }], sat: [{ open: 600, close: 1560 }], sun: [{ open: 600, close: 1320 }] },
    holidays: [], zones: [zone(id, `${id}-bar`, 'Bar'), zone(id, `${id}-terrace`, 'Terrace', { now: { id: 'x', title: 'Morning Paper', artist: 'Lumen Trio' } })],
    ...extra,
  };
}

export function org(extra: Partial<Org> = {}): Org {
  return {
    id: 'crown', workspace_id: 'ws-crown', name: 'The Crown Group', country: 'GB', role: 'owner', venue_scope: null, pilot: null,
    billing: {
      status: 'ok', currency: 'GBP', plan: 'business', payments_available: true, invoicing: 'consolidated',
      lines: [{ item: 'venue', quantity: 3, unit_amount: 7900, interval: 'month' }, { item: 'zone', quantity: 2, unit_amount: 2500, interval: 'month' }, { item: 'seat', quantity: 1, unit_amount: 500, interval: 'month' }],
      invoices: [{ id: 'in_1', number: 'SDJ-0042', po_number: 'PO-7781', amount: 29200, status: 'paid', issued_at: NOW - 10 * DAY }],
      storage: { used_bytes: 120e9, limit_bytes: 400e9 },
    },
    seats: { included: 9, paid: 1, held: 8 },
    features: {
      'business.orgs': true, 'business.workspaces': true, 'business.console': true, 'business.venue_view': true,
      'business.staff_controls': true, 'business.kiosk': true, 'business.schedules': true, 'business.content_controls': true,
      'business.rooms': true, 'business.people': true, 'business.billing': true, 'business.licensing': true, 'business.devices': true,
    },
    feature_locks: {},
    setup: null,
    ...extra,
  };
}

export function scenario(kind: Scenario): Overview {
  const base: Overview = {
    org: org(),
    venues: [venue('camden', 'Camden'), venue('soho', 'Soho', { open_now: false, zones: [zone('soho', 'soho-bar', 'Bar', { state: 'closed' })] }), venue('brooklyn', 'Brooklyn', { time_zone: 'America/New_York', region: 'New York' })],
    devices: [device('camden-bar-kiosk', 'Bar player', 'camden-bar'), device('camden-tablet', 'Bar tablet', 'camden-bar', 'tablet')],
    activity: [{ id: 'a1', at: NOW - 3600, venue_id: 'camden', zone_id: 'camden-bar', words: 'Bar was silent for 3 minutes. Audio came back by itself.' }],
  };
  const v = base.venues;
  switch (kind) {
    case 'normal': return base;
    case 'empty': return { ...base, venues: [], devices: [], activity: [] };
    case 'silent': v[0].zones[0] = { ...v[0].zones[0], state: 'silent', state_since: NOW - 240, now: null, last_report: 'No audio for 4 minutes' }; return base;
    case 'long_pause': v[0].zones[1] = { ...v[0].zones[1], state: 'paused_by_staff', paused_by: 'Bar tablet', state_since: NOW - 40 * 60 }; return base;
    case 'over_seats': return { ...base, org: org({ seats: { included: 3, paid: 0, held: 6 } }) };
    case 'licence_expiring': v[0].licence = { ...v[0].licence!, expires_on: '2026-12-03' }; return base;
    case 'licence_expired': v[0].licence = { ...v[0].licence!, expires_on: '2026-11-03' }; return base;
    case 'grace': return { ...base, org: org({ billing: { ...org().billing, status: 'grace', grace_ends_at: NOW + 12 * DAY } }) };
    case 'grace_final': return { ...base, org: org({ billing: { ...org().billing, status: 'grace', grace_ends_at: NOW + 2 * DAY } }) };
    case 'grace_ended': return { ...base, org: org({ billing: { ...org().billing, status: 'grace_ended', grace_ends_at: NOW - DAY } }) };
    case 'plan_locked': v[0].zones[1] = { ...v[0].zones[1], paid: false }; return { ...base, org: org({ feature_locks: { 'business.sso': 'enterprise' } }) };
    case 'pilot': return { ...base, org: org({ pilot: { status: 'active', ends_at: NOW + 50 * DAY, allowance: { venues: 3, zones: 6 } }, billing: { ...org().billing, plan: 'pilot' } }) };
    case 'pilot_ending': return { ...base, org: org({ pilot: { status: 'ending', ends_at: NOW + 9 * DAY, allowance: { venues: 3, zones: 6 } }, billing: { ...org().billing, plan: 'pilot' } }) };
    case 'pilot_ended': return { ...base, org: org({ pilot: { status: 'ended', ends_at: NOW - DAY, allowance: { venues: 3, zones: 6 } }, billing: { ...org().billing, plan: 'pilot' } }) };
    case 'degraded': v[2].health_at = NOW - 400; return base;
    case 'stress': return { ...base, venues: stressVenues(500) };
  }
}

/** 500 venues x 3 zones with awkward names, for the grid's virtualisation and sort timings. */
export function stressVenues(count: number): Venue[] {
  const states: Zone['state'][] = ['playing', 'playing', 'playing_saved', 'paused_by_staff', 'quiet_hours', 'silent', 'not_paired'];
  return Array.from({ length: count }, (_, index) => {
    const id = `v${index}`;
    const name = index % 7 === 0 ? `The Extraordinarily Long-Named Riverside Tavern & Kitchen No. ${index}` : `Venue ${index} Ünïcödé`;
    return venue(id, name, {
      region: ['London', 'Manchester', 'Leeds', 'New York'][index % 4], time_zone: index % 4 === 3 ? 'America/New_York' : 'Europe/London',
      zones: [0, 1, 2].map((z) => zone(id, `${id}-z${z}`, ['Bar', 'Terrace', 'Dining room'][z], { state: states[(index + z) % states.length], state_since: NOW - 120 - index })),
    });
  });
}

export function device(id: string, name: string, zoneId: string, kind: Device['kind'] = 'kiosk', extra: Partial<Device> = {}): Device {
  return { id, name, kind, zone_id: zoneId, online: true, last_seen_at: NOW - 15, saved_hours_ahead: 4.2, version: '2026.11.3', network: 'Venue Wi-Fi', ...extra };
}
