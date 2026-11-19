import { describe, expect, it, vi } from 'vitest';
import { venue, zone } from '../fixtures';
import type { ZoneSchedule } from '../types';
import { blockPieces, firstName, loadSchedules, parseClock, toClock, venuesAfterChoices, versionsFor } from './scheduleLogic';

const schedule = (zoneId: string, version: number): ZoneSchedule => ({ zone_id: zoneId, version, dayparts: [] });

describe('schedule board helpers (BZ-0453-10)', () => {
  it('reads 24 hour clocks, including overnight ends past 24:00', () => {
    expect(parseClock('18:30')).toBe(1110);
    expect(parseClock('26:00')).toBe(1560);
    expect(parseClock('7:5')).toBeNull();
    expect(parseClock('12:60')).toBeNull();
    expect(toClock(1110)).toBe('18:30');
  });

  it('splits an overnight block at midnight into two pieces', () => {
    expect(blockPieces({ id: 'a', name: 'Lunch', start: 720, end: 900, energy: 'steady' })).toEqual([{ left: 50, width: 12.5 }]);
    const late = blockPieces({ id: 'b', name: 'Late', start: 1320, end: 1560, energy: 'peak' });
    expect(late).toHaveLength(2);
    expect(late[1].left).toBe(0);
    expect(late[1].width).toBeCloseTo(100 / 12);
  });

  it('sends the version of every zone in the chosen venues only', () => {
    const venues = [venue('a', 'A', { zones: [zone('a', 'a1', 'Bar')] }), venue('b', 'B', { zones: [zone('b', 'b1', 'Bar')] })];
    expect(versionsFor(['a'], venues, { a1: schedule('a1', 4), b1: schedule('b1', 9) })).toEqual({ a1: 4 });
  });

  it('drops the venues where the person kept the other version', () => {
    const preview = { venues: 3, open_now: 1, conflicts: [
      { venue_id: 'b', zone_id: 'b1', updated_by: 'Sam Manager', updated_at: 0, theirs: [], ours: [] },
      { venue_id: 'c', zone_id: 'c1', updated_by: 'Ana', updated_at: 0, theirs: [], ours: [] },
    ] };
    expect(venuesAfterChoices(['a', 'b', 'c'], preview, { b: 'theirs' })).toEqual(['a', 'c']);
    expect(firstName('Sam Manager')).toBe('Sam');
    expect(firstName(null)).toBe('someone');
  });

  it('loads schedules a few at a time and skips a zone that fails', async () => {
    let open = 0;
    let peak = 0;
    const client = { schedule: vi.fn(async (id: string) => {
      open += 1; peak = Math.max(peak, open);
      await new Promise((done) => setTimeout(done, 1));
      open -= 1;
      if (id === 'z3') throw new Error('down');
      return schedule('', 1);
    }) };
    const ids = Array.from({ length: 10 }, (_, index) => `z${index}`);
    const found = await loadSchedules(client as never, ids, 3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(Object.keys(found)).toHaveLength(9);
    expect(found.z0.zone_id).toBe('z0');
  });
});
