import { describe, expect, it } from 'vitest';
import { dropFolderSources, factsOf, planCheck, rebaseSources, relationOf, songsIn, songsOnlyIn, walkFolder, YIELD_EVERY } from './folderCheck';
import type { StoredFolderHandle } from './folders';
import { MediaStore, type FileHandleLike, type StoredSong } from './store';
import { bytesFile, fakeDirectory, fakeHandle } from './testFixtures';

// Checking a watched folder (cloud.music_folders): what is new, changed, missing or already known,
// without reading a known file again; and how a folder being added stands to the ones watched.

const song = (songId: number, sources: StoredSong['sources'], handle?: FileHandleLike): StoredSong => ({
  songId,
  identity: { content_sha256: `hash-${songId}`, title: `Song ${songId}`, artist: 'Artist', duration_s: 100 },
  ref: handle ? { kind: 'handle', handle } : { kind: 'repick', name: `song-${songId}.mp3`, size: 3 },
  importedAt: 1,
  ...(sources ? { sources } : {}),
});

const fact = (path: string, size: number, modified: number) => {
  const name = path.split('/').pop()!;
  return { handle: fakeHandle(bytesFile('x', name)), path, size, modified };
};

describe('planCheck', () => {
  it('sorts files into known, new, changed and missing by place, size and time', async () => {
    const songs = [
      song(1, [{ folderId: 'f', path: 'a.mp3', size: 10, modified: 100 }]),
      song(2, [{ folderId: 'f', path: 'sub/b.mp3', size: 20, modified: 200 }]),
      song(3, [{ folderId: 'f', path: 'gone.mp3', size: 30, modified: 300 }]),
      // another folder's place is not this folder's
      song(4, [{ folderId: 'other', path: 'c.mp3', size: 40, modified: 400 }]),
    ];
    const plan = await planCheck('f', [fact('a.mp3', 10, 100), fact('sub/b.mp3', 21, 201), fact('c.mp3', 40, 400)], songs);
    expect(plan.known).toBe(1);
    expect(plan.fresh.map((one) => one.path)).toEqual(['sub/b.mp3', 'c.mp3']);
    expect(plan.changed).toEqual([{ songId: 2, path: 'sub/b.mp3' }]);
    expect(plan.missing).toEqual([{ songId: 3, path: 'gone.mp3' }]);
    expect(plan.adopt).toEqual([]);
  });

  it('adopts a song imported before watching began when the browser says it is the same file', async () => {
    const original = fakeHandle(bytesFile('x', 'old.mp3')) as FileHandleLike & { isSameEntry?: (other: unknown) => Promise<boolean> };
    const found = fact('crate/old.mp3', 5, 50);
    original.isSameEntry = async (other) => other === found.handle;
    const plan = await planCheck('f', [found], [song(7, undefined, original)]);
    expect(plan.fresh).toEqual([]);
    expect(plan.adopt).toEqual([{ songId: 7, source: { folderId: 'f', path: 'crate/old.mp3', size: 5, modified: 50 } }]);
  });

  it('reads a same-named file as new where the browser cannot compare handles', async () => {
    const plan = await planCheck('f', [fact('old.mp3', 5, 50)], [song(7, undefined, fakeHandle(bytesFile('x', 'old.mp3')))]);
    expect(plan.fresh.map((one) => one.path)).toEqual(['old.mp3']);
  });
});

// cloud.move_to_cloud: a song played from the cloud library only is never added back by a check
describe('planCheck with songs played from the cloud library only', () => {
  const kept = async (songId: number, sources: StoredSong['sources']) => {
    const store = await MediaStore.open('ws-check-cloud-only');
    await store.put(song(songId, sources, fakeHandle(bytesFile('x', 'kept.mp3'))));
    await store.keepInCloudOnly(songId);
    return store;
  };

  it('skips an unchanged file and counts it as excluded, never as missing', async () => {
    const store = await kept(5, [{ folderId: 'f', path: 'kept.mp3', size: 10, modified: 100 }]);
    const plan = await planCheck('f', [fact('kept.mp3', 10, 100)], await store.all(), undefined, store.cloudOnlyRecords());
    expect(plan).toMatchObject({ fresh: [], known: 0, excluded: 1, missing: [], changed: [] });
    // its file gone from the folder is not "missing" either: it is not this device's song now
    const gone = await planCheck('f', [], await store.all(), undefined, store.cloudOnlyRecords());
    expect(gone.missing).toEqual([]);
  });

  it('reads a changed file again; still that song, it stays out and is noted as a newer copy', async () => {
    const store = await kept(5, [{ folderId: 'f', path: 'kept.mp3', size: 10, modified: 100 }]);
    const plan = await planCheck('f', [fact('kept.mp3', 12, 300)], await store.all(), undefined, store.cloudOnlyRecords());
    expect(plan.fresh.map((one) => one.path)).toEqual(['kept.mp3']);
    expect(plan.excluded).toBe(0);
    // the importer registers it, the account says it is the same song (its audio id), and the
    // index keeps it out, remembering the new place so the next check skips it
    await store.put({ ...song(5, [{ folderId: 'f', path: 'kept.mp3', size: 12, modified: 300 }], fakeHandle(bytesFile('y', 'kept.mp3'))), identity: { content_sha256: 'hash-retagged', title: 'Song 5', artist: 'Artist' } });
    expect(await store.get(5)).toBeNull();
    expect(store.cloudOnlyRecord(5)?.newerCopy?.sha).toBe('hash-retagged');
    const again = await planCheck('f', [fact('kept.mp3', 12, 300)], await store.all(), undefined, store.cloudOnlyRecords());
    expect(again).toMatchObject({ fresh: [], excluded: 1 });
  });

  it('imports a genuinely different song at that place as usual', async () => {
    const store = await kept(5, [{ folderId: 'f', path: 'kept.mp3', size: 10, modified: 100 }]);
    await store.put(song(6, [{ folderId: 'f', path: 'kept.mp3', size: 99, modified: 400 }], fakeHandle(bytesFile('z', 'kept.mp3'))));
    expect((await store.get(6))?.songId).toBe(6);
    expect(store.isCloudOnly(6)).toBe(false);
    expect(store.cloudOnlyRecord(5)?.newerCopy).toBeUndefined();
  });
});

