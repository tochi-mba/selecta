// SF-0241-04: preferences survive old to new to old. The older build here is the Flow baseline
// (c3715b14), whose prefs reader and writer are pinned below exactly as they were: it knows theme,
// density and the rest, but not motion. The selected mix lives on the server and is covered by
// tests/rollback_check.py.
import { afterEach, describe, expect, it } from 'vitest';
import { prefs, reloadPrefs, setPrefs } from './prefs';

const KEY = 'selecta.prefs';

/** The baseline build's read(), copied from c3715b14 web/src/state/prefs.ts. */
function baselineRead() {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  return {
    theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system',
    railCollapsed: saved.railCollapsed === true,
    density: saved.density === 'compact' ? 'compact' : 'comfortable',
    libraryLayout: saved.libraryLayout === 'cards' ? 'cards' : 'list',
    palette: saved.palette !== false,
    singleKeys: saved.singleKeys !== false,
    classicNav: saved.classicNav === true,
  };
}

/** The baseline build's setPrefs(): it writes back only what it read, plus the change. */
function baselineSet(change: Partial<ReturnType<typeof baselineRead>>) {
  localStorage.setItem(KEY, JSON.stringify({ ...baselineRead(), ...change }));
}

afterEach(() => {
  localStorage.clear();
  reloadPrefs();
});

describe('preferences across a rollback', () => {
  it('old to new to old keeps the theme and every choice the old build made', () => {
    baselineSet({ theme: 'dark', density: 'compact', classicNav: true });
    reloadPrefs();
    expect(prefs()).toMatchObject({ theme: 'dark', density: 'compact', classicNav: true, motion: 'subtle' });
    setPrefs({ motion: 'still' });
    expect(baselineRead()).toMatchObject({ theme: 'dark', density: 'compact', classicNav: true });
  });

  it('new to old to new keeps motion and theme while the old build only reads', () => {
    setPrefs({ theme: 'light', motion: 'expressive' });
    expect(baselineRead().theme).toBe('light');
    reloadPrefs();
    expect(prefs()).toMatchObject({ theme: 'light', motion: 'expressive' });
  });

  it('a choice only a newer build knows survives this build saving something else', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark', motion: 'still', futureChoice: 'kept' }));
    reloadPrefs();
    setPrefs({ density: 'compact' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ theme: 'dark', motion: 'still', density: 'compact', futureChoice: 'kept' });
  });

  it('saving over storage that is not an object still saves the choice', () => {
    localStorage.setItem(KEY, '[1,2]');
    reloadPrefs();
    setPrefs({ theme: 'dark' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ theme: 'dark', motion: 'subtle' });
  });
});
