import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredSong } from './store';
import { cacheEvict, cacheRead, cacheWrite, isQuotaError, MediaStore, StorageFullError } from './store';
import { bytesFile } from './testFixtures';

const song = (songId: number, hash = `hash-${songId}`): StoredSong => ({
  songId,
  identity: { content_sha256: hash, title: `Song ${songId}`, artist: 'Test Artist', duration_s: 100 },
  ref: { kind: 'repick', name: `song-${songId}.mp3`, size: 3 },
  importedAt: 1700000000000,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MediaStore without usable IndexedDB', () => {
  it('degrades to memory with the flag raised, and still serves reads and writes', async () => {
    // jsdom has no IndexedDB at all: the exact shape of a private window with storage blocked.
    const store = await MediaStore.open();
    expect(store.degraded).toBe(true);
    await store.put(song(1));
    expect(await store.get(1)).toMatchObject({ songId: 1 });
    expect(await store.all()).toHaveLength(1);
    await store.remove(1);
    expect(await store.get(1)).toBeNull();
  });

  it('degrades when indexedDB.open itself throws', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('storage disabled'); } });
    const store = await MediaStore.open();
    expect(store.degraded).toBe(true);
    await store.put(song(2));
    expect(await store.get(2)).toMatchObject({ songId: 2 });
  });

  it('degrades when opening never succeeds, instead of crashing the page', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = { onsuccess: null, onerror: null as (() => void) | null, onupgradeneeded: null, onblocked: null, error: new Error('refused') };
        setTimeout(() => request.onerror?.(), 0);
        return request;
      },
    });
    const store = await MediaStore.open();
    expect(store.degraded).toBe(true);
  });
});

describe('session files', () => {
  it('keeps a picked file reachable for the visit without writing it anywhere', async () => {
    const store = await MediaStore.open();
    const file = bytesFile('abc', 'a.mp3');
    expect(store.sessionFile(5)).toBeNull();
    store.attachSessionFile(5, file);
    expect(store.sessionFile(5)).toBe(file);
    await store.remove(5);
    expect(store.sessionFile(5)).toBeNull();
  });
});

describe('quota detection', () => {
  it('recognises the browser quota error and SelectaDJ\'s own typed one', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError(new StorageFullError())).toBe(true);
    expect(isQuotaError(new Error('anything else'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe('OPFS cache where no OPFS exists', () => {
  it('treats a read as a miss, never an error', async () => {
    expect(await cacheRead('bytes-1')).toBeNull();
  });

  it('reports an unavailable write instead of throwing', async () => {
    expect(await cacheWrite('bytes-1', new Uint8Array([1, 2, 3]))).toEqual({ ok: false, why: 'unavailable' });
  });

  it('eviction of something already absent is quietly fine', async () => {
    await expect(cacheEvict('bytes-1')).resolves.toBeUndefined();
  });
});

describe('OPFS cache against a fake root', () => {
  function fakeStorage(behaviour: { full?: boolean } = {}) {
    const entries = new Map<string, Blob>();
    const root = {
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (!options?.create && !entries.has(name)) throw new DOMException('absent', 'NotFoundError');
        return {
          getFile: async () => new File([entries.get(name) ?? new Blob()], name),
          createWritable: async () => {
            let written: Blob = new Blob();
            return {
              write: async (data: Blob | ArrayBuffer | Uint8Array) => {
                if (behaviour.full) throw new DOMException('no room', 'QuotaExceededError');
                written = data instanceof Blob ? data : new Blob([data as BlobPart]);
              },
              close: async () => { entries.set(name, written); },
            };
          },
        };
      },
      removeEntry: async (name: string) => { entries.delete(name); },
    };
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
    return entries;
  }

  it('writes, reads back and evicts', async () => {
    fakeStorage();
    expect(await cacheWrite('seam-1', new Uint8Array([9, 8, 7]))).toEqual({ ok: true });
    const bytes = await cacheRead('seam-1');
    expect(bytes && Array.from(new Uint8Array(bytes))).toEqual([9, 8, 7]);
    await cacheEvict('seam-1');
    expect(await cacheRead('seam-1')).toBeNull();
  });

  it('answers storage_full on a quota error, so the import can pause honestly', async () => {
    fakeStorage({ full: true });
    expect(await cacheWrite('seam-1', new Uint8Array([1]))).toEqual({ ok: false, why: 'storage_full' });
  });
});
