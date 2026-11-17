import { describe, expect, it } from 'vitest';
import { fileSha256 } from './identity';
import { acceptRepick, findLapsed } from './reauth';
import { MediaStore } from './store';
import type { StoredSong } from './store';
import { bytesFile, fakeHandle } from './testFixtures';
import type { FakeHandle } from './testFixtures';

async function storedWith(songId: number, handle: FakeHandle, content: string): Promise<{ store: MediaStore; song: StoredSong }> {
  const store = await MediaStore.open();
  const song: StoredSong = {
    songId,
    identity: { content_sha256: await fileSha256(new Blob([content])), title: `Song ${songId}`, artist: 'Test Artist' },
    ref: { kind: 'handle', handle },
    importedAt: 1700000000000,
  };
  await store.put(song);
  return { store, song };
}

describe('findLapsed', () => {
  it('leaves healthy handles alone', async () => {
    const { store } = await storedWith(1, fakeHandle(bytesFile('abc', 'a.mp3')), 'abc');
    expect(await findLapsed(store)).toEqual([]);
  });

  it('surfaces one consistent item per lapse, naming why', async () => {
    const store = await MediaStore.open();
    const asking = fakeHandle(bytesFile('abc', 'a.mp3'), { permission: 'prompt' });
    const gone = fakeHandle(bytesFile('def', 'b.mp3'), { broken: true });
    await store.put({ songId: 1, identity: { content_sha256: await fileSha256(new Blob(['abc'])), title: 'A', artist: 'X' }, ref: { kind: 'handle', handle: asking }, importedAt: 1 });
    await store.put({ songId: 2, identity: { content_sha256: await fileSha256(new Blob(['def'])), title: 'B', artist: 'X' }, ref: { kind: 'handle', handle: gone }, importedAt: 1 });
    const lapsed = await findLapsed(store);
    expect(lapsed.map(({ songId, why, title }) => ({ songId, why, title }))).toEqual([
      { songId: 1, why: 'permission', title: 'A' },
      { songId: 2, why: 'missing', title: 'B' },
    ]);
  });

  it('does not list repick markers: they never had a handle to lapse', async () => {
    const store = await MediaStore.open();
    await store.put({ songId: 3, identity: { content_sha256: 'x', title: 'C', artist: 'X' }, ref: { kind: 'repick', name: 'c.mp3', size: 3 }, importedAt: 1 });
    expect(await findLapsed(store)).toEqual([]);
  });
});

describe('regrant', () => {
  it('recovers when the person allows again and the bytes still match, with no duplicate made', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'), { permission: 'prompt' });
    const { store } = await storedWith(1, handle, 'abc');
    const [item] = await findLapsed(store);
    expect((await item.regrant()).status).toBe('recovered');
    expect(await store.all()).toHaveLength(1);
    expect(await findLapsed(store)).toEqual([]);
  });

  it('reports denied when the person refuses', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'), { permission: 'denied' });
    const { store } = await storedWith(1, handle, 'abc');
    const [item] = await findLapsed(store);
    expect((await item.regrant()).status).toBe('denied');
  });

  it('reports different_file when the path now holds other bytes, keeping identity honest', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'), { permission: 'prompt' });
    const { store } = await storedWith(1, handle, 'something else entirely');
    const [item] = await findLapsed(store);
    expect((await item.regrant()).status).toBe('different_file');
  });
});

describe('acceptRepick', () => {
  it('matches a re-picked file by content hash and keeps it for the visit', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'), { broken: true });
    const { store } = await storedWith(1, handle, 'abc');
    const fresh = bytesFile('abc', 'renamed-elsewhere.mp3');
    expect((await acceptRepick(store, 1, fresh)).status).toBe('recovered');
    expect(store.sessionFile(1)).toBe(fresh);
  });

  it('refuses a file whose bytes are not the stored identity', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'), { broken: true });
    const { store } = await storedWith(1, handle, 'abc');
    expect((await acceptRepick(store, 1, bytesFile('xyz', 'a.mp3'))).status).toBe('different_file');
    expect(store.sessionFile(1)).toBeNull();
  });

  it('reports missing for a song that was never imported here', async () => {
    const store = await MediaStore.open();
    expect((await acceptRepick(store, 42, bytesFile('abc', 'a.mp3'))).status).toBe('missing');
  });
});
