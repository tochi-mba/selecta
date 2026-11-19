import { describe, expect, it, vi } from 'vitest';
import {
  blocklistDiff, clockOf, energyWord, exceptionBody, hoursBody, membersOf, programmeBody, rulesBody, rulesOf, scheduleOf,
} from './clientAdapters';
import { businessClient, commandBody, ROUTES } from './client';
import type { ContentRules } from './types';

describe('client adapters (page view models to server wire shapes)', () => {
  it('turns week hours into weekday periods, wrapping overnight closes', () => {
    expect(clockOf(1560)).toBe('02:00');
    const body = hoursBody({ mon: [{ open: 600, close: 1380 }], tue: [], wed: [], thu: [], fri: [{ open: 1080, close: 1560 }], sat: [], sun: [] });
    expect(body.periods).toEqual([
      { weekday: 0, opens: '10:00', closes: '23:00', all_day: false },
      { weekday: 4, opens: '18:00', closes: '02:00', all_day: false },
    ]);
    expect(exceptionBody({ date: '2026-12-25', closed: true, label: 'Christmas' })).toEqual({ date: '2026-12-25', closed: true, periods: [], note: 'Christmas' });
  });

  it('round-trips a one-day schedule through the weekly programme', () => {
    const parts = [{ id: 'a', name: 'Brunch', start: 600, end: 1020, energy: 'calm' as const, crate_ids: ['c1'] }, { id: 'b', name: 'Evening', start: 1020, end: 1440, energy: 'peak' as const }];
    const body = programmeBody(parts);
    expect(Object.keys(body.weekly)).toHaveLength(7);
    expect(body.weekly['3'][0]).toEqual({ start: '10:00', name: 'Brunch', crates: ['c1'], energy: 25 });
    const back = scheduleOf('zone-1', { version_id: 'v', created_at: 99, created_by: 'sam', programme: body });
    expect(back.version).toBe(99);
    expect(back.dayparts.map((p) => [p.name, p.start, p.end, p.energy])).toEqual([['Brunch', 600, 1020, 'calm'], ['Evening', 1020, 1440, 'peak']]);
    expect(energyWord(60)).toBe('steady');
  });

  it('maps venue rules and the blocklist both ways', () => {
    const rules = rulesOf({
      venue: { filter_mode: 'off', bpm_max: 128 },
      zones: { bar: { rules: { crate_ids: ['brand'] } } },
      volume: { bar: { cap: 0.7, quiet_hours: [{ start: '22:00', end: '23:30', cap: 0.4 }] } },
    }, [
      { id: 'e1', kind: 'artist', value: 'Loud Band', label: 'Loud Band', scope: 'organisation', scope_id: 'org' },
      { id: 'e2', kind: 'song', value: 's9', label: 'Song 9', scope: 'venue', scope_id: 'camden' },
      { id: 'e3', kind: 'song', value: 's8', label: 'Song 8', scope: 'venue', scope_id: 'soho' },
    ], 'camden');
    expect(rules.explicit).toBe('allow');
    expect(rules.blocklist.map((item) => item.id)).toEqual(['Loud Band', 's9']);
    expect(rules.volume_caps).toEqual({ bar: 70 });
    expect(rules.quiet_hours).toEqual([{ zone_id: 'bar', start: 1320, end: 1410, cap: 40 }]);
    const next: ContentRules = { ...rules, explicit: 'block_daytime', blocklist: [{ kind: 'song', id: 's10', label: 'Song 10' }] };
    const body = rulesBody(next, ['bar']);
    expect(body.venue.filter_mode).toBe('no_explicit');
    expect(body.zones).toEqual({ bar: { crate_ids: ['brand'] } });
    expect(body.volume.bar).toEqual({ cap: 0.7, quiet_hours: [{ start: '22:00', end: '23:30', cap: 0.4 }] });
    const change = blocklistDiff(next.blocklist, [{ id: 'e2', kind: 'song', value: 's9', label: 'Song 9', scope: 'venue', scope_id: 'camden' }], 'camden');
    expect(change).toEqual({ add: [{ kind: 'song', value: 's10', label: 'Song 10', scope: 'venue', scope_id: 'camden' }], remove: ['e2'] });
  });

  it('reads the people list', () => {
    expect(membersOf({ people: [{ id: 'u1', name: null, email: 'a@example.test', role: 'staff', venue_ids: ['v'] }], invitations: [], seats: { included: 3, paid: 0, held: 1 } }))
      .toEqual([{ id: 'u1', name: 'a@example.test', email: 'a@example.test', role: 'staff', venue_ids: ['v'], pin_set: undefined }]);
  });

  it('sends staff commands in the zone command route shape', () => {
    expect(commandBody({ kind: 'resume' }, 'k1', 5)).toEqual({ id: 'k1', issued_at: 5, origin: 'staff', kind: 'play', payload: {} });
    expect(commandBody({ kind: 'steer', word: 'calmer' }, 'k2', 5).payload).toEqual({ word: 'calmer' });
  });

  it('calls the organisation overview in the organisation workspace', async () => {
    const api = vi.fn(async () => ({ org: { id: 'crown' }, venues: [] })) as never;
    await businessClient(api).overview('crown');
    expect(api).toHaveBeenCalledWith(ROUTES.overview('crown'), undefined, 'crown');
    expect(ROUTES.overview('crown')).toBe('/business/orgs/crown/overview');
  });

  it('expands a schedule template into dayparts before applying', async () => {
    const api = vi.fn(async () => ({ venues: 1, open_now: 0, conflicts: [] }));
    await businessClient(api as never, 'crown').previewApply('crown', { venue_ids: ['camden'], template: 'cafe_day' });
    const body = JSON.parse((api.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.preview).toBe(true);
    expect(body.dayparts.length).toBeGreaterThan(0);
  });
});
