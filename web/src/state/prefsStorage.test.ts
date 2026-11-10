// S4-0095-09: malformed, wrongly typed or blocked browser storage can neither crash the app nor
// change what it shows; a choice made while storage is blocked holds for the page's lifetime.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefs, reloadPrefs, setPrefs } from './prefs';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  reloadPrefs();
});

const DEFAULTS = { theme: 'system', motion: 'subtle', density: 'comfortable', libraryLayout: 'list', railCollapsed: false };

describe('saved preferences that cannot be trusted', () => {
  for (const [label, saved] of [['not JSON', '{oops'], ['JSON null', 'null'], ['a number', '42']] as const) {
    it(`fall back to the defaults when storage holds ${label}`, () => {
      localStorage.setItem('selecta.prefs', saved);
      reloadPrefs();
      expect(prefs()).toMatchObject(DEFAULTS);
    });
  }

  it('ignore values of the wrong type or outside the known choices', () => {
    localStorage.setItem('selecta.prefs', JSON.stringify({ theme: 'purple', motion: 3, density: ['compact'], railCollapsed: 'yes', libraryLayout: null }));
    reloadPrefs();
    expect(prefs()).toMatchObject(DEFAULTS);
  });

  it('read as defaults when storage refuses to be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    reloadPrefs();
    expect(prefs()).toMatchObject(DEFAULTS);
  });

  it('keep a choice in memory when storage refuses to save it, without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(() => setPrefs({ density: 'compact' })).not.toThrow();
    expect(prefs().density).toBe('compact');
    vi.restoreAllMocks();
    reloadPrefs();
    expect(prefs().density).toBe('comfortable');
  });
});
