import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb';
import { recallFolder, rememberFolder, type StoredFolderHandle } from './folders';
import { fileSha256 } from './identity';
import { makeResolver } from './resolve';
import {
  CACHE_KEY_VERSION, cachedBytesKey, cacheSongBytes, LEGACY_DB_NAME, mediaDbName, MediaStore,
  readSongBytes, resetLegacyDisposalForTests, type StoredSong,
} from './store';
import { bytesFile } from './testFixtures';
import { clearEverythingOnDevice, forgetWorkspaceOnDevice } from '../cloud/deviceData';
import { bindImportWorkspace, importMarkerKey, importSnapshot, startImportSession, clearImportSession } from '../cloud/importSession';

// ADR-0469: one browser, two accounts. Nothing of A's reaches B, the legacy shared index goes,
// the wipes wipe, and the content-keyed cache is reused across accounts only by proven hash.

let idb: FakeIndexedDb;

beforeEach(() => {
  idb = fakeIndexedDb();
  vi.stubGlobal('indexedDB', idb);
  resetLegacyDisposalForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const song = (songId: number, title: string, sha = 'a'.repeat(64)): StoredSong => ({
  songId,
  identity: { content_sha256: sha, title, artist: 'Artist' },
  ref: { kind: 'repick', name: `${title}.mp3`, size: 3 },
  importedAt: 1700000000000,
});

const folder = (name: string): StoredFolderHandle => ({ kind: 'directory', name, values: async function* () { /* empty */ } });

describe('per-workspace song index', () => {
  it('keeps two workspaces apart even when their song ids collide', async () => {
    const a = await MediaStore.open('ws-a');
    await a.put(song(12, 'A private title'));
    const b = await MediaStore.open('ws-b');
    expect(b.degraded).toBe(false);
    expect(await b.get(12)).toBeNull();
    expect(await b.all()).toEqual([]);
    await b.put(song(12, 'B title'));
    const aAgain = await MediaStore.open('ws-a');
    expect((await aAgain.get(12))?.identity.title).toBe('A private title');
    const bAgain = await MediaStore.open('ws-b');
    expect((await bAgain.get(12))?.identity.title).toBe('B title');
    expect(idb.names()).toEqual([mediaDbName('ws-a'), mediaDbName('ws-b')].sort());
  });

  it('drops the legacy unscoped index on the first scoped open', async () => {
    const legacy = indexedDB.open(LEGACY_DB_NAME, 1) as unknown as { onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; result: IDBDatabase };
    await new Promise<void>((resolve) => {
      legacy.onupgradeneeded = () => legacy.result.createObjectStore('songs', { keyPath: 'songId' });
      legacy.onsuccess = () => { legacy.result.close(); resolve(); };
    });
    expect(idb.names()).toContain(LEGACY_DB_NAME);
    await MediaStore.open('ws-a');
    expect(idb.names()).not.toContain(LEGACY_DB_NAME);
  });

  it('refuses to open an index without a workspace', () => {
    expect(() => mediaDbName('')).toThrow();
  });

  it('still degrades to a scoped memory index where IndexedDB fails', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('blocked'); }, deleteDatabase: () => { throw new Error('blocked'); } });
    const store = await MediaStore.open('ws-a');
    expect(store.degraded).toBe(true);
    expect(store.workspaceId).toBe('ws-a');
    await store.put(song(1, 'kept in memory'));
    expect(await store.get(1)).not.toBeNull();
  });
});

describe('two workspaces watching the same folder', () => {
  it('keep their own folder entries, and forgetting one leaves the other', async () => {
    await rememberFolder('ws-a', folder('Shared Music'));
    await rememberFolder('ws-b', folder('Shared Music'));
    await forgetWorkspaceOnDevice('ws-a');
    expect(await recallFolder('ws-a')).toBeNull();
    expect((await recallFolder('ws-b'))?.name).toBe('Shared Music');
  });
});

describe('forget this account and clear everything', () => {
  it('forgetting a workspace wipes its index, folder and marker and nothing of another', async () => {
    const a = await MediaStore.open('ws-a');
    await a.put(song(1, 'A'));
    const b = await MediaStore.open('ws-b');
    await b.put(song(1, 'B'));
    await rememberFolder('ws-a', folder('A folder'));
    localStorage.setItem(importMarkerKey('ws-a'), '{}');
    localStorage.setItem(importMarkerKey('ws-b'), '{}');
    await forgetWorkspaceOnDevice('ws-a');
    expect(idb.names()).not.toContain(mediaDbName('ws-a'));
    expect(idb.names()).toContain(mediaDbName('ws-b'));
    expect(localStorage.getItem(importMarkerKey('ws-a'))).toBeNull();
    expect(localStorage.getItem(importMarkerKey('ws-b'))).not.toBeNull();
    expect(await recallFolder('ws-a')).toBeNull();
    expect(await (await MediaStore.open('ws-a')).all()).toEqual([]);
    expect((await (await MediaStore.open('ws-b')).get(1))?.identity.title).toBe('B');
  });

  it('an open index lets go when another tab forgets its workspace', async () => {
    const a = await MediaStore.open('ws-a');
    await a.put(song(1, 'A'));
    await MediaStore.forget('ws-a');
    expect(a.degraded).toBe(true);
    expect(await a.get(1)).not.toBeNull();
  });

  it('clear everything deletes every SelectaDJ database and SelectaDJ keys, not the sign-in', async () => {
    await (await MediaStore.open('ws-a')).put(song(1, 'A'));
    await (await MediaStore.open('ws-b')).put(song(1, 'B'));
    await rememberFolder('ws-a', folder('A folder'));
    localStorage.setItem('selecta.prefs', '{}');
    localStorage.setItem('selecta-now', '{}');
    localStorage.setItem('selecta-cloud-dev:refresh', 'keep');
    await clearEverythingOnDevice(['ws-a']);
    expect(idb.names().filter((name) => name.startsWith('selecta'))).toEqual([]);
    expect(localStorage.getItem('selecta.prefs')).toBeNull();
    expect(localStorage.getItem('selecta-now')).toBeNull();
    expect(localStorage.getItem('selecta-cloud-dev:refresh')).toBe('keep');
  });
});

