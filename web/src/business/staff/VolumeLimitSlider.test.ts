import { describe, expect, it } from 'vitest';
import { detentsBelow, settleOnDetent } from './VolumeLimitSlider';

// The volume limit's detents (ADR-0477 plan 3.14): a dragged level near a quarter, a half or three
// quarters lands on it, and no detent sits at or above the venue's cap.
describe('volume detents', () => {
  it('only offers detents below the cap', () => {
    expect(detentsBelow(100)).toEqual([25, 50, 75]);
    expect(detentsBelow(70)).toEqual([25, 50]);
    expect(detentsBelow(50)).toEqual([25]);
  });

  it('settles a level within two steps of a detent onto it', () => {
    expect(settleOnDetent(48, 100)).toBe(50);
    expect(settleOnDetent(52, 100)).toBe(50);
    expect(settleOnDetent(27, 100)).toBe(25);
  });

  it('leaves other levels where they are', () => {
    expect(settleOnDetent(47, 100)).toBe(47);
    expect(settleOnDetent(60, 100)).toBe(60);
    // a cap of 70 has no detent at 75, so a level near the cap stays put
    expect(settleOnDetent(69, 70)).toBe(69);
  });
});
