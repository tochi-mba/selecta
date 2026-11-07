import { useSyncExternalStore } from 'react';

/** Choices about how the app looks, kept in this browser. None of them touch music, mixes or the
 * server, so turning any of them back is always safe, and a browser that can't store them just goes
 * back to the defaults next time. */

export type Prefs = {
  railCollapsed: boolean;
  density: 'comfortable' | 'compact';
  /** Ctrl or Cmd K. Everything it does has an ordinary way to do it too. */
  palette: boolean;
  /** The kill switch: the older navigation labels and grouping, over exactly the same pages. */
  classicNav: boolean;
};

export const DEFAULT_PREFS: Prefs = { railCollapsed: false, density: 'comfortable', palette: true, classicNav: false };

const KEY = 'selecta.prefs';
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      railCollapsed: saved.railCollapsed === true,
      density: saved.density === 'compact' ? 'compact' : 'comfortable',
      palette: saved.palette !== false,
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
  document.documentElement.dataset.density = next.density;
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

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, prefs);
}

/** `?ui=classic` in the address turns the older navigation on, and `?ui=new` turns it off, even when
 * the page is too broken to reach the setting. */
export function readFlagFromAddress(search: string) {
  const asked = new URLSearchParams(search).get('ui');
  if (asked === 'classic') setPrefs({ classicNav: true });
  else if (asked === 'new') setPrefs({ classicNav: false });
}

apply(prefs());
