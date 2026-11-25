import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { feelOff } from '../test/feel';
import { flyInto } from './flight';

/** Plan 3.9: an example prompt's copy flies into the box only with the feel's motion on. The words
 * are put in the box by the caller; this never decides that, and draws nothing when calm. */

function box(left: number, top: number) {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => ({ left, top, width: 200, height: 32, right: left + 200, bottom: top + 32, x: left, y: top, toJSON: () => ({}) });
  document.body.appendChild(element);
  return element;
}

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => { frames.push(run); return frames.length; });
  localStorage.clear();
  reloadPrefs();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe('flyInto', () => {
  it('draws a hidden, unpressable copy that travels to the box and is removed when it lands', () => {
    const finished: { onfinish: (() => void) | null; oncancel: (() => void) | null }[] = [];
    (Element.prototype as { animate?: unknown }).animate = vi.fn(() => {
      const flight = { onfinish: null, oncancel: null };
      finished.push(flight);
      return flight;
    });
    const from = box(10, 400);
    const to = box(10, 600);
    flyInto(from, () => to, 'Something mellow for Sunday');
    frames.forEach((run) => run(0));
    const ghost = document.querySelector('.lucy-flight');
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(ghost).toHaveTextContent('Something mellow for Sunday');
    finished[0].onfinish?.();
    expect(document.querySelector('.lucy-flight')).toBeNull();
  });

  it('draws nothing with the feel off or on Still', () => {
    (Element.prototype as { animate?: unknown }).animate = vi.fn();
    feelOff();
    flyInto(box(0, 0), () => box(0, 100), 'one');
    frames.forEach((run) => run(0));
    expect(document.querySelector('.lucy-flight')).toBeNull();
    setFlags({});
    setPrefs({ motion: 'still' });
    flyInto(box(0, 0), () => box(0, 100), 'two');
    frames.forEach((run) => run(0));
    expect(document.querySelector('.lucy-flight')).toBeNull();
  });
});
