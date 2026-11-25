import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ART_DB, bindArtIndex, clearArt, getArtHue, getArtImage, getArtUrl, hasArt, peekArtUrl, putArt,
  resetArtStoreForTests, songKeyFor, subscribeArt,
} from './artStore';
import { fakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb';

/** FL-0478-01: covers made from the person's own files are kept on this device, keyed by the
 * file's content hash, handed out as local blob: URLs, and reached from a song id only through the
 * open workspace's own index. */

const SHA = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const made = (hue: number | null = 210) => ({
  small: new Blob(['small'], { type: 'image/webp' }),
  large: new Blob(['large'], { type: 'image/webp' }),
  hue,
});

let idb: FakeIndexedDb;
let urls = 0;
const revoked: string[] = [];
const urlApi = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };

beforeEach(() => {
  resetArtStoreForTests();
  idb = fakeIndexedDb();
  vi.stubGlobal('indexedDB', idb);
  urls = 0;
  revoked.length = 0;
  urlApi.createObjectURL = vi.fn(() => { urls += 1; return `blob:local/${urls}`; });
  urlApi.revokeObjectURL = vi.fn((url: string) => { revoked.push(url); });
});

afterEach(() => {
  resetArtStoreForTests();
  delete urlApi.createObjectURL;
  delete urlApi.revokeObjectURL;
});

describe('FL-0478-01 the on-device cover store', () => {
  it('keeps a cover and hands back local URLs for each size and its hue', async () => {
    expect(await putArt(SHA, made(210))).toBe(true);
    expect(await hasArt(SHA)).toBe(true);
    const small = await getArtImage(SHA, 'small');
    expect(small).toEqual({ src: 'blob:local/1', type: 'image/webp' });
    expect(await getArtUrl(SHA, 'large')).toBe('blob:local/2');
    expect(await getArtHue(SHA)).toBe(210);
    // asking again reuses the URL already made
    expect(await getArtUrl(SHA, 'small')).toBe('blob:local/1');
    expect(peekArtUrl(SHA, 'small')).toBe('blob:local/1');
    expect(urls).toBe(2);
  });

  it('survives a new visit, and stores only the images, a hue and times', async () => {
    await putArt(SHA, made(42));
    resetArtStoreForTests();
    expect(await getArtHue(SHA)).toBe(42);
    const rows = idb.rows(ART_DB, 'art') as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['at', 'hue', 'large', 'sha', 'small', 'used', 'version']);
  });

  it('a song with no cover, or a key that is not a content hash, is simply none', async () => {
    expect(await hasArt(OTHER)).toBe(false);
    expect(await getArtUrl(OTHER, 'small')).toBeNull();
    expect(await getArtHue(OTHER)).toBeNull();
    expect(await putArt('not-a-hash', made())).toBe(false);
    expect(await getArtUrl('not-a-hash', 'small')).toBeNull();
    expect(peekArtUrl(OTHER, 'small')).toBeNull();
  });

  it('a cover added after a miss is found', async () => {
    expect(await hasArt(SHA)).toBe(false);
    await putArt(SHA, made());
    expect(await hasArt(SHA)).toBe(true);
  });

  it('clears one cover or all of them, freeing their URLs and saying so', async () => {
    const heard: (string | null)[] = [];
    const stop = subscribeArt((sha) => heard.push(sha));
    await putArt(SHA, made());
    await putArt(OTHER, made());
    const url = await getArtUrl(SHA, 'small');
    await clearArt(SHA);
    expect(revoked).toContain(url);
    expect(await hasArt(SHA)).toBe(false);
    expect(await hasArt(OTHER)).toBe(true);
    await clearArt();
    expect(await hasArt(OTHER)).toBe(false);
    expect(idb.rows(ART_DB, 'art')).toHaveLength(0);
    expect(heard).toEqual([SHA, OTHER, SHA, null]);
    stop();
  });

  it('keeps covers in memory for this visit where IndexedDB is refused', async () => {
    vi.stubGlobal('indexedDB', undefined);
    resetArtStoreForTests();
    expect(await putArt(SHA, made(90))).toBe(false);
    expect(await getArtUrl(SHA, 'small')).toBe('blob:local/1');
    expect(await getArtHue(SHA)).toBe(90);
    resetArtStoreForTests();
    expect(await hasArt(SHA)).toBe(false);
  });
});

describe('FL-0478-01 from a song id to its content hash', () => {
  it('has no hash without a bound workspace index', async () => {
    expect(await songKeyFor(5)).toBeNull();
  });

  it('turns an id into a hash through the bound index, and stops when unbound', async () => {
    const heard: (string | null)[] = [];
    const stop = subscribeArt((sha) => heard.push(sha));
    const lookup = vi.fn(async (id: number) => (id === 5 ? SHA : null));
    const unbind = bindArtIndex(lookup);
    expect(heard).toEqual([null]);
    expect(await songKeyFor(5)).toBe(SHA);
    expect(await songKeyFor(5)).toBe(SHA);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await songKeyFor(6)).toBeNull();
    // a miss is not remembered: a song indexed a moment later is asked about again
    await songKeyFor(6);
    expect(lookup).toHaveBeenCalledTimes(3);
    unbind();
    expect(heard).toEqual([null, null]);
    expect(await songKeyFor(5)).toBeNull();
    stop();
  });

  it('refuses an index answer that is not a content hash, or one that fails', async () => {
    bindArtIndex(async (id) => (id === 1 ? '../etc/passwd' : Promise.reject(new Error('closed'))));
    expect(await songKeyFor(1)).toBeNull();
    expect(await songKeyFor(2)).toBeNull();
    expect(await songKeyFor(Number.NaN)).toBeNull();
  });

  it('an older unbind does not undo a newer binding', async () => {
    const first = bindArtIndex(async () => SHA);
    bindArtIndex(async () => OTHER);
    first();
    expect(await songKeyFor(1)).toBe(OTHER);
  });
});
