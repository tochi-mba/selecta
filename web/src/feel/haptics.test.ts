import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { success, tap, tick, warn } from './haptics';

/** FL-0477-06: a buzz only where every condition holds: the flag, the person's setting, a touch
 * screen, a browser that can vibrate, and a press happening right now. Otherwise a no-op. */

let vibrate: ReturnType<typeof vi.fn>;
let active = true;
let coarse = true;

function define(name: string, value: unknown) {
  Object.defineProperty(navigator, name, { configurable: true, value });
}

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  active = true;
  coarse = true;
  vibrate = vi.fn(() => true);
  define('vibrate', vibrate);
  Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ isActive: active }) });
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: coarse && query === '(pointer: coarse)', addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  delete (navigator as { vibrate?: unknown }).vibrate;
  delete (navigator as { userActivation?: unknown }).userActivation;
});

describe('FL-0477-06 haptics', () => {
  it('buzzes a short pattern for each kind when everything holds', () => {
    tap();
    tick();
    success();
    warn();
    expect(vibrate.mock.calls.map(([pattern]) => pattern)).toEqual([[8], [4], [10, 40, 14], [18, 60, 18]]);
  });

  it('does nothing with the flag off', () => {
    setFlags({ 'app.feel_haptics': false });
    tap();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing when the person turned it off', () => {
    setPrefs({ haptics: false });
    tap();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing on a computer with a fine pointer', () => {
    coarse = false;
    tap();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing outside a press, or where the browser cannot say', () => {
    active = false;
    tap();
    expect(vibrate).not.toHaveBeenCalled();
    delete (navigator as { userActivation?: unknown }).userActivation;
    tap();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing, and never throws, where the browser cannot vibrate', () => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    expect(() => tap()).not.toThrow();
    define('vibrate', () => { throw new Error('refused'); });
    expect(() => success()).not.toThrow();
  });
});
