import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefs, reloadPrefs, setPrefs } from './prefs';

// SF-0238-04: theme and motion live only in this browser. With no network at all they still save,
// survive a reload, and never ask the server for anything.
describe('SF-0238-04 theme and motion stay on this machine', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    reloadPrefs();
  });

  it('offline, a theme and motion choice saves, survives a reload and sends nothing', () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const send = vi.fn();
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => ({ open: send, send })));

    setPrefs({ theme: 'dark', motion: 'still' });
    reloadPrefs(); // as a reload reads it back
    expect(prefs()).toMatchObject({ theme: 'dark', motion: 'still' });
    expect(document.documentElement.dataset.motion).toBe('still');
    expect(JSON.parse(window.localStorage.getItem('selecta.prefs') ?? '{}')).toMatchObject({ theme: 'dark', motion: 'still' });

    setPrefs({ theme: 'light', motion: 'expressive' });
    reloadPrefs();
    expect(prefs()).toMatchObject({ theme: 'light', motion: 'expressive' });

    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
