import { describe, expect, it } from 'vitest';
import { ALIASES, parseRoute, pathOf } from './router';

// SF-0236-05 and SF-0241-02: every older address still lands on the page it always meant, and the
// current addresses round-trip, so a redesigned page never breaks a saved link or bookmark.
describe('SF-0236-05 SF-0241-02 older addresses keep their meaning', () => {
  it('each older address opens exactly the page its replacement opens, never "missing"', () => {
    for (const [old, now] of Object.entries(ALIASES)) {
      const route = parseRoute(old);
      expect(route.page, old).not.toBe('missing');
      expect(route, old).toEqual(parseRoute(now));
      // with a trailing slash too, as a bookmark may carry one
      expect(parseRoute(`${old}/`), `${old}/`).toEqual(route);
    }
  });

  it('older Workspace tab addresses open the same Workshop tab', () => {
    for (const tab of ['storage', 'sources']) {
      expect(parseRoute(`/workspace/${tab}`)).toEqual(parseRoute(`/workshop/${tab}`));
      expect(parseRoute(`/workspace/${tab}`).page).toBe('workshop');
    }
  });

  it('where an older address lands, the address written back is the current one', () => {
    for (const now of new Set(Object.values(ALIASES))) {
      expect(pathOf(parseRoute(now))).toBe(now);
    }
  });
});
