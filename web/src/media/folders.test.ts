import { describe, expect, it, vi } from 'vitest';
import { FOLDERS_DB, forgetFolder, recallFolder, rememberFolder } from './folders';
import type { StoredFolderHandle } from './folders';
import { bytesFile, fakeDirectory, fakeHandle } from './testFixtures';

/** A minimal in-memory IndexedDB: enough of open / upgrade / transaction / get / put / delete
 * for the folders module, recording which databases were opened at which version. */
function fakeIndexedDB() {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
  const opened: { name: string; version?: number }[] = [];
  const later = (fn: () => void) => setTimeout(fn, 0);
  const factory = {
    open(name: string, version?: number) {
      opened.push({ name, version });
      const fresh = !databases.has(name);
      if (fresh) databases.set(name, new Map());
      const stores = databases.get(name)!;
      const db = {
        objectStoreNames: { contains: (store: string) => stores.has(store) },
        createObjectStore: (store: string) => { stores.set(store, new Map()); },
        close: () => {},
        transaction: (storeName: string) => {
          const transaction: Record<string, unknown> = {};
          const rows = stores.get(storeName)!;
          const request = (run: () => unknown) => {
            const req: { result?: unknown } = {};
            later(() => {
              req.result = run();
              later(() => (transaction.oncomplete as () => void)?.());
            });
            return req;
          };
          transaction.objectStore = () => ({
            put: (value: unknown, key: IDBValidKey) => request(() => { rows.set(key, value); return key; }),
            get: (key: IDBValidKey) => request(() => rows.get(key)),
            delete: (key: IDBValidKey) => request(() => { rows.delete(key); return undefined; }),
          });
          return transaction;
        },
      };
      const opening: Record<string, unknown> = { result: db };
      later(() => {
        if (fresh) (opening.onupgradeneeded as () => void)?.();
        (opening.onsuccess as () => void)?.();
      });
      return opening;
    },
  };
  return { factory, opened };
}

const folder = (name: string): StoredFolderHandle => fakeDirectory(name, [fakeHandle(bytesFile('one', 'a.mp3'))]);

describe('remembered import folders', () => {
  it('remembers, recalls and forgets a folder per workspace in its own database', async () => {
    const { factory, opened } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', factory);
    await rememberFolder('ws-1', folder('Music'));
    await rememberFolder('ws-2', folder('Crates'));
    expect((await recallFolder('ws-1'))?.name).toBe('Music');
    expect((await recallFolder('ws-2'))?.name).toBe('Crates');
    await forgetFolder('ws-1');
    expect(await recallFolder('ws-1')).toBeNull();
    expect((await recallFolder('ws-2'))?.name).toBe('Crates');
    // Never the song index's database, always version 1 of its own.
    expect(opened.every((entry) => entry.name === FOLDERS_DB && entry.version === 1)).toBe(true);
    expect(FOLDERS_DB).not.toBe('selecta-media');
  });

  it('answers null and no-ops where IndexedDB is missing, throws or errors', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(rememberFolder('ws-1', folder('Music'))).resolves.toBeUndefined();
    expect(await recallFolder('ws-1')).toBeNull();
    await expect(forgetFolder('ws-1')).resolves.toBeUndefined();

    vi.stubGlobal('indexedDB', { open: () => { throw new Error('storage disabled'); } });
    expect(await recallFolder('ws-1')).toBeNull();
    await expect(rememberFolder('ws-1', folder('Music'))).resolves.toBeUndefined();

    vi.stubGlobal('indexedDB', {
      open: () => {
        const opening: Record<string, unknown> = {};
        setTimeout(() => (opening.onerror as () => void)?.(), 0);
        return opening;
      },
    });
    expect(await recallFolder('ws-1')).toBeNull();
  });
});
