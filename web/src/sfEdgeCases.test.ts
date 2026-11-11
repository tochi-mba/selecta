// SF-0245-06: tiny counts and missing values read as what they are. Long, right-to-left and zoomed
// text is covered in the browser (finishing.e2e.ts, mp-0275-typography.e2e.ts).
import { describe, expect, it } from 'vitest';
import { clock, gb, length, nth } from './lib';
import { plural } from './lucy/words';

describe('content edge cases', () => {
  it('a mix of a few seconds is not called 0 minutes, and an empty one is', () => {
    expect(length(20)).toBe('under 1 min');
    expect(length(0)).toBe('0 min');
    expect(length(60)).toBe('1 min');
    expect(length(3600)).toBe('1 hr');
  });

  it('a missing or impossible time shows a dash, never NaN or a negative', () => {
    expect(clock(null)).toBe('–:––');
    expect(clock(undefined)).toBe('–:––');
    expect(clock(Number.NaN)).toBe('–:––');
    expect(clock(-3)).toBe('0:00');
  });

  it('one is singular, and zero and many are plural', () => {
    expect(plural(0, 'song')).toBe('0 songs');
    expect(plural(1, 'song')).toBe('1 song');
    expect(plural(2, 'song')).toBe('2 songs');
  });

  it('small sizes and the teens read correctly', () => {
    expect(gb(0)).toBe('0.0 GB');
    expect(nth(1)).toBe('1st');
    expect(nth(11)).toBe('11th');
    expect(nth(12)).toBe('12th');
    expect(nth(13)).toBe('13th');
    expect(nth(22)).toBe('22nd');
  });
});
