import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb';
import { deleteImportJournal, fileKey, ImportJournal, journalDbName, type JournalRow } from './importJournal';
import { MEDIA_DB_PREFIX, StorageFullError } from './store';

// The durable import journal (cloud.resilient_import): every file's fingerprint is kept the
// moment it is computed, moves fingerprinted -> registered -> saved, and survives a reopen.

const row = (key: string, state: JournalRow['state'], over: Partial<JournalRow> = {}): JournalRow => ({
  key, importId: 'imp-1', name: key.split('\u0000')[0], state, at: 1,
  entry: { content_sha256: `sha-${key}`, title: 'Song', artist: 'Artist' },
  ...over,
});

let idb: FakeIndexedDb;
beforeEach(() => {
  idb = fakeIndexedDb();
  vi.stubGlobal('indexedDB', idb);
});

describe('importJournal', () => {
  it('keys a file by relative path, size and last-modified time', () => {
    expect(fileKey('A/b.mp3', 10, 5)).toBe(fileKey('A/b.mp3', 10, 5));
    expect(fileKey('A/b.mp3', 10, 5)).not.toBe(fileKey('A/b.mp3', 11, 5));
    expect(fileKey('A/b.mp3', 10, 5)).not.toBe(fileKey('A/b.mp3', 10, 6));
    expect(fileKey('A/b.mp3', 10, 5)).not.toBe(fileKey('B/b.mp3', 10, 5));
  });

  it('lives in its own database per workspace, under the media prefix so a wipe removes it', () => {
    expect(journalDbName('ws 1')).toBe(`${MEDIA_DB_PREFIX}-journal-ws-ws%201`);
    expect(() => journalDbName('')).toThrow();
  });

  it('moves a file through its states and survives a reopen', async () => {
    const key = fileKey('a.mp3', 3, 1);
    const journal = await ImportJournal.open('ws-1');
    expect(journal.degraded).toBe(false);
    await journal.put([row(key, 'fingerprinted')]);
    expect(journal.unsent().map((one) => one.key)).toEqual([key]);
    await journal.put([row(key, 'registered', { songId: 7 })]);
    expect(journal.get(key)?.state).toBe('registered');
    await journal.put([row(key, 'saved', { songId: 7 })]);
    expect(journal.unsent()).toEqual([]);
    journal.close();

    const again = await ImportJournal.open('ws-1');
    expect(again.size).toBe(1);
    expect(again.get(key)).toMatchObject({ state: 'saved', songId: 7 });
    expect(idb.rows(journalDbName('ws-1'), 'files')).toHaveLength(1);
  });

  it('keeps unsent rows across a reopen so a later run sends them', async () => {
    const journal = await ImportJournal.open('ws-1');
    await journal.put([row('one', 'fingerprinted'), row('two', 'registered', { songId: 2 }), row('three', 'saved', { songId: 3 })]);
    journal.close();
    const again = await ImportJournal.open('ws-1');
    expect(again.unsent().map((one) => one.key).sort()).toEqual(['one', 'two']);
  });

  it('clears only when asked, and deleteImportJournal removes the database', async () => {
    const journal = await ImportJournal.open('ws-1');
    await journal.put([row('one', 'fingerprinted')]);
    await journal.clear();
    expect(journal.size).toBe(0);
    journal.close();
    expect((await ImportJournal.open('ws-1')).size).toBe(0);
    await deleteImportJournal('ws-1');
    expect(idb.names()).not.toContain(journalDbName('ws-1'));
  });

  it('workspaces never share rows', async () => {
    const one = await ImportJournal.open('ws-1');
    await one.put([row('a', 'fingerprinted')]);
    const two = await ImportJournal.open('ws-2');
    expect(two.size).toBe(0);
  });

  it('works from memory where IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const journal = await ImportJournal.open('ws-1');
    expect(journal.degraded).toBe(true);
    await journal.put([row('a', 'fingerprinted')]);
    expect(journal.get('a')?.state).toBe('fingerprinted');
  });

  it('a full store pauses the import with StorageFullError, keeping the row for this visit', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = { result: null as unknown, onsuccess: null as (() => void) | null, onupgradeneeded: null as (() => void) | null, onerror: null, onblocked: null };
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => undefined,
          close: () => undefined,
          onversionchange: null,
          transaction: () => {
            const tx = {
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              error: new DOMException('full', 'QuotaExceededError'),
              objectStore: () => ({
                put: () => { setTimeout(() => tx.onabort?.(), 0); return {}; },
                getAll: () => {
                  const got = { result: [] as unknown[], onsuccess: null as (() => void) | null };
                  setTimeout(() => got.onsuccess?.(), 0);
                  return got;
                },
              }),
            };
            return tx;
          },
        };
        setTimeout(() => { request.result = db; request.onsuccess?.(); }, 0);
        return request;
      },
    });
    const journal = await ImportJournal.open('ws-1');
    await expect(journal.put([row('a', 'fingerprinted')])).rejects.toBeInstanceOf(StorageFullError);
    expect(journal.get('a')).not.toBeNull();
  });
});
