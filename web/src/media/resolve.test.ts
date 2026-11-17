import { describe, expect, it } from 'vitest';
import { makeResolver, resolveByIndex } from './resolve';
import { MediaStore } from './store';
import type { StoredSong } from './store';
import { bytesFile, fakeHandle } from './testFixtures';

const noCache = async () => null;

async function storeWith(...songs: StoredSong[]): Promise<MediaStore> {
  const store = await MediaStore.open();
  for (const song of songs) await store.put(song);
  return store;
}

function handleSong(songId: number, handle: ReturnType<typeof fakeHandle>): StoredSong {
  return {
    songId,
    identity: { content_sha256: `hash-${songId}`, title: `Song ${songId}`, artist: 'Test Artist' },
    ref: { kind: 'handle', handle },
    importedAt: 1700000000000,
  };
}

describe('makeResolver', () => {
  it('resolves a granted handle to its bytes', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'));
    const resolve = makeResolver(await storeWith(handleSong(1, handle)), noCache);
    const track = await resolve(1);
    expect(track).not.toBeNull();
    expect(track?.id).toBe(1);
    expect(new TextDecoder().decode(await track!.data())).toBe('abc');
  });

  it('returns null for a revoked handle, so the engine shows unavailable_here', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'), { permission: 'prompt' });
    const resolve = makeResolver(await storeWith(handleSong(1, handle)), noCache);
    expect(await resolve(1)).toBeNull();
  });

  it('returns null when the file behind a granted handle is gone', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'), { broken: true });
    const resolve = makeResolver(await storeWith(handleSong(1, handle)), noCache);
    expect(await resolve(1)).toBeNull();
  });

  it('returns null for a song this device never imported', async () => {
    const resolve = makeResolver(await MediaStore.open(), noCache);
    expect(await resolve(99)).toBeNull();
  });

  it('falls back to cached bytes when the handle lapsed', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'), { permission: 'prompt' });
    const cached = new Uint8Array([1, 2, 3]).buffer;
    const cache = async (key: string) => (key === 'bytes-1' ? cached : null);
    const resolve = makeResolver(await storeWith(handleSong(1, handle)), cache);
    const track = await resolve(1);
    expect(track).not.toBeNull();
    expect(await track!.data()).toBe(cached);
  });

  it('prefers a file handed over this visit, the re-pick recovery path', async () => {
    const store = await storeWith(handleSong(1, fakeHandle(bytesFile('abc', 'a.mp3'), { broken: true })));
    store.attachSessionFile(1, bytesFile('fresh', 'a.mp3'));
    const resolve = makeResolver(store, noCache);
    const track = await resolve(1);
    expect(new TextDecoder().decode(await track!.data())).toBe('fresh');
  });

  it('resolves a repick marker to null until the person picks the file again', async () => {
    const store = await MediaStore.open();
    await store.put({
      songId: 2,
      identity: { content_sha256: 'hash-2', title: 'Song 2', artist: 'Test Artist' },
      ref: { kind: 'repick', name: 'b.mp3', size: 3 },
      importedAt: 1700000000000,
    });
    const resolve = makeResolver(store, noCache);
    expect(await resolve(2)).toBeNull();
  });
});

describe('resolveByIndex', () => {
  it('resolves the programme position, and out of range is just unavailable', async () => {
    const handle = fakeHandle(bytesFile('abc', 'a.mp3'));
    const resolve = makeResolver(await storeWith(handleSong(7, handle)), noCache);
    const programme = [7, 9];
    expect((await resolveByIndex(resolve, programme, 0))?.id).toBe(7);
    expect(await resolveByIndex(resolve, programme, 1)).toBeNull();
    expect(await resolveByIndex(resolve, programme, 5)).toBeNull();
    expect(await resolveByIndex(resolve, programme, -1)).toBeNull();
  });
});
