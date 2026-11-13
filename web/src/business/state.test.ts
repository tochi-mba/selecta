// BZ-0453-02: each D3 trigger and the severity order, from fixtures.
import { describe, expect, it } from 'vitest';
import { NOW, org, scenario, venue, zone } from './fixtures';
import { deriveStates, isSilent, OfflineTracker, readOnly, SEVERITY, splitBanners, zoneShownState } from './state';

const kinds = (name: Parameters<typeof scenario>[0], offline = false) => {
  const data = scenario(name);
  return deriveStates({ org: data.org, venues: data.venues, now: NOW, offline }).map((state) => state.kind);
};

describe('business state triggers', () => {
  it('normal has nothing to say', () => expect(kinds('normal')).toEqual([]));
  it('a zone silent for 60 s in opening hours is a silent zone', () => expect(kinds('silent')).toEqual(['silent_zone']));
  it('silence under 60 s is not yet a silent zone', () => {
    const v = venue('a', 'A', { zones: [zone('a', 'z', 'Bar', { state: 'silent', state_since: NOW - 59 })] });
    expect(isSilent(v.zones[0], v, NOW)).toBe(false);
  });
  it('a closed venue is never silent', () => {
    const v = venue('a', 'A', { open_now: false, zones: [zone('a', 'z', 'Bar', { state: 'silent', state_since: NOW - 600 })] });
    expect(isSilent(v.zones[0], v, NOW)).toBe(false);
  });
  it('a staff pause is not silence, but over 30 minutes it becomes a long pause', () => expect(kinds('long_pause')).toEqual(['long_pause']));
  it('over seats', () => expect(kinds('over_seats')).toEqual(['over_seats']));
  it('licence ending within 30 days', () => expect(kinds('licence_expiring')).toEqual(['licence_expiring']));
  it('licence date passed', () => expect(kinds('licence_expired')).toEqual(['licence_expired']));
  it('payment grace, then its last 72 hours, then ended', () => {
    expect(kinds('grace')).toEqual(['payment_grace']);
    expect(kinds('grace_final')).toEqual(['payment_grace_final']);
    expect(kinds('grace_ended')).toEqual(['payment_grace_final']);
  });
  it('plan locked: an unpaid zone and a teaser', () => expect(kinds('plan_locked')).toEqual(['plan_locked', 'plan_locked']));
  it('pilot active says nothing; ending within 14 days; ended', () => {
    expect(kinds('pilot')).toEqual([]);
    expect(kinds('pilot_ending')).toEqual(['pilot_ending']);
    expect(kinds('pilot_ended')).toEqual(['pilot_ended']);
  });
  it('health older than 2 minutes is degraded and reads Not reporting', () => {
    expect(kinds('degraded')).toEqual(['degraded']);
    const data = scenario('degraded');
    expect(zoneShownState(data.venues[2].zones[0], data.venues[2], NOW)).toBe('not_reporting');
  });
  it('offline replaces degraded', () => {
    expect(kinds('degraded', true)).toEqual(['offline']);
  });
  it('closed wins over a device problem on the grid', () => {
    const v = venue('a', 'A', { open_now: false, zones: [zone('a', 'z', 'Bar', { state: 'not_paired' })] });
    expect(zoneShownState(v.zones[0], v, NOW)).toBe('closed');
  });
});

describe('severity and banners', () => {
  it('follows the D3 order', () => {
    expect(SEVERITY.slice(0, 1)).toEqual(['silent_zone']);
    expect(SEVERITY.indexOf('licence_expired')).toBeLessThan(SEVERITY.indexOf('payment_grace_final'));
    expect(SEVERITY.indexOf('pilot_ended')).toBeLessThan(SEVERITY.indexOf('offline'));
    expect(SEVERITY.indexOf('offline')).toBeLessThan(SEVERITY.indexOf('licence_expiring'));
    expect(SEVERITY.indexOf('payment_grace')).toBeLessThan(SEVERITY.indexOf('pilot_ending'));
    expect(SEVERITY.indexOf('over_seats')).toBeLessThan(SEVERITY.indexOf('degraded'));
    expect(SEVERITY.at(-1)).toBe('plan_locked');
  });
  it('only the top two become banners; the rest go to Needs attention', () => {
    const data = scenario('silent');
    data.org = org({ seats: { included: 1, paid: 0, held: 3 }, billing: { ...org().billing, status: 'grace', grace_ends_at: NOW + 10 * 86_400 } });
    data.venues[0].licence = { ...data.venues[0].licence!, expires_on: '2026-11-01' };
    const states = deriveStates({ org: data.org, venues: data.venues, now: NOW });
    const { banners, attention } = splitBanners(states);
    expect(banners.map((s) => s.kind)).toEqual(['silent_zone', 'licence_expired']);
    expect(attention.map((s) => s.kind)).toEqual(['payment_grace', 'over_seats']);
  });
  it('plan locked never takes a banner', () => {
    const { banners } = splitBanners(deriveStates({ org: scenario('plan_locked').org, venues: scenario('plan_locked').venues, now: NOW }));
    expect(banners).toEqual([]);
  });
});

describe('read only and offline', () => {
  it('grace ended and pilot ended are read only', () => {
    expect(readOnly(scenario('grace_ended').org, NOW)).toBe(true);
    expect(readOnly(scenario('pilot_ended').org, NOW)).toBe(true);
    expect(readOnly(scenario('grace').org, NOW)).toBe(false);
  });
  it('three failed reads in 30 s count as offline', () => {
    const tracker = new OfflineTracker({ onLine: true });
    tracker.failed(0); tracker.failed(10_000);
    expect(tracker.offline(10_000)).toBe(false);
    tracker.failed(20_000);
    expect(tracker.offline(20_000)).toBe(true);
    expect(tracker.offline(45_000)).toBe(false);
  });
  it('the browser offline signal counts at once', () => expect(new OfflineTracker({ onLine: false }).offline()).toBe(true));
});
