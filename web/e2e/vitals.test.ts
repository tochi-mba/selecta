import { describe, expect, it } from 'vitest';
import { BUDGETS, clsOf, inpOf, LAB_KIND, overBudget } from './vitals';

describe('P0136 / SF-0235-02 lab vitals arithmetic', () => {
  it('counts each interaction once, at its longest entry, and ignores entries without one', () => {
    const result = inpOf([
      { id: 1, duration: 40, name: 'pointerdown' },
      { id: 1, duration: 120, name: 'click' },
      { id: 2, duration: 80, name: 'keydown' },
      { id: 0, duration: 900, name: 'mousemove' },
    ]);
    expect(result.interactions).toBe(2);
    expect(result.inpMs).toBe(120);
    expect(result.worst?.name).toBe('click');
  });

  it('ignores one slowest interaction per 50, as the 98th percentile rule does', () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, duration: index + 1 }));
    // 100 interactions: the two slowest (100, 99) are set aside, so INP is the third slowest
    expect(inpOf(entries).inpMs).toBe(98);
    expect(inpOf(entries.slice(0, 49)).inpMs).toBe(49);
    expect(inpOf([]).inpMs).toBe(0);
  });

  it('takes the largest session window of layout shifts', () => {
    // two shifts close together form one window; a gap of a second or more starts a new one
    expect(clsOf([{ start: 0, value: 0.03 }, { start: 500, value: 0.04 }, { start: 2000, value: 0.05 }])).toBe(0.07);
    // a window never runs past five seconds, however close the shifts are
    const steady = Array.from({ length: 12 }, (_, index) => ({ start: index * 900, value: 0.01 }));
    expect(clsOf(steady)).toBe(0.06);
    expect(clsOf([])).toBe(0);
  });

  it('names every missed budget and passes a reading inside all of them', () => {
    const inside = { surface: '/listen', inpMs: 120, interactions: 4, worst: 'click', cls: 0.02, lcpMs: 900 };
    expect(overBudget(inside)).toEqual([]);
    const misses = overBudget({ ...inside, inpMs: BUDGETS.inpMs + 1, cls: 0.2, lcpMs: 3000 });
    expect(misses).toHaveLength(3);
    expect(misses[0]).toContain('INP 201 ms');
    expect(LAB_KIND).toMatch(/not field/);
  });
});
