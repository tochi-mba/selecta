import { useSyncExternalStore } from 'react';

/** Choices about how the app looks, kept in this browser. None of them touch music, mixes or the
 * server, so turning any of them back is always safe, and a browser that can't store them just goes
 * back to the defaults next time. */

export type Theme = 'system' | 'light' | 'dark';

export type Prefs = {
  /** Light, dark, or whatever this computer is set to. */
  theme: Theme;
  railCollapsed: boolean;
  density: 'comfortable' | 'compact';
  /** Ctrl or Cmd K. Everything it does has an ordinary way to do it too. */
  palette: boolean;
  /** Keys like N and M with no Ctrl held. Speech input can set them off by accident, so they can be off. */
  singleKeys: boolean;
  /** The kill switch: the older navigation labels and grouping, over exactly the same pages. */
  classicNav: boolean;
};

export const DEFAULT_PREFS: Prefs = { theme: 'system', railCollapsed: false, density: 'comfortable', palette: true, singleKeys: true, classicNav: false };

/** What the browser's own title bar should be, matching each theme's background in tokens.css. */
const BAR_COLOUR = { dark: '#100f0c', light: '#f5f2e9' };

const KEY = 'selecta.prefs';
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system',
      railCollapsed: saved.railCollapsed === true,
      density: saved.density === 'compact' ? 'compact' : 'comfortable',
      palette: saved.palette !== false,
      singleKeys: saved.singleKeys !== false,
      classicNav: saved.classicNav === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

let current: Prefs | null = null;

export function prefs(): Prefs {
  current ??= read();
  return current;
}

function apply(next: Prefs) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.density = next.density;
  if (next.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = next.theme;
  for (const bar of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = bar.media.includes('light') ? BAR_COLOUR.light : BAR_COLOUR.dark;
    bar.content = next.theme === 'system' ? own : BAR_COLOUR[next.theme];
  }
}

export function setPrefs(change: Partial<Prefs>) {
  const next = { ...prefs(), ...change };
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // it holds until the page is closed, and that's all
  }
  apply(next);
  for (const listener of listeners) listener();
}

/** For the tests, and for anything that changed storage behind this store's back. */
export function reloadPrefs() {
  current = read();
  apply(current);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function storageChanged(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return;
  current = read();
  apply(current);
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') window.addEventListener('storage', storageChanged);

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, prefs);
}

const SYSTEM_LIGHT = '(prefers-color-scheme: light)';

function subscribeToSystem(listener: () => void) {
  const media = window.matchMedia?.(SYSTEM_LIGHT);
  media?.addEventListener('change', listener);
  const unsubscribe = subscribe(listener);
  return () => {
    media?.removeEventListener('change', listener);
    unsubscribe();
  };
}

/** Which theme is really showing right now, whichever way it was chosen. */
export function useShownTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeToSystem, () => {
    const { theme } = prefs();
    if (theme !== 'system') return theme;
    return window.matchMedia?.(SYSTEM_LIGHT).matches ? 'light' : 'dark';
  });
}

/** `?ui=classic` in the address turns the older navigation on, and `?ui=new` turns it off, even when
 * the page is too broken to reach the setting. */
export function readFlagFromAddress(search: string) {
  const asked = new URLSearchParams(search).get('ui');
  if (asked === 'classic') setPrefs({ classicNav: true });
  else if (asked === 'new') setPrefs({ classicNav: false });
}

apply(prefs());
