import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { feelCalm, feelOn, feelParts, onFeelChange, resetFeel, startFeel } from './root';

/** FL-0477-01 and FL-0477-05: `<html data-feel>` is the one switchboard. Its words follow the
 * flags and the motion choice, and every calm setting takes the moving parts away. */

const html = document.documentElement;
const words = () => (html.dataset.feel ?? '').split(' ').filter(Boolean);

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: on && query.includes('prefers-reduced-motion'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  resetFeel();
  delete html.dataset.lowPower;
});

afterEach(() => {
  resetFeel();
  delete html.dataset.lowPower;
  vi.unstubAllGlobals();
});

describe('FL-0477-01 data-feel follows the flags and the motion choice', () => {
  it('writes every part on Expressive with every flag on, in a fixed order', () => {
    setPrefs({ motion: 'expressive' });
    const stop = startFeel();
    expect(words()).toEqual(['motion', 'depth', 'pointer', 'music', 'ambient', 'moments']);
    expect(feelParts()).toEqual(words());
    stop();
  });

  it('starts on Expressive by default while app.feel_motion is on', () => {
    const stop = startFeel();
    expect(words()).toContain('moments');
    stop();
  });

  it('drops a part whose flag is off, and writes nothing at all when every flag is off', () => {
    setPrefs({ motion: 'expressive' });
    const stop = startFeel();
    setFlags({ 'app.feel_depth': false });
    expect(words()).not.toContain('depth');
    expect(words()).toContain('motion');
    setFlags({
      'app.feel_motion': false, 'app.feel_depth': false, 'app.feel_pointer_light': false,
      'app.feel_music': false, 'app.feel_ambient': false, 'app.feel_moments': false,
    });
    expect(html.hasAttribute('data-feel')).toBe(false);
    stop();
  });

  it('keeps pointer and moments for Expressive only', () => {
    setPrefs({ motion: 'subtle' });
    const stop = startFeel();
    expect(words()).toEqual(['motion', 'depth', 'music', 'ambient']);
    expect(feelOn('pointer')).toBe(false);
    expect(feelOn('moments')).toBe(false);
    stop();
  });

  it('Still takes every moving part away and keeps depth and the ambient tint', () => {
    setPrefs({ motion: 'still' });
    const stop = startFeel();
    expect(words()).toEqual(['depth', 'ambient']);
    expect(feelCalm()).toBe(true);
    stop();
  });

  it('the computer asking for reduced motion does the same as Still', () => {
    reducedMotion(true);
    setPrefs({ motion: 'expressive' });
    const stop = startFeel();
    expect(feelCalm()).toBe(true);
    expect(words()).toEqual(['depth', 'ambient']);
    stop();
  });

  it('low power `auto` is calm: nothing moves and nothing costly is drawn', () => {
    setPrefs({ motion: 'expressive' });
    html.dataset.lowPower = 'auto';
    const stop = startFeel();
    expect(feelCalm()).toBe(true);
    expect(words()).toEqual(['depth']);
    stop();
  });

  it('low power `lite` drops the pointer light, music and ambient, and keeps the rest', () => {
    setPrefs({ motion: 'expressive' });
    html.dataset.lowPower = 'lite';
    const stop = startFeel();
    expect(feelCalm()).toBe(false);
    expect(words()).toEqual(['motion', 'depth', 'moments']);
    stop();
  });
});

describe('FL-0477-01 startFeel and onFeelChange', () => {
  it('rewrites data-feel when the motion choice, a flag or low power changes', async () => {
    setPrefs({ motion: 'expressive' });
    const stop = startFeel();
    setPrefs({ motion: 'still' });
    expect(words()).toEqual(['depth', 'ambient']);
    setPrefs({ motion: 'expressive' });
    setFlags({ 'app.feel_music': false });
    expect(words()).not.toContain('music');
    html.dataset.lowPower = 'lite';
    await flush();
    expect(words()).toEqual(['motion', 'depth', 'moments']);
    stop();
  });

  it('is reference counted: watching ends only when the last start is stopped', () => {
    setPrefs({ motion: 'expressive' });
    const first = startFeel();
    const second = startFeel();
    first();
    first(); // a second call of the same stop changes nothing
    setPrefs({ motion: 'still' });
    expect(words()).toEqual(['depth', 'ambient']);
    second();
    setPrefs({ motion: 'expressive' });
    // nobody is watching now, so the attribute keeps what it last said
    expect(words()).toEqual(['depth', 'ambient']);
  });

  it('tells listeners when the parts change, and stops telling one that let go', () => {
    setPrefs({ motion: 'expressive' });
    const stop = startFeel();
    const heard = vi.fn();
    const off = onFeelChange(heard);
    setPrefs({ motion: 'subtle' });
    expect(heard).toHaveBeenCalledTimes(1);
    // the same parts again: no news
    setPrefs({ motion: 'subtle' });
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    setPrefs({ motion: 'still' });
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });
});
