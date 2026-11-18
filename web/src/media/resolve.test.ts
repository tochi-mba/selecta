import { describe, expect, it, vi } from 'vitest';
import { makeCoexistingResolver, makeResolver, makeSourceBook, NOT_ANYWHERE, NOT_ON_DEVICE, resolveByIndex } from './resolve';
import { MediaStore } from './store';
import { fileSha256 } from './identity';
import type { StoredSong } from './store';
import { bytesFile, fakeHandle } from './testFixtures';

const noCache = async () => null;

async function storeWith(...songs: StoredSong[]): Promise<MediaStore> {
  const store = await MediaStore.open('ws-test');
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
    const file = bytesFile('abc', 'a.mp3');
    const handle = fakeHandle(file);
    const song = handleSong(1, handle);
    song.identity.content_sha256 = await fileSha256(file);
    const resolve = makeResolver(await storeWith(song), noCache);
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
    const resolve = makeResolver(await MediaStore.open('ws-test'), noCache);
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
    const store = await MediaStore.open('ws-test');
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

describe('coexistence precedence (BF-0465-03)', () => {
  const bytes = (n: number) => async () => new ArrayBuffer(n);
  it('resolves on the device first, then falls back to the hosted copy, recording each source', async () => {
    const book = makeSourceBook();
    const hosted = vi.fn(async (songId: number) => (songId === 2 ? { id: 2, data: bytes(2) } : null));
    const resolve = makeCoexistingResolver({
      device: async (songId) => (songId === 1 ? { id: 1, data: bytes(1) } : null),
      hosted,
      book,
    });
    expect((await resolve(1))?.source).toBe('device');
    expect(hosted).not.toHaveBeenCalled();
    expect((await resolve(2))?.source).toBe('hosted');
    expect(await resolve(3)).toBeNull();
    expect(book.get(1)).toEqual({ source: 'device' });
    expect(book.get(2)).toEqual({ source: 'hosted' });
    expect(book.get(3)).toEqual({ source: 'unavailable', reason: NOT_ON_DEVICE });
  });

  it('without a hosted path says the song is not on this device, and survives a failing path', async () => {
    const book = makeSourceBook();
    const heard = vi.fn();
    book.subscribe(heard);
    const resolve = makeCoexistingResolver({ device: async () => null, book });
    expect(await resolve(5)).toBeNull();
    expect(book.get(5)).toEqual({ source: 'unavailable', reason: NOT_ANYWHERE });
    const failing = makeCoexistingResolver({ device: async () => null, hosted: async () => { throw new Error('offline'); }, book });
    expect(await failing(6)).toBeNull();
    expect(book.get(6)?.source).toBe('unavailable');
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
