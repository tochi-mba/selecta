import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { navigate } from '../router';
import { DEFAULT_PREFS, setPrefs } from '../state/prefs';
import { changeScene, sceneTransitionsSupported, sceneTransitionsWanted } from './sceneTransition';

/** SF-0208-07: the optional page cross-fade is feature-detected, and anything unsupported or
 * unwanted gets the instant change it always had. */

type Doc = Document & { startViewTransition?: (update: () => void) => unknown };

function fakeWindow(reduced: boolean): Window {
  return { matchMedia: () => ({ matches: reduced }) } as unknown as Window;
}

describe('optional scene transitions', () => {
  beforeEach(() => {
    setFlags(null);
    setPrefs({ ...DEFAULT_PREFS, motion: 'expressive' });
  });
  afterEach(() => {
    delete (document as Doc).startViewTransition;
    setPrefs(DEFAULT_PREFS);
    setFlags(null);
  });

  it('detects a browser without the View Transitions API and changes the page at once', () => {
    expect(sceneTransitionsSupported(document)).toBe(false);
    const update = vi.fn();
    changeScene(update, document, fakeWindow(false));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('uses the API when the browser has it and Expressive motion is chosen', () => {
    const start = vi.fn((update: () => void) => update());
    (document as Doc).startViewTransition = start;
    expect(sceneTransitionsSupported(document)).toBe(true);
    const update = vi.fn();
    changeScene(update, document, fakeWindow(false));
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('stays instant under reduced motion, Still or Subtle motion, or with the flag off', () => {
    const start = vi.fn((update: () => void) => update());
    (document as Doc).startViewTransition = start;
    expect(sceneTransitionsWanted(fakeWindow(true))).toBe(false);
    setPrefs({ ...DEFAULT_PREFS, motion: 'subtle' });
    expect(sceneTransitionsWanted(fakeWindow(false))).toBe(false);
    setPrefs({ ...DEFAULT_PREFS, motion: 'still' });
    expect(sceneTransitionsWanted(fakeWindow(false))).toBe(false);
    setPrefs({ ...DEFAULT_PREFS, motion: 'expressive' });
    setFlags({ 'app.scene_transitions': false });
    expect(sceneTransitionsWanted(fakeWindow(false))).toBe(false);
    setFlags({ 'app.motion_choice': false });
    expect(sceneTransitionsWanted(fakeWindow(false))).toBe(false);
    const update = vi.fn();
    changeScene(update, document, fakeWindow(false));
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('falls back to an instant change when the browser refuses to start one', () => {
    (document as Doc).startViewTransition = () => { throw new Error('busy'); };
    const update = vi.fn();
    changeScene(update, document, fakeWindow(false));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('changes the address before any animation, so navigation never waits on it', () => {
    let pending: (() => void) | null = null;
    (document as Doc).startViewTransition = (update: () => void) => { pending = update; };
    window.history.replaceState({}, '', '/listen');
    navigate('/library');
    expect(window.location.pathname).toBe('/library');
    expect(pending).not.toBeNull();
    pending!();
    window.history.replaceState({}, '', '/');
  });
});
