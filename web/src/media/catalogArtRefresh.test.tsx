import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from '../api';
import { RequestContext } from '../requestContext';
import { CoverArt } from '../views/CoverArt';
import { resetArtStoreForTests } from './artStore';
import { catalogCoverFor, forgetCatalogArt } from './catalogArt';
import { fakeIndexedDb } from './fakeIndexedDb';

/** T-20261125-7375: catalogue answers expire and are read again, an image that will not load drops
 * its song to the generated tile at once, and a failed read is retried later with growing waits.
 * Recorded answers stand in for the server. */

const ART = { id: 'art-1', url: '/api/catalog/art/art-1/500', sizes: { 500: '/api/catalog/art/art-1/500' }, hue: 210, source: 'caa-release' };
const MATCHED = { song_id: 4, state: 'matched', chosen: false, art: ART, confidence: 0.96, method: 'search', details: null };
const HIDDEN = { ...MATCHED, art: null };

type Answer = object | Error;

function server(answers: Answer[]) {
  let reads = 0;
  const request = vi.fn(async (path: string) => {
    if (path !== '/catalog/art') throw new Error(`unexpected ${path}`);
    const answer = answers[Math.min(reads, answers.length - 1)];
    reads += 1;
    if (answer instanceof Error) throw answer;
    return { songs: [answer], queued: 0, lookups_allowed: true };
  }) as unknown as Request;
  return { request, reads: () => reads };
}

const images = (container: HTMLElement) => [...container.querySelectorAll<HTMLImageElement>('.cover-art img')];
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

let requests: Request[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resetArtStoreForTests();
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  requests = [];
});

afterEach(() => {
  for (const request of requests) forgetCatalogArt(request);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetArtStoreForTests();
});

function show(request: Request) {
  requests.push(request);
  return render(<RequestContext.Provider value={request}><CoverArt seed={4} songId={4} /></RequestContext.Provider>);
}

describe('catalogue answers do not last the whole visit', () => {
  it('reads an answer again once it is old, so a hidden cover leaves the page', async () => {
    const { request, reads } = server([MATCHED, HIDDEN]);
    const { container } = show(request);
    await wait(500);
    expect(images(container)).toHaveLength(1);
    expect(reads()).toBe(1);

    await wait(29 * 60_000);
    expect(reads()).toBe(1);
    await wait(2 * 60_000);
    expect(reads()).toBe(2);
    expect(images(container)).toHaveLength(0);
  });

  it('retries a failed read later with growing waits, never in a tight loop', async () => {
    // no spread in the waits, so the times below are exact: 5 s, then 10 s
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const down = new Error('offline');
    const { request, reads } = server([down, down, MATCHED]);
    const { container } = show(request);
    await wait(500);
    expect(reads()).toBe(1);
    expect(images(container)).toHaveLength(0);

    await wait(3_000);
    expect(reads()).toBe(1);
    await wait(4_000);
    expect(reads()).toBe(2);
    // the second wait is about ten seconds, not five
    await wait(7_000);
    expect(reads()).toBe(2);
    await wait(7_000);
    expect(reads()).toBe(3);
    expect(images(container)).toHaveLength(1);
  });

  it('drops the song to the tile at once when its image will not load, and asks again later', async () => {
    vi.stubGlobal('Image', class {
      decoding = '';
      src = '';
      decode() { return Promise.reject(new Error('404')); }
    });
    const { request, reads } = server([MATCHED, HIDDEN]);
    const { container } = show(request);
    await wait(500);
    expect(images(container)).toHaveLength(0);
    expect(container.querySelector('.cover-art')).not.toHaveAttribute('data-art');
    await expect(catalogCoverFor(4, 10)).resolves.toBeNull();

    expect(reads()).toBe(1);
    await wait(61_000);
    expect(reads()).toBe(2);
    expect(images(container)).toHaveLength(0);
  });
});
