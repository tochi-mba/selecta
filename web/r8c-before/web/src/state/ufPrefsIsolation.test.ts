import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefs, setPrefs } from './prefs';

/** UF-0385-08: theme, density and motion are interface-only. Changing them sends nothing to the server
 * and writes no stored mix, draft, Studio or player state, only the one browser preferences entry. */
describe('UF-0385-08 interface settings stay isolated', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('changes theme, density and motion without a request or any other stored state', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    window.localStorage.setItem('selecta.recentDraft', JSON.stringify({ id: 3, order: '1,2' }));
    window.localStorage.setItem('selecta.lucy.unsent.new', 'keep me');
    const before = new Map(Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)]));

    setPrefs({ theme: 'dark' });
    setPrefs({ density: 'compact' });
    setPrefs({ motion: 'expressive' });
    setPrefs({ theme: 'light', density: 'comfortable', motion: 'still' });

    expect(fetch).not.toHaveBeenCalled();
    expect(prefs()).toMatchObject({ theme: 'light', density: 'comfortable', motion: 'still' });
    const changed = Object.keys(window.localStorage).filter((key) => before.get(key) !== window.localStorage.getItem(key));
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatch(/pref/i);
    for (const [key, value] of before) expect(window.localStorage.getItem(key)).toBe(value);
    expect(document.documentElement.dataset.motion).toBe('still');
    expect(document.documentElement.dataset.density).toBe('comfortable');
  });
});
