import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryUrl, prefetchLibrary, takeEarlyLibrary } from './libraryPrefetch';

afterEach(() => {
  takeEarlyLibrary('');
  vi.unstubAllGlobals();
});

describe('rv2-f: an early Library read that failed', () => {
  it('is not handed on, so a later ask (the server back up) reads the rows again', async () => {
    const page = { songs: [], total: 0, next: null };
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      // the server is still starting the first time it is asked
      if (calls === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(page), { status: 200 });
    }));
    prefetchLibrary('');
    await new Promise((done) => setTimeout(done, 0));
    // RuntimeApp retried, the server answered, and App asks again on the same address
    prefetchLibrary('');
    expect(calls).toBe(2);
    const early = takeEarlyLibrary(libraryUrl('', 'all', 'title'));
    await expect(early).resolves.toEqual(page);
  });
});
