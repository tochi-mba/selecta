import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadPrefs, setPrefs, useShownTheme } from './prefs';

/** FP-0265-01/04/05/06 (ADR-0265): which theme is shown, and what the browser's own chrome is told,
 * for every saved choice against every OS setting, including a browser that can't store anything. */

const DARK_BAR = '#100f0c';
const LIGHT_BAR = '#f5f2e9';

let osLight = false;
const listeners = new Set<() => void>();

function flipOs(light: boolean) {
  osLight = light;
  for (const listener of [...listeners]) listener();
}

beforeEach(() => {
  osLight = false;
  listeners.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('light') ? osLight : false; },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${DARK_BAR}">
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="${LIGHT_BAR}">`;
});

afterEach(() => {
  document.head.innerHTML = '';
  delete document.documentElement.dataset.theme;
  reloadPrefs();
});

const bars = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((bar) => bar.content);

describe('resolved theme precedence (truth table)', () => {
  const table = [
    // saved choice, OS light?, shown theme, data-theme on <html>, [dark-media bar, light-media bar]
    { saved: 'system', os: false, shown: 'dark', attr: undefined, chrome: [DARK_BAR, LIGHT_BAR] },
    { saved: 'system', os: true, shown: 'light', attr: undefined, chrome: [DARK_BAR, LIGHT_BAR] },
    { saved: 'light', os: false, shown: 'light', attr: 'light', chrome: [LIGHT_BAR, LIGHT_BAR] },
    { saved: 'light', os: true, shown: 'light', attr: 'light', chrome: [LIGHT_BAR, LIGHT_BAR] },
    { saved: 'dark', os: false, shown: 'dark', attr: 'dark', chrome: [DARK_BAR, DARK_BAR] },
    { saved: 'dark', os: true, shown: 'dark', attr: 'dark', chrome: [DARK_BAR, DARK_BAR] },
    // anything unreadable falls back to following the OS, the documented safe default
    { saved: 'purple', os: true, shown: 'light', attr: undefined, chrome: [DARK_BAR, LIGHT_BAR] },
    { saved: undefined, os: false, shown: 'dark', attr: undefined, chrome: [DARK_BAR, LIGHT_BAR] },
  ] as const;

  for (const row of table) {
    it(`saved ${row.saved ?? 'nothing'} with the OS ${row.os ? 'light' : 'dark'} shows ${row.shown}`, () => {
      osLight = row.os;
      localStorage.setItem('selecta.prefs', JSON.stringify(row.saved === undefined ? {} : { theme: row.saved }));
      reloadPrefs();
      const { result } = renderHook(() => useShownTheme());
      expect(result.current).toBe(row.shown);
      expect(document.documentElement.dataset.theme).toBe(row.attr);
      // the system-mode bars keep their own media queries, so the browser picks the OS's one
      expect(bars()).toEqual(row.chrome);
    });
  }

  it('storage that refuses to be read follows the OS, and a choice still holds until the page closes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    osLight = true;
    reloadPrefs();
    const { result } = renderHook(() => useShownTheme());
    expect(result.current).toBe('light');
    act(() => setPrefs({ theme: 'dark' }));
    expect(result.current).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(bars()).toEqual([DARK_BAR, DARK_BAR]);
  });
});

describe('runtime changes', () => {
  it('a manual choice repaints the chrome at once, without a reload (FP-0265-04)', () => {
    reloadPrefs();
    act(() => setPrefs({ theme: 'light' }));
    expect(bars()).toEqual([LIGHT_BAR, LIGHT_BAR]);
    act(() => setPrefs({ theme: 'dark' }));
    expect(bars()).toEqual([DARK_BAR, DARK_BAR]);
    act(() => setPrefs({ theme: 'system' }));
    expect(bars()).toEqual([DARK_BAR, LIGHT_BAR]);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('System follows the OS as it changes (FP-0265-05)', () => {
    reloadPrefs();
    const { result } = renderHook(() => useShownTheme());
    expect(result.current).toBe('dark');
    act(() => flipOs(true));
    expect(result.current).toBe('light');
    act(() => flipOs(false));
    expect(result.current).toBe('dark');
  });

  it('an OS change never overrides an explicit Light or Dark while the app is open (FP-0265-06)', () => {
    reloadPrefs();
    for (const theme of ['light', 'dark'] as const) {
      act(() => setPrefs({ theme }));
      const { result, unmount } = renderHook(() => useShownTheme());
      for (const os of [true, false, true]) {
        act(() => flipOs(os));
        expect(result.current).toBe(theme);
        expect(document.documentElement.dataset.theme).toBe(theme);
        expect(bars()).toEqual(theme === 'light' ? [LIGHT_BAR, LIGHT_BAR] : [DARK_BAR, DARK_BAR]);
      }
      expect(JSON.parse(localStorage.getItem('selecta.prefs') ?? '{}').theme).toBe(theme);
      unmount();
    }
  });
});
