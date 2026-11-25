import { describe, expect, it, vi } from 'vitest';
import {
  FOLDERS_DB, FOLDERS_VERSION, forgetFolder, legacyFolderId, listWatchedFolders, recallFolder, rememberFolder, removeWatchedFolder, saveWatchedFolder,
} from './folders';
import type { StoredFolderHandle, WatchedFolder } from './folders';
import { fakeIndexedDb } from './fakeIndexedDb';
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
    // Never the song index's database, always the current version of its own.
    expect(FOLDERS_VERSION).toBe(2);
    expect(opened.every((entry) => entry.name === FOLDERS_DB && entry.version === FOLDERS_VERSION)).toBe(true);
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

const record = (id: string, workspaceId: string, name: string, addedAt: number): WatchedFolder => ({
  kind: 'folder', id, workspaceId, handle: folder(name), name, addedAt, checkedAt: null, songs: null, lastNew: 0, missing: 0, state: 'unchecked',
});

describe('watched music folders (cloud.music_folders)', () => {
  it('keeps many folders per workspace, oldest first, and removes one without touching the rest', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb());
    expect(await saveWatchedFolder(record('b', 'ws-1', 'Downloads', 2))).toBe(true);
    expect(await saveWatchedFolder(record('a', 'ws-1', 'Music', 1))).toBe(true);
    expect(await saveWatchedFolder(record('c', 'ws-1', 'Crates', 3))).toBe(true);
    expect((await listWatchedFolders('ws-1'))?.map((one) => one.name)).toEqual(['Music', 'Downloads', 'Crates']);
    await removeWatchedFolder('b');
    expect((await listWatchedFolders('ws-1'))?.map((one) => one.id)).toEqual(['a', 'c']);
  });

  it('shows each account only its own folders in a shared browser', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb());
    await saveWatchedFolder(record('a', 'ws-1', 'Mine', 1));
    await saveWatchedFolder(record('b', 'ws-2', 'Theirs', 2));
    expect((await listWatchedFolders('ws-1'))?.map((one) => one.name)).toEqual(['Mine']);
    expect((await listWatchedFolders('ws-2'))?.map((one) => one.name)).toEqual(['Theirs']);
    expect(await listWatchedFolders('ws-3')).toEqual([]);
  });

  it('copies the single remembered folder of version 1 into the list once, without losing it', async () => {
    const factory = fakeIndexedDb();
    vi.stubGlobal('indexedDB', factory);
    // a version 1 database, as the previous release left it
    await new Promise<void>((done) => {
      const opening = factory.open(FOLDERS_DB, 1);
      opening.onupgradeneeded = () => { opening.result.createObjectStore('folders'); };
      opening.onsuccess = () => {
        const transaction = opening.result.transaction('folders', 'readwrite');
        transaction.objectStore('folders').put(folder('Old music'), 'ws-1');
        transaction.oncomplete = () => { opening.result.close(); done(); };
      };
    });
    // two tabs reading at once still make one record
    const [first, second] = await Promise.all([listWatchedFolders('ws-1'), listWatchedFolders('ws-1')]);
    expect(first?.map((one) => one.name)).toEqual(['Old music']);
    expect(second?.map((one) => one.id)).toEqual([legacyFolderId('ws-1')]);
    expect((await listWatchedFolders('ws-1'))?.length).toBe(1);
    // the old offer still finds it
    expect((await recallFolder('ws-1'))?.name).toBe('Old music');
    // stopped watching, it is never brought back by the copy
    await removeWatchedFolder(legacyFolderId('ws-1'));
    expect(await listWatchedFolders('ws-1')).toEqual([]);
    // another account in the same browser is not given it
    expect(await listWatchedFolders('ws-2')).toEqual([]);
  });

  it('degrades quietly: nothing remembered reads as null and a write says it was not kept', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await listWatchedFolders('ws-1')).toBeNull();
    expect(await saveWatchedFolder(record('a', 'ws-1', 'Music', 1))).toBe(false);
    expect(await removeWatchedFolder('a')).toBe(false);
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('storage disabled'); } });
    expect(await listWatchedFolders('ws-1')).toBeNull();
    vi.stubGlobal('indexedDB', {
      open: () => {
        const opening: Record<string, unknown> = {};
        setTimeout(() => (opening.onerror as () => void)?.(), 0);
        return opening;
      },
    });
    expect(await saveWatchedFolder(record('a', 'ws-1', 'Music', 1))).toBe(false);
  });
});
