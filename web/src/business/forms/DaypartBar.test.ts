import { describe, expect, it } from 'vitest';
import { boundaryAt } from './DaypartBar';

// Dragging a boundary snaps to 15-minute steps and never passes its neighbours (ADR-0477 plan 3.14).
describe('boundaryAt', () => {
  const day = 1440;

  it('lands on the nearest 15-minute step', () => {
    // 400 px wide showing a whole day: 100 px is 6:00, 101 px rounds to 6:00, 103 px to 6:15
    expect(boundaryAt(100, 400, day, 0, day)).toBe(360);
    expect(boundaryAt(101, 400, day, 0, day)).toBe(360);
    expect(boundaryAt(103, 400, day, 0, day)).toBe(375);
  });

  it('stays inside its limits', () => {
    expect(boundaryAt(-50, 400, day, 600, 900)).toBe(600);
    expect(boundaryAt(500, 400, day, 600, 900)).toBe(900);
  });

  it('falls back to the lower limit on a bar with no width', () => {
    expect(boundaryAt(10, 0, day, 600, 900)).toBe(600);
  });
});
