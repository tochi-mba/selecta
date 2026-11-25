import { afterEach, describe, expect, it } from 'vitest';
import { setFlags } from '../flags';
import { changedPrefs, DEFAULT_PREFS, prefs, reloadPrefs, resetPrefs, setPrefs } from './prefs';

// Area K (product audit): one constant per default, a missing value reads as the default, a
// stored choice is never rewritten, only choices are stored, and Reset restores the constants.

const KEY = 'selecta.prefs';
afterEach(() => { localStorage.clear(); reloadPrefs(); });

describe('interface defaults', () => {
  it('a brand new browser reads exactly DEFAULT_PREFS', () => {
    localStorage.clear();
    reloadPrefs();
    expect(prefs()).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.theme).toBe('system'); // follows the OS until chosen
    // ADR-0477: Expressive while the feel system is on, Subtle (as before) when it is off
    expect(DEFAULT_PREFS.motion).toBe('expressive');
    setFlags({ 'app.feel_motion': false });
    expect(DEFAULT_PREFS.motion).toBe('subtle');
    expect(prefs().motion).toBe('subtle');
    setFlags(null);
    expect(prefs().motion).toBe('expressive');
  });

  it('an old stored choice is kept, and an unknown value reads as the default', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'light', motion: 'loud', density: 'compact' }));
    reloadPrefs();
    expect(prefs()).toEqual({ ...DEFAULT_PREFS, theme: 'light', density: 'compact' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ theme: 'light', motion: 'loud', density: 'compact' });
  });

  it('stores only what the person chose, so a later default reaches everyone else', () => {
    setPrefs({ density: 'compact' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ density: 'compact' });
    expect(changedPrefs()).toEqual(['density']);
  });

  it('Reset to defaults restores exactly the constants and keeps a newer build’s unknown choices', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark', palette: false, fromNewerBuild: 1 }));
    reloadPrefs();
    resetPrefs();
    expect(prefs()).toEqual(DEFAULT_PREFS);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ fromNewerBuild: 1 });
    expect(changedPrefs()).toEqual([]);
  });
});
