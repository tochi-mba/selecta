import { describe, expect, it, vi } from 'vitest';
import { expandSeam, flyFrame, flyInto } from './feelEditor';

// Plan 3.7: a chosen suggestion flies into its gap, and an opened transition's diagram grows into
// the inspector. With the feel off (the default here) both simply let the change happen.

describe('the fly into the gap', () => {
  it('starts from the suggestion, centre to centre, at its size', () => {
    expect(flyFrame({ left: 0, top: 300, width: 200, height: 40 }, { left: 0, top: 100, width: 400, height: 40 }))
      .toBe('translate(-100.0px, 200.0px) scale(0.500, 1.000)');
  });

  it('does nothing when the row is already where the suggestion was', () => {
    expect(flyFrame({ left: 10, top: 10, width: 100, height: 20 }, { left: 10, top: 10, width: 100, height: 20 })).toBeNull();
  });

  it('looks for no row while the motion part is off', () => {
    const find = vi.fn(() => null);
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    flyInto({ left: 0, top: 0, width: 10, height: 10 } as DOMRect, find);
    expect(frame).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    frame.mockRestore();
  });
});

describe('opening a transition', () => {
  it('opens it at once while the motion part is off', () => {
    const update = vi.fn();
    const row = document.createElement('li');
    row.innerHTML = '<div class="music-seam-diagram"></div>';
    expandSeam(row, true, update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('opens it at once when there is no row to grow from', () => {
    const update = vi.fn();
    expandSeam(null, true, update);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
