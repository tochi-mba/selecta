import { describe, expect, it, vi } from 'vitest';
import { bytesSha256, fileSha256 } from './identity';
import { findLapsed } from './reauth';
import { makeResolver } from './resolve';
import { MediaStore, type StoredSong } from './store';
import { bytesFile, fakeHandle, type FakeHandle } from './testFixtures';
import { endImportSession, importSnapshotFor, startImportSession } from '../cloud/importSession';

const noCache = async () => null;

async function stored(handle: FakeHandle, content: string, songId = 1): Promise<{ store: MediaStore; song: StoredSong }> {
  const store = await MediaStore.open('ws-test');
  const song: StoredSong = {
    songId,
    identity: { content_sha256: await fileSha256(new Blob([content])), title: `Song ${songId}`, artist: 'Artist' },
    ref: { kind: 'handle', handle },
    importedAt: 1,
  };
  await store.put(song);
  return { store, song };
}

describe('lapse reasons are honest', () => {
  it('a moved file under a granted folder is missing, even though queryPermission says prompt', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'), { broken: true });
    handle.queryPermission = async () => 'prompt';
    const { store } = await stored(handle, 'abc');
    expect((await findLapsed(store)).map((item) => item.why)).toEqual(['missing']);
  });

  it('only a NotAllowedError asks for permission again', async () => {
    const { store } = await stored(fakeHandle(bytesFile('abc', 'a.mp3'), { permission: 'prompt' }), 'abc');
    expect((await findLapsed(store)).map((item) => item.why)).toEqual(['permission']);
  });

  it('the resolver reports a failed open as a lapse and a byte mismatch as changed', async () => {
    const seen: (string | undefined)[] = [];
    const lapsedStore = await stored(fakeHandle(bytesFile('abc', 'a.mp3'), { permission: 'prompt' }), 'abc');
    await makeResolver(lapsedStore.store, noCache, (_id, _present, why) => seen.push(why))(1);
    const goneStore = await stored(fakeHandle(bytesFile('abc', 'a.mp3'), { broken: true }), 'abc');
    await makeResolver(goneStore.store, noCache, (_id, _present, why) => seen.push(why))(1);
    const changedStore = await stored(fakeHandle(bytesFile('edited', 'a.mp3')), 'abc');
    const track = await makeResolver(changedStore.store, noCache, (_id, _present, why) => seen.push(why))(1);
    await expect(track!.data()).rejects.toThrow();
    expect(seen).toEqual(['permission', 'missing', 'changed']);
  });
});

describe('play-time hashing', () => {
  it('bytesSha256 agrees with the sliced file hash', async () => {
    const bytes = new TextEncoder().encode('some audio bytes').buffer;
    expect(await bytesSha256(bytes)).toBe(await fileSha256(new Blob([bytes])));
  });

  it('falls back to the sliced hash where WebCrypto is missing', async () => {
    const bytes = new TextEncoder().encode('more bytes').buffer;
    const expected = await fileSha256(new Blob([bytes]));
    vi.stubGlobal('crypto', {});
    try {
      expect(await bytesSha256(bytes)).toBe(expected);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the lapsed sweep', () => {
  it('a plain import does not invalidate it; a re-link does', async () => {
    const { store, song } = await stored(fakeHandle(bytesFile('abc', 'a.mp3')), 'abc');
    const before = store.availabilityRevision;
    await store.put({ ...song, songId: 2 });
    expect(store.availabilityRevision).toBe(before);
    await store.put({ ...song, ref: { kind: 'handle', handle: fakeHandle(bytesFile('abc', 'b.mp3')) } });
    expect(store.availabilityRevision).toBe(before + 1);
  });

  it('concurrent sweeps share one run, so every file is opened once', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'));
    let opens = 0;
    const getFile = handle.getFile;
    handle.getFile = async () => { opens += 1; return getFile(); };
    const { store } = await stored(handle, 'abc');
    await Promise.all([findLapsed(store, { force: true }), findLapsed(store), findLapsed(store, { force: true })]);
    expect(opens).toBe(1);
  });
});

describe('import snapshot on account switch', () => {
  it('a new workspace never sees the last one, and leaving the shell forgets it', async () => {
    let finish: (() => void) | null = null;
    const run = startImportSession({
      workspaceId: 'ws-a',
      folder: 'A folder',
      source: { kind: 'files', files: [] } as never,
      run: () => new Promise((resolve) => { finish = () => resolve({ paused: false } as never); }),
    });
    expect(importSnapshotFor('ws-a').folder).toBe('A folder');
    expect(importSnapshotFor('ws-b').phase).toBe('idle');
    finish!();
    await run;
    expect(importSnapshotFor('ws-a').phase).toBe('finished');
    expect(importSnapshotFor('ws-b').summary).toBeNull();
    endImportSession();
    expect(importSnapshotFor('ws-a').phase).toBe('idle');
    expect(importSnapshotFor(undefined).summary).toBeNull();
  });
});