describe('import progress belongs to its workspace', () => {
  it('reads as idle to another workspace signed in on the same page', async () => {
    let finish: (() => void) | null = null;
    bindImportWorkspace('ws-a');
    const run = startImportSession({
      workspaceId: 'ws-a',
      folder: 'A private folder',
      source: { kind: 'files', files: [] } as never,
      run: () => new Promise((resolve) => { finish = () => resolve({ paused: false } as never); }),
    });
    expect(importSnapshot().folder).toBe('A private folder');
    bindImportWorkspace('ws-b');
    expect(importSnapshot().phase).toBe('idle');
    expect(importSnapshot().folder).toBeNull();
    finish!();
    await run;
    expect(importSnapshot().folder).toBeNull();
    bindImportWorkspace('ws-a');
    expect(importSnapshot().folder).toBe('A private folder');
    clearImportSession();
    bindImportWorkspace(null);
  });
});

describe('content-keyed derived cache', () => {
  const opfs = () => {
    const entries = new Map<string, ArrayBuffer>();
    return {
      entries,
      read: async (key: string) => entries.get(key) ?? null,
      write: async (key: string, bytes: ArrayBuffer) => { entries.set(key, bytes); return { ok: true as const }; },
      evict: async (key: string) => { entries.delete(key); },
    };
  };

  it('keys by content hash and version when shared, by workspace and song id when not', () => {
    const sha = 'b'.repeat(64);
    expect(cachedBytesKey(song(7, 'x', sha), { workspaceId: 'ws-a', shared: true })).toBe(`bytes-${CACHE_KEY_VERSION}-${sha}`);
    expect(cachedBytesKey(song(7, 'x', sha), { workspaceId: 'ws-a', shared: false })).toBe('bytes-ws-a-7');
    // a malformed hash is never used as a shared name
    expect(cachedBytesKey(song(7, 'x', 'not-a-hash'), { workspaceId: 'ws-a', shared: true })).toBe('bytes-ws-a-7');
  });

  it('the same file under two workspaces and two titles hits one entry', async () => {
    const file = bytesFile('same song bytes', 'a.mp3');
    const sha = await fileSha256(file);
    const bytes = await file.arrayBuffer();
    const cache = opfs();
    const asA = song(3, 'Title in A', sha);
    const asB = song(41, 'Totally different title in B', sha);
    expect(await cacheSongBytes(asA, bytes, { workspaceId: 'ws-a', shared: true }, cache.write)).toEqual({ ok: true });
    const storeB = await MediaStore.open('ws-b');
    await storeB.put(asB);
    const resolve = makeResolver(storeB, cache.read, undefined, { sharedCache: true });
    const track = await resolve(41);
    expect(track).not.toBeNull();
    expect(new TextDecoder().decode(await track!.data())).toBe('same song bytes');
    expect(cache.entries.size).toBe(1);
  });

  it('with the flag off nothing is shared across workspaces', async () => {
    const file = bytesFile('same song bytes', 'a.mp3');
    const sha = await fileSha256(file);
    const cache = opfs();
    await cacheSongBytes(song(3, 'A', sha), await file.arrayBuffer(), { workspaceId: 'ws-a', shared: false }, cache.write);
    const storeB = await MediaStore.open('ws-b');
    await storeB.put(song(3, 'B', sha));
    expect(await makeResolver(storeB, cache.read, undefined, { sharedCache: false })(3)).toBeNull();
    expect([...cache.entries.keys()]).toEqual(['bytes-ws-a-3']);
  });

  it('refuses to write bytes that do not hash to the song (no trusting a claimed hash)', async () => {
    const cache = opfs();
    const claimed = song(3, 'A', 'c'.repeat(64));
    expect(await cacheSongBytes(claimed, new TextEncoder().encode('other bytes').buffer, { workspaceId: 'ws-a', shared: true }, cache.write)).toEqual({ ok: false, why: 'not_these_bytes' });
    expect(cache.entries.size).toBe(0);
  });

  it('evicts a shared entry whose bytes do not match its name, and reports a miss', async () => {
    const cache = opfs();
    const claimed = song(3, 'A', 'd'.repeat(64));
    const key = cachedBytesKey(claimed, { workspaceId: 'ws-a', shared: true });
    cache.entries.set(key, new TextEncoder().encode('poisoned').buffer);
    expect(await readSongBytes(claimed, { workspaceId: 'ws-a', shared: true }, cache.read, cache.evict)).toBeNull();
    expect(cache.entries.has(key)).toBe(false);
  });
});
