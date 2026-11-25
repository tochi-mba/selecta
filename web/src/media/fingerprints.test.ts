import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertMachineDerived, DerivedStore, resetDerivedStoreForTests } from './derived';
import { fakeIndexedDb } from './fakeIndexedDb';
import { fingerprintRun } from './fingerprintLog';
import { ImportFingerprints, memoIdentity } from './fingerprints';
import { fileSha256 } from './identity';
import { displayNames } from './importer';
import { reuseWords } from '../cloud/importAnnouncer';

// ADR-0469 amendment 1: the device-wide derived store, the fingerprint memo and its rule, and
// what the import says about what was reused.

const file = (text: string, name = 'Song.mp3', lastModified = 1_700_000_000_000) => new File([text], name, { lastModified });

beforeEach(() => {
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  resetDerivedStoreForTests();
});

afterEach(() => {
  resetDerivedStoreForTests();
  vi.unstubAllGlobals();
});

describe('the derived store', () => {
  it('keeps a derivation under kind, version and hash, and a new version is a miss', async () => {
    const store = await DerivedStore.open();
    const sha = 'a'.repeat(64);
    expect(await store.put('facts', 'facts-v1', sha, { duration_s: 200 })).toBe(true);
    expect(await store.get('facts', 'facts-v1', sha)).toEqual({ duration_s: 200 });
    expect(await store.get('facts', 'facts-v2', sha)).toBeNull();
    // only the hashes asked for are answered
    expect([...(await store.getMany('facts', 'facts-v1', ['b'.repeat(64)])).keys()]).toEqual([]);
  });

  it('refuses anything a person typed or chose', () => {
    expect(() => assertMachineDerived({ duration_s: 1, nested: { title: 'Mine' } })).toThrow(/title/);
    expect(() => assertMachineDerived({ rating: 5 })).toThrow(/rating/);
    expect(() => assertMachineDerived([0.1, 0.2, 0.3])).not.toThrow();
  });

  it('keeps no memo at all where the browser keeps nothing between visits', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = await DerivedStore.open();
    expect(store.degraded).toBe(true);
    await store.memoPut('identity', 'a'.repeat(64));
    expect(await store.memoGet('identity')).toBeNull();
  });
});

describe('the fingerprint memo', () => {
  it('hashes a file once, then recognises it in a later import without reading it', async () => {
    const song = file('the same bytes');
    const sha = await fileSha256(song);
    const first = await ImportFingerprints.start('ws-a');
    const found = await first.identify(song, 'Music/Song.mp3', 'Song.mp3', async () => song);
    expect(found).toMatchObject({ sha, how: 'computed', bytesRead: song.size });
    expect(first.isRemembered(sha)).toBe(false);

    // another account, same browser, same folder
    const second = await ImportFingerprints.start('ws-b');
    const again = await second.identify(song, 'Music/Song.mp3', 'Song.mp3', async () => song);
    expect(again).toMatchObject({ sha, how: 'memo', bytesRead: 0 });
    expect(second.isRemembered(sha)).toBe(true);
    expect(second.reuse()).toEqual({ recognised: 1, analysed: 0, kept: true });
  });

  it('misses when the size or the modified time changed', async () => {
    const before = file('one');
    const fingerprints = await ImportFingerprints.start('ws-a');
    await fingerprints.identify(before, 'Music/Song.mp3', 'Song.mp3', async () => before);
    const touched = file('one', 'Song.mp3', 1_700_000_000_001);
    expect((await fingerprints.identify(touched, 'Music/Song.mp3', 'Song.mp3', async () => touched)).how).toBe('computed');
    expect(await memoIdentity('a', 1, 2)).not.toBe(await memoIdentity('a', 1, 3));
  });

  it('keeps a duration only under a hash it computed itself', async () => {
    const song = file('measured');
    const sha = await fileSha256(song);
    const first = await ImportFingerprints.start('ws-a');
    await first.keepDuration(sha, 200);
    expect(await first.knownDuration(sha)).toBeUndefined();
    await first.identify(song, 'Music/Song.mp3', 'Song.mp3', async () => song);
    await first.keepDuration(sha, 200);
    expect(await first.knownDuration(sha)).toBe(200);
  });

  it('a sample check that finds a changed file drops the memo and marks the song changed', async () => {
    const song = file('original');
    const changed = file('different');
    const first = await ImportFingerprints.start('ws-a');
    await first.identify(song, 'Music/Song.mp3', 'Song.mp3', async () => song);
    const second = await ImportFingerprints.start('ws-b');
    const found = await second.identify(song, 'Music/Song.mp3', 'Song.mp3', async () => changed);
    second.landed(found.sha, 7, false);
    const marked: number[] = [];
    const store = { confirmFingerprint: vi.fn(), markChanged: async (id: number) => { marked.push(id); } };
    await second.sampleCheck(store as never, { gapMs: 0 });
    expect(marked).toEqual([7]);
    expect(fingerprintRun('ws-b')?.totals.sampleMismatched).toBe(1);
    const third = await ImportFingerprints.start('ws-c');
    expect((await third.identify(song, 'Music/Song.mp3', 'Song.mp3', async () => song)).how).toBe('computed');
  });
});

describe('what the import says', () => {
  const summary = { imported: 2918, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false };

  it('says what was recognised, in plain words', () => {
    expect(reuseWords({ ...summary, reuse: { recognised: 2918, analysed: 0, kept: true } })).toBe('2,918 recognised from this browser, so nothing had to be analysed again.');
    expect(reuseWords({ ...summary, reuse: { recognised: 2900, analysed: 18, kept: true } })).toBe('2,900 recognised from this browser, 18 new songs analysed.');
    expect(reuseWords({ ...summary, reuse: { recognised: 0, analysed: 3, kept: true } })).toMatch(/^None of these songs had been seen in this browser before/);
    expect(reuseWords({ ...summary, reuse: { recognised: 0, analysed: 3, kept: false } })).toMatch(/isn’t keeping anything between visits/);
    expect(reuseWords(summary)).toBe('');
  });
});

describe('names from an Artist - Title file', () => {
  it('splits the file name when the artist tag is missing or says nobody', () => {
    expect(displayNames({}, 'Adekunle Gold - Call on Me.mp3')).toEqual({ title: 'Call on Me', artist: 'Adekunle Gold' });
    expect(displayNames({ title: 'Adekunle Gold - Call on Me', artist: 'Unknown Artist' }, 'track.mp3')).toEqual({ title: 'Call on Me', artist: 'Adekunle Gold' });
    expect(displayNames({ title: 'Call on Me', artist: '<unknown>' }, 'Adekunle Gold - Call on Me.mp3')).toEqual({ title: 'Call on Me', artist: 'Adekunle Gold' });
  });

  it('keeps real tags as they are', () => {
    expect(displayNames({ title: 'Ocean', artist: 'Ella Vos' }, '001 - Someone Else - Other.mp3')).toEqual({ title: 'Ocean', artist: 'Ella Vos' });
    expect(displayNames({}, 'untitled.mp3')).toEqual({ title: 'untitled', artist: 'Unknown artist' });
  });
});
