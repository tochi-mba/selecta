import { useSyncExternalStore } from 'react';

/** Choices about how the app looks, kept in this browser. None of them touch music, mixes or the
 * server, so turning any of them back is always safe, and a browser that can't store them just goes
 * back to the defaults next time. */

export type Theme = 'system' | 'light' | 'dark';
export type Motion = 'still' | 'subtle' | 'expressive';

export type Prefs = {
  /** Light, dark, or whatever this computer is set to. */
  theme: Theme;
  /** Browser-only visual motion; reduced-motion OS setting always wins. */
  motion: Motion;
  railCollapsed: boolean;
  density: 'comfortable' | 'compact';
  /** Library presentation only. Both views have exactly the same available song actions. */
  libraryLayout: 'list' | 'cards';
  /** Ctrl or Cmd K. Everything it does has an ordinary way to do it too. */
  palette: boolean;
  /** Keys like N and M with no Ctrl held. Speech input can set them off by accident, so they can be off. */
  singleKeys: boolean;
  /** The kill switch: the older navigation labels and grouping, over exactly the same pages. */
  classicNav: boolean;
  /** The small ? beside music terms. Off hides only those optional hints, never a warning or status. */
  termHints: boolean;
};

export const DEFAULT_PREFS: Prefs = { theme: 'system', motion: 'subtle', railCollapsed: false, density: 'comfortable', libraryLayout: 'list', palette: true, singleKeys: true, classicNav: false, termHints: true };

/** What the browser's own title bar should be, matching each theme's background in tokens.css. */
const BAR_COLOUR = { dark: '#100f0c', light: '#f5f2e9' };

const KEY = 'selecta.prefs';
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const saved = (JSON.parse(window.localStorage.getItem(KEY) ?? '{}') ?? {}) as Partial<Prefs>;
    // A value the person chose is kept; anything missing or unknown reads as DEFAULT_PREFS, the one
    // place each default is written (docs/saas/11-ui-ux.md "Defaults").
    const pick = <K extends keyof Prefs>(key: K, allowed: readonly Prefs[K][]): Prefs[K] =>
      allowed.includes(saved[key] as Prefs[K]) ? saved[key] as Prefs[K] : DEFAULT_PREFS[key];
    const flag = (key: 'railCollapsed' | 'palette' | 'singleKeys' | 'classicNav' | 'termHints') =>
      typeof saved[key] === 'boolean' ? saved[key] as boolean : DEFAULT_PREFS[key];
    return {
      theme: pick('theme', ['system', 'light', 'dark']),
      motion: pick('motion', ['still', 'subtle', 'expressive']),
      railCollapsed: flag('railCollapsed'),
      density: pick('density', ['comfortable', 'compact']),
      libraryLayout: pick('libraryLayout', ['list', 'cards']),
      palette: flag('palette'),
      singleKeys: flag('singleKeys'),
      classicNav: flag('classicNav'),
      termHints: flag('termHints'),
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
  root.dataset.motion = next.motion;
  if (next.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = next.theme;
  for (const bar of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = (bar.getAttribute('media') ?? '').includes('light') ? BAR_COLOUR.light : BAR_COLOUR.dark;
    bar.content = next.theme === 'system' ? own : BAR_COLOUR[next.theme];
  }
}

export function setPrefs(change: Partial<Prefs>) {
  const next = { ...prefs(), ...change };
  current = next;
  try {
    // SF-0241-04: keep choices this build doesn't know (a newer build's), so rolling back and
    // forward again loses none of them
    let stored: unknown = null;
    try {
      stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    } catch {
      stored = null;
    }
    const kept = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    // Only what the person chose is stored, never the defaults around it, so a better default
    // later reaches everyone who never chose that setting.
    window.localStorage.setItem(KEY, JSON.stringify({ ...kept, ...change }));
  } catch {
    // it holds until the page is closed, and that's all
  }
  apply(next);
  for (const listener of listeners) listener();
}

/** The settings this browser has away from their defaults, for "Reset to defaults" to list. */
export function changedPrefs(): (keyof Prefs)[] {
  const now = prefs();
  return (Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]).filter((key) => now[key] !== DEFAULT_PREFS[key]);
}

/** Every setting back to DEFAULT_PREFS: the person's choices are forgotten (a newer build's
 * unknown choices are kept, as setPrefs keeps them). */
export function resetPrefs() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    const kept = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
    for (const key of Object.keys(DEFAULT_PREFS)) delete kept[key];
    window.localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // nothing stored to forget
  }
  current = { ...DEFAULT_PREFS };
  apply(current);
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

/** Told whenever a preference changes, for work outside React. Returns a way to stop being told. */
export const onPrefsChange = subscribe;

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
