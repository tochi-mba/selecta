import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { flashOnce } from './flashOnce';
import { resetFeel, startFeel } from './root';

/** T-20261125-4001: a one-shot glow never outlives itself. Turning motion off mid-glow stops the
 * sheet's animation without an animationend, and a class left behind would glow again, unprompted,
 * when motion came back. */

let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  reloadPrefs();
  setPrefs({ motion: 'expressive' });
  resetFeel();
  stop = startFeel();
});

afterEach(() => {
  stop();
  resetFeel();
  vi.useRealTimers();
});

function row() {
  const element = document.createElement('li');
  document.body.append(element);
  return element;
}

describe('flashOnce', () => {
  it('goes on animationend of the row itself, not of a child', () => {
    const element = row();
    const child = document.createElement('span');
    element.append(child);
    flashOnce(element);
    expect(element.classList.contains('feel-flash')).toBe(true);
    child.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(element.classList.contains('feel-flash')).toBe(true);
    element.dispatchEvent(new Event('animationend'));
    expect(element.classList.contains('feel-flash')).toBe(false);
  });

  it('goes at once when motion turns off mid-glow, and does not come back with it', () => {
    const element = row();
    flashOnce(element);
    setPrefs({ motion: 'still' });
    expect(element.classList.contains('feel-flash')).toBe(false);
    setPrefs({ motion: 'expressive' });
    expect(element.classList.contains('feel-flash')).toBe(false);
  });

  it('goes after its own length when no animationend ever arrives', () => {
    const element = row();
    flashOnce(element);
    vi.advanceTimersByTime(10_000);
    expect(element.classList.contains('feel-flash')).toBe(false);
  });

  it('a second glow is not cut short by the first one’s timer', () => {
    const element = row();
    flashOnce(element);
    vi.advanceTimersByTime(1000);
    flashOnce(element);
    vi.advanceTimersByTime(800);
    expect(element.classList.contains('feel-flash')).toBe(true);
  });
});
