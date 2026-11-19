import { describe, expect, it } from 'vitest';
import { NOW, venue, zone } from '../fixtures';
import { zoneWords } from './ZoneStatus';

describe('closed zone words (ADR-0453 D7)', () => {
  const bar = zone('soho', 'soho-bar', 'Bar', { state: 'closed' });

  it('gives the time alone when the venue opens within a day', () => {
    const soon = venue('soho', 'Soho', { open_now: false, next_open_at: NOW + 3600 });
    expect(zoneWords('closed', bar, soon, NOW)).toMatch(/^Closed\. Opens \d\d:\d\d/);
  });

  it('names the weekday when the next opening is a later day', () => {
    const later = venue('soho', 'Soho', { open_now: false, next_open_at: NOW + 2 * 86_400 });
    expect(zoneWords('closed', bar, later, NOW)).toBe('Closed. Opens Mon 14:30');
  });
});
