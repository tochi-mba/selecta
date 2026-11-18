import { describe, expect, it } from 'vitest';
import { runImport } from './importer';
import type { TagReader } from './importer';
import type { DirectoryHandleLike, FileHandleLike } from './store';
import { MediaStore } from './store';
import { bytesFile, captureRequest, fakeDirectory, fakeHandle } from './testFixtures';

// BF-0458-06 (ADR-0458): source files are proven untouched. The import path is importer.ts,
// identity.ts (hashing) and MediaStore.put; nothing on it may delete, move, rename, truncate or
// write a member's file. Proven twice: by reading the source of every module on the path, and at
// run time with handles that record every member reached on them during a whole import.

// Same disk access as importBoundaries.test.ts.
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const source = (name: string) => fs.readFileSync(`${node.cwd()}/src/media/${name}`, 'utf8');
/** Every call that could change or remove a file or directory the member owns. */
const DESTRUCTIVE = /\b(removeEntry|remove|move|rename|unlink|rm|rmdir|truncate|createWritable|createSyncAccessHandle|write|deleteFile|deleteEntry)\s*\(/g;

/** Code only: comments say "never deleted, moved" and must not count. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the import path never deletes or moves a member file', () => {
  it('has no destructive call in the importer or the hashing it uses', () => {
    for (const name of ['importer.ts', 'identity.ts']) {
      expect(code(source(name)).match(DESTRUCTIVE) ?? [], name).toEqual([]);
    }
    // The importer reaches only identity and the store (never a file-system helper).
    const imports = [...code(source('importer.ts')).matchAll(/from '([^']+)'/g)].map((found) => found[1]);
    expect([...new Set(imports)].sort()).toEqual(['./identity', './store']);
  });

  it('keeps the store\'s only file removal inside its own OPFS cache, never on a member handle', () => {
    const store = code(source('store.ts'));
    // MediaStore.put, the one store call the import makes, writes IndexedDB records only.
    const put = store.slice(store.indexOf('async put('), store.indexOf('async get('));
    expect(put.match(DESTRUCTIVE) ?? []).toEqual([]);
    // The one removeEntry and the one createWritable are the derived-data cache, on the OPFS
    // root and on its own `cache-` names (cacheEvict, cacheWrite), not on any picked handle.
    expect(store.match(/removeEntry\s*\(/g)).toHaveLength(1);
    expect(store).toContain('await root.removeEntry(cacheEntryName(key))');
    expect(store).toContain('await root.getFileHandle(cacheEntryName(key), { create: true })');
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
    const summary = await runImport({ source: root, request, store: await MediaStore.open(), deviceId: 'dev', readTags });

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