describe('walking a folder', () => {
  it('finds audio files at their places and hands the page back as it goes, even for thousands', async () => {
    const many = Array.from({ length: YIELD_EVERY * 40 }, (_, index) => fakeHandle(bytesFile('x', `track-${index}.mp3`)));
    const nested = fakeDirectory('Big', [fakeDirectory('Disc 1', many), fakeHandle(bytesFile('x', 'cover.jpg')), fakeHandle(bytesFile('x', 'intro.flac'))]);
    const progress: number[] = [];
    const files = await walkFolder(nested, { onFound: (count) => progress.push(count) });
    expect(files).toHaveLength(many.length + 1);
    expect(files[0].path).toBe('Disc 1/track-0.mp3');
    expect(files.at(-1)!.path).toBe('intro.flac');
    expect(progress.length).toBeGreaterThan(10);
    const facts = await factsOf(files);
    expect(facts[0]).toMatchObject({ path: 'Disc 1/track-0.mp3', size: 1 });
  });

  it('stops cleanly when asked to', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(walkFolder(fakeDirectory('Music', [fakeHandle(bytesFile('x', 'a.mp3'))]), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

/** A folder handle that knows its own place, as File System Access handles do. */
function placed(path: string[]): StoredFolderHandle & { path: string[] } {
  const handle: StoredFolderHandle & { path: string[] } = {
    kind: 'directory',
    name: path.at(-1)!,
    path,
    values: () => (async function* () { /* empty */ })(),
    isSameEntry: async (other) => (other as { path: string[] }).path.join('/') === path.join('/'),
    resolve: async (other) => {
      const theirs = (other as { path: string[] }).path;
      return theirs.length > path.length && path.every((part, at) => theirs[at] === part) ? theirs.slice(path.length) : null;
    },
  };
  return handle;
}

describe('relationOf', () => {
  it('says the same folder, a folder inside one watched, or the parent of one watched', async () => {
    expect(await relationOf(placed(['Music']), placed(['Music']))).toEqual({ relation: 'same', path: [] });
    expect(await relationOf(placed(['Music', 'House']), placed(['Music']))).toEqual({ relation: 'inside', path: ['House'] });
    expect(await relationOf(placed(['Music']), placed(['Music', 'House', 'Deep']))).toEqual({ relation: 'parent', path: ['House', 'Deep'] });
    expect(await relationOf(placed(['Downloads']), placed(['Music']))).toBeNull();
  });

  it('treats handles that cannot compare as unrelated', async () => {
    expect(await relationOf(fakeDirectory('A', []), fakeDirectory('A', []))).toBeNull();
  });
});

describe('songs and their folders', () => {
  const songs = [
    song(1, [{ folderId: 'a', path: 'one.mp3', size: 1, modified: 1 }]),
    song(2, [{ folderId: 'a', path: 'two.mp3', size: 1, modified: 1 }, { folderId: 'b', path: 'two.mp3', size: 1, modified: 1 }]),
    song(3, [{ folderId: 'a', path: 'three.mp3', size: 1, modified: 1 }, { folderId: 'gone', path: 'three.mp3', size: 1, modified: 1 }]),
    song(4, undefined),
  ];

  it('counts each song once per folder', () => {
    expect(songsIn('a', songs)).toBe(3);
    expect(songsIn('b', songs)).toBe(1);
  });

  it('removes only songs no other watched folder holds; loose songs are never taken', () => {
    expect(songsOnlyIn('a', songs, new Set(['b'])).map((one) => one.songId)).toEqual([1, 3]);
    expect(songsOnlyIn('a', songs, new Set(['b', 'gone'])).map((one) => one.songId)).toEqual([1]);
  });

  it('forgets a folder\'s places, and moves children under a parent without reading again', async () => {
    const store = await MediaStore.open('ws-check');
    for (const one of songs) await store.put(one);
    await rebaseSources(store, 'b', 'parent', ['Crates', 'B']);
    expect((await store.get(2))?.sources?.find((one) => one.folderId === 'parent')?.path).toBe('Crates/B/two.mp3');
    await dropFolderSources(store, 'a');
    expect((await store.get(1))?.sources).toBeUndefined();
    expect((await store.get(2))?.sources?.map((one) => one.folderId)).toEqual(['parent']);
    expect(await store.get(1)).not.toBeNull();
  });
});
