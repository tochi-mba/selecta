import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { MediaStore, runImport, saveWatchedFolder, walkFolder, type DirectoryHandleLike, type ImportSummary, type StoredSong, type WalkedFolder, type WatchedFolder } from '../media';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { bytesFile, captureRequest, fakeDirectory, fakeHandle } from '../media/testFixtures';
import {
  addFolder, autoCheck, bindWatch, checkFolders, loadFolders, stopCounts, stopWatching, watchSnapshot, WATCH_INTERVAL_MS,
} from './folderWatch';
import { clearImportSession, importSnapshot, startImportSession } from './importSession';

// The folder watch (cloud.music_folders): folders are checked one after another through the one
// import session, an automatic check waits for a running import and for the interval, and
// stopping watching takes out only the songs no other watched folder holds.

const WS = 'ws-watch';
const summary = (imported: number): ImportSummary => ({ imported, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false });

let store: MediaStore;
let nextId = 100;
let imports: string[][] = [];
let active = 0;
let most = 0;
let unbind: (() => void) | null = null;

/** Stands in for the importer: saves each file as a song with its place, slowly enough that two
 * imports at once would overlap. */
const importer = (async (options) => {
  active += 1;
  most = Math.max(most, active);
  const source = options.source as WalkedFolder | DirectoryHandleLike;
  const files = source.kind === 'walked' ? source.files : await walkFolder(source);
  imports.push(files.map((one) => `${source.name}/${one.path}`));
  for (const one of files) {
    const file = await one.handle.getFile();
    nextId += 1;
    await options.store.put({
      songId: nextId, identity: { content_sha256: `hash-${nextId}`, title: one.path, artist: 'Artist' }, ref: { kind: 'handle', handle: one.handle }, importedAt: 1,
      sources: [{ folderId: options.folderId!, path: one.path, size: file.size, modified: file.lastModified }],
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  active -= 1;
  return summary(files.length);
}) as typeof runImport;

const folder = (name: string, files: string[]) => fakeDirectory(name, files.map((file) => fakeHandle(bytesFile('x', file))));
const record = (id: string, handle: DirectoryHandleLike, checkedAt: number | null): WatchedFolder => ({
  kind: 'folder', id, workspaceId: WS, handle, name: handle.name, addedAt: Number(id.replace(/\D/g, '') || 1), checkedAt, songs: 0, lastNew: 0, missing: 0, state: checkedAt ? 'watching' : 'unchecked',
});

async function start(extras = {}) {
  const { request, calls } = captureRequest();
  unbind = bindWatch({ request, openStore: async () => store, workspaceId: WS, importer }, { extras, firstCheck: false });
  await loadFolders(WS);
  return calls;
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  setFlags({ 'cloud.music_folders': true, 'cloud.resilient_import': false, 'cloud.content_cache': false });
  store = await MediaStore.open(WS);
  imports = [];
  active = 0;
  most = 0;
});

afterEach(() => {
  unbind?.();
  unbind = null;
  clearImportSession();
  setFlags(null);
  vi.unstubAllGlobals();
});

describe('checking folders', () => {
  it('checks folders one after another through the one import, reading only what is new', async () => {
    const a = folder('Music', ['one.mp3', 'two.mp3']);
    const b = folder('Downloads', ['three.mp3']);
    await saveWatchedFolder(record('f1', a, null));
    await saveWatchedFolder(record('f2', b, null));
    await start();
    await checkFolders(['f1', 'f2']);
    expect(imports).toEqual([['Music/one.mp3', 'Music/two.mp3'], ['Downloads/three.mp3']]);
    expect(most).toBe(1);
    const rows = watchSnapshot().rows!;
    expect(rows.map((row) => [row.name, row.songs, row.lastNew, row.state])).toEqual([['Music', 2, 2, 'watching'], ['Downloads', 1, 1, 'watching']]);
    // a second check finds nothing new and reads nothing again
    imports = [];
    await checkFolders(['f1']);
    expect(imports).toEqual([]);
    expect(watchSnapshot().rows![0].lastNew).toBe(0);
  });

  it('says Not found for a folder that was moved, and keeps its songs', async () => {
    const moved: DirectoryHandleLike = { kind: 'directory', name: 'Old', values: () => (async function* () { throw new DOMException('gone', 'NotFoundError'); })() };
    await saveWatchedFolder(record('f1', moved, null));
    await store.put({ songId: 1, identity: { content_sha256: 'h', title: 'Kept', artist: 'A' }, ref: { kind: 'repick', name: 'k.mp3', size: 1 }, importedAt: 1, sources: [{ folderId: 'f1', path: 'k.mp3', size: 1, modified: 1 }] });
    await start();
    await checkFolders(['f1']);
    expect(watchSnapshot().rows![0].state).toBe('missing');
    expect(await store.get(1)).not.toBeNull();
  });

  it('marks a folder whose permission lapsed and does not read it', async () => {
    const asks = Object.assign(folder('Music', ['one.mp3']), { queryPermission: async () => 'prompt' });
    await saveWatchedFolder(record('f1', asks, Date.now()));
    await start();
    expect(watchSnapshot().rows![0].state).toBe('permission');
    autoCheck('all');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(imports).toEqual([]);
  });
});

describe('the automatic check', () => {
  it('waits while an import is running, then checks when it ends', async () => {
    await saveWatchedFolder(record('f1', folder('Music', ['one.mp3']), null));
    await start();
    let finish: (value: ImportSummary) => void = () => {};
    void startImportSession({ source: [], workspaceId: WS, run: () => new Promise((resolve) => { finish = resolve; }) });
    expect(importSnapshot().phase).toBe('running');
    autoCheck('all');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(imports).toEqual([]);
    finish(summary(0));
    await vi.waitFor(() => expect(imports).toEqual([['Music/one.mp3']]), { timeout: 3000 });
  });

  it('checks only folders not checked within the interval when the tab comes back', async () => {
    await saveWatchedFolder(record('f1', folder('Fresh', ['a.mp3']), Date.now() - 5 * 60_000));
    await saveWatchedFolder(record('f2', folder('Stale', ['b.mp3']), Date.now() - WATCH_INTERVAL_MS - 1));
    await start();
    autoCheck('due');
    await vi.waitFor(() => expect(imports).toEqual([['Stale/b.mp3']]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(imports).toEqual([['Stale/b.mp3']]);
  });

  it('waits for the music to pause before an automatic check', async () => {
    await saveWatchedFolder(record('f1', folder('Music', ['one.mp3']), null));
    await start({ playing: () => true });
    autoCheck('all');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(imports).toEqual([]);
    expect(watchSnapshot().waiting).toBe('music');
  });
});

describe('adding a folder', () => {
  it('reads a new folder whole and says so plainly when it is already watched', async () => {
    const music = Object.assign(folder('Music', ['one.mp3']), { isSameEntry: async (other: unknown) => other === music });
    await start();
    const added = await addFolder(music);
    expect(added.kind).toBe('added');
    await vi.waitFor(() => expect(watchSnapshot().rows![0].songs).toBe(1));
    expect(await addFolder(music)).toEqual({ kind: 'same', name: 'Music' });
    expect(watchSnapshot().rows).toHaveLength(1);
  });
});

describe('stop watching', () => {
  const songOf = (songId: number, folders: string[]): StoredSong => ({
    songId, identity: { content_sha256: `hash-${songId}`, title: `Song ${songId}`, artist: 'Artist', duration_s: 120 }, ref: { kind: 'repick', name: `${songId}.mp3`, size: 1 }, importedAt: 1,
    ...(folders.length ? { sources: folders.map((folderId) => ({ folderId, path: `${songId}.mp3`, size: 1, modified: 1 })) } : {}),
  });

  async function twoFolders() {
    await saveWatchedFolder(record('f1', folder('Music', []), Date.now()));
    await saveWatchedFolder(record('f2', folder('Downloads', []), Date.now()));
    await store.put(songOf(1, ['f1']));
    await store.put(songOf(2, ['f1', 'f2']));
    await store.put(songOf(3, []));
    return start();
  }

  it('keeps every song when asked to, forgetting only the folder', async () => {
    const calls = await twoFolders();
    expect(await stopCounts('f1')).toEqual({ only: 1, shared: 1 });
    const result = await stopWatching('f1', false);
    expect(result.removed).toBe(0);
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
    expect((await store.all()).map((song) => song.songId).sort()).toEqual([1, 2, 3]);
    expect((await store.get(1))?.sources).toBeUndefined();
    expect(watchSnapshot().rows!.map((row) => row.id)).toEqual(['f2']);
  });

  it('removes only songs no other watched folder holds, and Undo puts them back', async () => {
    const calls = await twoFolders();
    const result = await stopWatching('f1', true);
    expect(result.removed).toBe(1);
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual(['/api/local-media/songs/1']);
    expect(await store.get(1)).toBeNull();
    expect((await store.get(2))?.sources?.map((one) => one.folderId)).toEqual(['f2']);
    expect(await store.get(3)).not.toBeNull();
    await result.undo();
    const restored = calls.filter((call) => call.method === 'POST' && call.path === '/api/local-media/songs');
    expect((restored[0].body as { songs: { content_sha256: string }[] }).songs.map((one) => one.content_sha256)).toEqual(['hash-1']);
    expect(JSON.stringify(restored[0].body)).not.toContain('1.mp3');
    expect(await store.get(1)).not.toBeNull();
    expect(watchSnapshot().rows!.map((row) => row.id).sort()).toEqual(['f1', 'f2']);
  });
});
