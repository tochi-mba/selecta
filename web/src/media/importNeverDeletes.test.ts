import { describe, expect, it } from 'vitest';
import { runImport } from './importer';
import type { TagReader } from './importer';
import type { DirectoryHandleLike, FileHandleLike } from './store';
import { MediaStore } from './store';
import { bytesFile, captureRequest, fakeDirectory, fakeHandle } from './testFixtures';

// BF-0458-06 (ADR-0458): source files are proven untouched. The import path is importer.ts,
// identity.ts (hashing), tags.ts (reading display tags) and MediaStore.put; nothing on it may delete, move, rename, truncate or
// write a member's file. Proven twice: by reading the source of every module on the path, and at
// run time with handles that record every member reached on them during a whole import.

// Same disk access as importBoundaries.test.ts.
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const source = (name: string) => fs.readFileSync(`${node.cwd()}/src/media/${name}`, 'utf8');
const cloudSource = (name: string) => fs.readFileSync(`${node.cwd()}/src/cloud/${name}`, 'utf8');
/** Every call that could change or remove a file or directory the member owns. */
const DESTRUCTIVE = /\b(removeEntry|remove|move|rename|unlink|rm|rmdir|truncate|createWritable|createSyncAccessHandle|write|deleteFile|deleteEntry)\s*\(/g;

/** Code only: comments say "never deleted, moved" and must not count. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the import path never deletes or moves a member file', () => {
  it('has no destructive call in the importer or the hashing it uses', () => {
    // the journalled path (cloud.resilient_import) writes only its own IndexedDB journal
    // fingerprint reuse (ADR-0469, 7fd14d3b) hashes through identity.ts and keeps its memo in derived.ts's
    // own IndexedDB store, never on a member handle
    // file artwork (ADR-0478, library.art_embedded) reads the picture through tags.ts and keeps it in
    // artStore.ts's own IndexedDB store; its `write(` (defined once, called twice) is that store's put, never a member handle
    for (const name of ['importer.ts', 'identity.ts', 'tags.ts', 'importJournal.ts', 'journalledImport.ts', 'fingerprints.ts', 'art.ts', 'artWorker.ts', 'audioIdentity.ts', 'breathe.ts']) {
      expect(code(source(name)).match(DESTRUCTIVE) ?? [], name).toEqual([]);
    }
    expect(code(source('artStore.ts')).match(DESTRUCTIVE) ?? []).toEqual(['write(', 'write(', 'write(']);
    expect(code(source('artStore.ts'))).toMatch(/async function write\(key: string, row: ArtRow\)[^]*?transaction\.objectStore\(ART\)\.put\(row, key\)/);
    expect([...new Set([...code(source('art.ts')).matchAll(/from '([^']+)'/g)].map((found) => found[1]))].sort()).toEqual(['../flags', './artStore', './artWorker', './breathe', './tags']);
    // The importer reaches only identity, the tag reader and the store (never a file-system helper).
    expect([...code(source('tags.ts')).matchAll(/from '([^']+)'/g)]).toEqual([]);
    const imports = [...code(source('importer.ts')).matchAll(/from '([^']+)'/g)].map((found) => found[1]);
    expect([...new Set(imports)].sort()).toEqual(['../flags', './art', './audioIdentity', './fingerprints', './identity', './importJournal', './journalledImport', './store', './tags']);
    // the audio id (library.audio_identity) reads the file once beside its hash
    const audio = [...code(source('audioIdentity.ts')).matchAll(/from '([^']+)'/g)].map((found) => found[1]);
    expect([...new Set(audio)].sort()).toEqual(['./breathe', './identity']);
    const journalled = [...code(source('journalledImport.ts')).matchAll(/from '([^']+)'/g)].map((found) => found[1]);
    expect([...new Set(journalled)].sort()).toEqual(['./identity', './importJournal', './importer', './store']);
    const journal = [...code(source('importJournal.ts')).matchAll(/from '([^']+)'/g)].map((found) => found[1]);
    expect([...new Set(journal)].sort()).toEqual(['./importer', './store']);
  });

  it('keeps the store\'s only file removal inside its own OPFS cache, never on a member handle', () => {
    const store = code(source('store.ts'));
    // MediaStore.put, the one store call the import makes, writes IndexedDB records only.
    const put = store.slice(store.indexOf('async put('), store.indexOf('async get('));
    expect(put.match(DESTRUCTIVE) ?? []).toEqual([]);
    // Every removeEntry and the one createWritable are the derived-data cache, on the OPFS root
    // and on its own `cache-` names (cacheEvict, cacheWrite's clean-up), not on any picked handle.
    const removals = [...store.matchAll(/([\w$.]+)\.removeEntry\(([^)]*)\)/g)].map((match) => ({
      receiver: match[1],
      target: match[2],
    }));
    // Eviction removes only enumerated cache entries; cache writes and explicit eviction derive
    // their target name from cacheEntryName(key); clearing the device (ADR-0469) removes only
    // enumerated cache entries too. Every remover must stay on the OPFS root.
    expect(removals).toHaveLength(5);
    expect(removals.map(({ receiver }) => receiver)).toEqual(['root', 'root', 'root', 'root', 'root']);
    expect(removals.map(({ target }) => target).sort()).toEqual(['candidate.name', 'entry.name', 'entry.name', 'name', 'name']);
    const enumeration = store.slice(store.indexOf('async function opfsCacheEntries'), store.indexOf('async function evictOldestOpfsCacheEntry'));
    expect(enumeration).toContain("!handle.name?.startsWith('cache-')");
    const cacheWrite = store.slice(store.indexOf('export async function cacheWrite'), store.indexOf('export async function cacheRead'));
    const writeEntry = store.slice(store.indexOf('async function writeCacheEntry'), store.indexOf('export async function cacheWrite'));
    expect(cacheWrite).toContain('const name = cacheEntryName(key)');
    expect(cacheWrite).toContain('writeCacheEntry(root, name, bytes)');
    expect(writeEntry).toContain('await root.getFileHandle(name, { create: true })');
  });

  it('touches nothing but read members on any handle during a whole import', async () => {
    const reached: string[] = [];
    const READ = new Set(['kind', 'name', 'getFile', 'values', 'queryPermission', 'requestPermission', 'state', 'then', 'constructor', 'toJSON']);
    const watched = <T extends object>(target: T, label: string): T => new Proxy(target, {
      get(object, key, receiver) {
        if (typeof key === 'string' && !READ.has(key)) reached.push(`${label}.${key}`);
        const value = Reflect.get(object, key, receiver);
        return value;
      },
      set(_object, key) {
        reached.push(`${label}.${String(key)} =`);
        return true;
      },
      deleteProperty(_object, key) {
        reached.push(`delete ${label}.${String(key)}`);
        return true;
      },
    });
    const files = ['a.mp3', 'b.flac', 'notes.txt', 'c.wav'].map((name, at) => watched(fakeHandle(bytesFile(`song ${at}`, name)), name));
    const inner = watched(fakeDirectory('Sets', [files[3]]) as DirectoryHandleLike, 'Sets');
    const root = watched(fakeDirectory('Music', [files[0], files[1], files[2], inner]) as DirectoryHandleLike, 'Music');
    const { request, calls } = captureRequest();
    const readTags: TagReader = async (file) => ({ title: file.name, artist: 'Artist', duration_s: 1 });
    const summary = await runImport({ source: root, request, store: await MediaStore.open('ws-test'), deviceId: 'dev', readTags });

    expect(summary).toMatchObject({ imported: 3, skipped: 1, failed: 0 });
    expect(reached).toEqual([]);
    // Only metadata went anywhere: registrations and availability, never a file or a delete.
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /api/local-media/songs', 'POST /api/local-media/availability']);
    // And the files are still there, readable, with the same bytes.
    for (const [at, handle] of files.entries()) {
      expect(await (await (handle as FileHandleLike).getFile()).text()).toBe(`song ${at}`);
    }
  });
});

// cloud.move_to_cloud (plan 6b, 6d): uploading a song and playing it from the cloud library only
// reads the member's file and takes the song's row out of this browser's index; nothing on the
// way deletes, moves or writes the file, or takes the song out of the library.
describe('uploading and cloud only never touch a member file', () => {
  it('has no destructive call in the queue, its helpers or cloud only', () => {
    // with the consent sheet and its entry points (plan 6c), which read the device's songs only
    for (const name of ['cloudUploadQueue.ts', 'cloudOnly.ts', 'cloudUploadPacing.ts', 'cloudUploadWords.ts', 'uploadQueueWiring.ts', 'uploadParts.ts', 'uploadConsent.ts', 'uploadEntry.tsx', 'UploadToCloudSheet.tsx']) {
      expect(code(cloudSource(name)).match(DESTRUCTIVE) ?? [], name).toEqual([]);
      // never the folder watch's "stop watching and remove its songs", never the library's remove
      expect(code(cloudSource(name)), name).not.toMatch(/stopWatching|local-media\/songs|removeSongs/);
    }
    // the journal's one write( is its own IndexedDB transaction
    const journal = code(cloudSource('cloudUploadJournal.ts'));
    expect(new Set(journal.match(DESTRUCTIVE))).toEqual(new Set(['write(']));
    expect(journal).toMatch(/function write\(db: IDBDatabase, name: string, change: \(store: IDBObjectStore\) => void\)[^]*?db\.transaction\(name, 'readwrite'\)/);
    // a song leaves the index through MediaStore.remove only; the undo removes nothing
    const store = code(source('store.ts'));
    const keep = store.slice(store.indexOf('async keepInCloudOnly('), store.indexOf('async playHereAgain('));
    expect(keep.match(DESTRUCTIVE)).toEqual(['remove(']);
    expect(keep).toContain('await this.remove(songId)');
    const undo = store.slice(store.indexOf('async playHereAgain('), store.indexOf('private async foundAgain('));
    expect(undo.match(DESTRUCTIVE) ?? []).toEqual([]);
    const found = store.slice(store.indexOf('private async foundAgain('), store.indexOf('async remove('));
    expect(found.match(DESTRUCTIVE) ?? []).toEqual([]);
  });

  it('touches nothing but read members on any handle during a whole upload and its undo', async () => {
    const { bindUploadQueue, endUploadQueue, startUpload, uploadSnapshot } = await import('../cloud/cloudUploadQueue');
    const { playFromThisDeviceAgain } = await import('../cloud/cloudOnly');
    const { fakeUploadServer } = await import('../cloud/testUploadServer');
    const reached: string[] = [];
    const READ = new Set(['kind', 'name', 'getFile', 'queryPermission', 'requestPermission', 'state', 'then', 'constructor', 'toJSON']);
    const watched = <T extends object>(target: T, label: string): T => new Proxy(target, {
      get(object, key, receiver) {
        if (typeof key === 'string' && !READ.has(key)) reached.push(`${label}.${key}`);
        return Reflect.get(object, key, receiver);
      },
      set(_object, key) { reached.push(`${label}.${String(key)} =`); return true; },
      deleteProperty(_object, key) { reached.push(`delete ${label}.${String(key)}`); return true; },
    });
    const store = await MediaStore.open('ws-never-deletes');
    const handles = [1, 2].map((id) => watched(fakeHandle(bytesFile(`upload ${id}`, `song-${id}.mp3`)), `song-${id}`));
    for (const [at, handle] of handles.entries()) {
      await store.put({ songId: at + 1, identity: { content_sha256: `h-upload ${at + 1}`, title: `Song ${at + 1}`, artist: 'A' }, ref: { kind: 'handle', handle }, importedAt: at });
    }
    const server = fakeUploadServer({ partSize: 3 });
    const unbind = bindUploadQueue({
      workspaceId: 'ws-never-deletes', api: server.api, openStore: async () => store, hasUploadConsent: async () => true, fetchImpl: server.fetchImpl,
      hash: async (file) => `h-${await file.text()}`, retryDelay: () => 0,
      pacing: { locks: () => null, online: () => true, battery: async () => null, connection: () => null, phone: () => false },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await expect.poll(() => uploadSnapshot().workspaceId).toBe('ws-never-deletes');
      await startUpload({ songIds: [1, 2] });
      await expect.poll(() => uploadSnapshot().phase, { timeout: 5_000 }).toBe('finished');
      expect(store.cloudOnlyRecords()).toHaveLength(2);
      expect(await playFromThisDeviceAgain(1, { openStore: async () => store })).toBe('restored');
    } finally {
      unbind();
      await endUploadQueue();
    }
    expect(reached).toEqual([]);
    for (const [at, handle] of handles.entries()) expect(await (await handle.getFile()).text()).toBe(`upload ${at + 1}`);
  });
});
