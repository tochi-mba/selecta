import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NOW, venue, zone } from '../fixtures';
import type { Venue } from '../types';
import { arrangeVenues, DEFAULT_OPTIONS } from './consoleLogic';
import { VenueHealthGrid } from './VenueHealthGrid';

// 500 venues (ADR-0453 BZ-0453-08): sort and search stay under 100 ms, and the grid draws only
// the rows in view (fixed-height windowing), with the full count in aria-rowcount.

function many(count: number): Venue[] {
  return Array.from({ length: count }, (_, index) => venue(`v${index}`, `Venue ${String(index).padStart(3, '0')}`, {
    region: index % 2 ? 'London' : 'Manchester',
    zones: [zone(`v${index}`, `v${index}-bar`, 'Bar', { state: index % 7 === 0 ? 'silent' : 'playing', state_since: NOW - 600 })],
  }));
}

describe('VenueHealthGrid with 500 venues', () => {
  it('sorts and searches under 100 ms', () => {
    const venues = many(500);
    arrangeVenues(venues, DEFAULT_OPTIONS, NOW); // warm the JIT once
    for (const options of [DEFAULT_OPTIONS, { ...DEFAULT_OPTIONS, sort: 'name' as const }, { ...DEFAULT_OPTIONS, sort: 'region' as const }, { ...DEFAULT_OPTIONS, query: 'venue 4' }]) {
      const started = performance.now();
      const rows = arrangeVenues(venues, options, NOW);
      expect(performance.now() - started).toBeLessThan(100);
      expect(rows.length).toBeGreaterThan(0);
    }
    expect(arrangeVenues(venues, { ...DEFAULT_OPTIONS, query: 'venue 499' }, NOW).map((v) => v.id)).toEqual(['v499']);
  });

  it('renders only the rows in view and names the full count', () => {
    render(<VenueHealthGrid venues={many(500)} now={NOW} />);
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-rowcount', '501');
    expect(screen.getAllByRole('row').length).toBeLessThan(20);
  });
});
