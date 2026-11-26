import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIndexedDb, type FakeIndexedDb } from '../media/fakeIndexedDb';
import { bytesSha256 } from '../media/identity';
import { runImport, type TagReader } from '../media/importer';
import { makeCoexistingResolver, makeResolver } from '../media/resolve';
import { mediaDbName, MediaStore, resetLegacyDisposalForTests, type StoredSong } from '../media/store';
import { bytesFile, captureRequest, fakeDirectory, fakeHandle } from '../media/testFixtures';
import { answerOtherDevices, cloudOnlyFacts, otherDevicesAnswer, otherDevicesQuestion, playFromThisDeviceAgain } from './cloudOnly';

// Playing a song from the cloud library only on this device (cloud.move_to_cloud, plan 6d): the
// record keeps the whole row, a reload keeps it, no import adds it back, "Play from this device
// again" undoes it, the song playing now keeps its sound, and other devices are asked once.

const WS = 'ws-cloud-only';
let idb: FakeIndexedDb;

beforeEach(() => {
  idb = fakeIndexedDb();
  vi.stubGlobal('indexedDB', idb);
  resetLegacyDisposalForTests();
});

const encoder = new TextEncoder();

async function songWith(songId: number, text: string, ref: 'handle' | 'repick' = 'handle', broken = false): Promise<StoredSong> {
  const file = bytesFile(text, `song-${songId}.mp3`);
  return {
    songId,
    identity: { content_sha256: await bytesSha256(encoder.encode(text).buffer as ArrayBuffer), title: `Song ${songId}`, artist: 'Artist' },
    ref: ref === 'handle' ? { kind: 'handle', handle: fakeHandle(file, { broken }) } : { kind: 'repick', name: file.name, size: file.size },
    importedAt: songId,
    sources: [{ folderId: 'f1', path: `song-${songId}.mp3`, size: file.size, modified: file.lastModified }],
  };
}

describe('the record and its undo', () => {
  it('keeps the whole row, handle and places, and a reload keeps the song out', async () => {
    const store = await MediaStore.open(WS);
    const row = await songWith(1, 'one');
    await store.put(row);
    const record = await store.keepInCloudOnly(1, 1234);
    expect(record).toMatchObject({ songId: 1, row, handle: row.ref.kind === 'handle' ? row.ref.handle : null, sources: row.sources, at: 1234 });
    expect(await store.get(1)).toBeNull();
    expect(idb.rows(mediaDbName(WS), 'songs')).toEqual([]);
    expect(idb.rows(mediaDbName(WS), 'in_cloud_only')).toHaveLength(1);
    const reopened = await MediaStore.open(WS);
    expect(await reopened.get(1)).toBeNull();
    expect(reopened.isCloudOnly(1)).toBe(true);
    expect(await cloudOnlyFacts(1, { openStore: async () => reopened })).toEqual({ cloudOnly: true, newerCopy: false, since: 1234 });
  });

  it('finishes a switch or an undo that stopped between its two writes', async () => {
    const store = await MediaStore.open(WS);
    const one = await songWith(1, 'one');
    const two = await songWith(2, 'two');
    await store.put(one);
    await store.put(two);
    await store.keepInCloudOnly(1);
    await store.keepInCloudOnly(2);
    // song 1: its row came back but the record stayed (a stopped switch): the record wins;
    // song 2: an undo stopped after marking its record: the row comes back
    const db = await new Promise<IDBDatabase>((resolve) => { const opening = indexedDB.open(mediaDbName(WS), 2); opening.onsuccess = () => resolve(opening.result); });
    await new Promise<void>((resolve) => { const tx = db.transaction('songs', 'readwrite'); tx.oncomplete = () => resolve(); tx.objectStore('songs').put(one); });
    await new Promise<void>((resolve) => { const tx = db.transaction('in_cloud_only', 'readwrite'); tx.oncomplete = () => resolve(); tx.objectStore('in_cloud_only').put({ ...store.cloudOnlyRecord(2), restoring: true }); });
    const reopened = await MediaStore.open(WS);
    expect(await reopened.get(1)).toBeNull();
    expect(reopened.isCloudOnly(1)).toBe(true);
    expect((await reopened.get(2))?.songId).toBe(2);
    expect(reopened.isCloudOnly(2)).toBe(false);
  });

  it('plays from this device again: with its handle it is back; without one it needs choosing again', async () => {
    const store = await MediaStore.open(WS);
    const told: number[] = [];
    const parts = { openStore: async () => store, onAvailabilityChanged: () => { told.push(1); } };
    await store.put(await songWith(1, 'one'));
    await store.put(await songWith(2, 'two', 'repick'));
    await store.put(await songWith(3, 'three', 'handle', true));
    for (const id of [1, 2, 3]) await store.keepInCloudOnly(id);
    expect(await playFromThisDeviceAgain(1, parts)).toBe('restored');
    expect(await playFromThisDeviceAgain(2, parts)).toBe('choose_again');
    // the file was moved or deleted since: back on the list, and it asks to choose the file
    expect(await playFromThisDeviceAgain(3, parts)).toBe('choose_again');
    expect(await playFromThisDeviceAgain(4, parts)).toBe('not_found');
    expect((await store.all()).map((song) => song.songId).sort()).toEqual([1, 2, 3]);
    expect((await store.get(1))?.sources).toEqual((await songWith(1, 'one')).sources);
    expect(store.cloudOnlyRecords()).toEqual([]);
    expect(told).toHaveLength(3);
    expect(idb.rows(mediaDbName(WS), 'in_cloud_only')).toEqual([]);
  });
});

describe('imports and checks never add it back', () => {
  const readTags: TagReader = async (file) => ({ title: file.name, artist: 'Artist', duration_s: 10 });

  it('the same file imported again stays out and is never reported as held here', async () => {
    const store = await MediaStore.open(WS);
    const { request, calls } = captureRequest();
    const files = [fakeHandle(bytesFile('one', 'one.mp3')), fakeHandle(bytesFile('two', 'two.mp3'))];
    await runImport({ source: fakeDirectory('Music', files), request, store, deviceId: 'dev', readTags, folderId: 'f1' });
    expect((await store.all()).map((song) => song.songId).sort()).toEqual([1, 2]);
    await store.keepInCloudOnly(1);
    calls.length = 0;
    await runImport({ source: fakeDirectory('Music', files), request, store, deviceId: 'dev', readTags, folderId: 'f1' });
    expect((await store.all()).map((song) => song.songId)).toEqual([2]);
    expect(store.isCloudOnly(1)).toBe(true);
    const reported = calls.filter((call) => call.path === '/api/local-media/availability').flatMap((call) => (call.body as { present: number[] }).present);
    expect(reported).toEqual([2]);
    // a file picked again this visit never plays as it either
    store.attachSessionFile(1, bytesFile('one', 'one.mp3'));
    expect(store.sessionFile(1)).toBeNull();
  });
});

describe('a song playing when it switches to cloud only', () => {
  it('keeps the sound it already has; the next load plays from the cloud library', async () => {
    const store = await MediaStore.open(WS);
    await store.put(await songWith(1, 'the device bytes'));
    const cloudBytes = encoder.encode('the cloud bytes').buffer as ArrayBuffer;
    const resolve = makeCoexistingResolver({ device: makeResolver(store, async () => null), hosted: async (id) => ({ id, data: async () => cloudBytes }) });
    const playing = await resolve(1);
    expect(playing?.source).toBe('device');
    const decoded = new TextDecoder().decode(await playing!.data());
    await store.keepInCloudOnly(1);
    // the song now playing goes on from what it already read
    expect(decoded).toBe('the device bytes');
    expect(new TextDecoder().decode(await playing!.data())).toBe('the device bytes');
    // from the next load it is the cloud library's copy
    const next = await resolve(1);
    expect(next?.source).toBe('hosted');
    expect(new TextDecoder().decode(await next!.data())).toBe('the cloud bytes');
  });
});

describe('the question for this device when another device uploaded its songs', () => {
  it('is asked once, about songs in the cloud library that this device did not upload itself', async () => {
    const store = await MediaStore.open(WS);
    for (const id of [1, 2, 3, 4]) await store.put(await songWith(id, `song ${id}`));
    const inCloud = (id: number) => id !== 4;
    const question = await otherDevicesQuestion({ store, workspaceId: WS, inCloud, except: new Set([3]) });
    expect(question).toEqual({ songIds: [1, 2], words: '2 songs on this device are now in your cloud library. Play them from your cloud library only?' });
    expect(await answerOtherDevices(WS, 'cloud_only', question!.songIds, { openStore: async () => store })).toBe(2);
    expect(otherDevicesAnswer(WS)).toBe('cloud_only');
    expect((await store.all()).map((song) => song.songId).sort()).toEqual([3, 4]);
    expect(await otherDevicesQuestion({ store, workspaceId: WS, inCloud: () => true })).toBeNull();
  });

  it('says one song plainly, and a "keep" answer switches nothing', async () => {
    const store = await MediaStore.open(WS);
    await store.put(await songWith(1, 'one'));
    const question = await otherDevicesQuestion({ store, workspaceId: WS, inCloud: () => true });
    expect(question?.words).toBe('1 song on this device is now in your cloud library. Play it from your cloud library only?');
    expect(await answerOtherDevices(WS, 'keep', [1], { openStore: async () => store })).toBe(0);
    expect(await store.get(1)).not.toBeNull();
    expect(await otherDevicesQuestion({ store, workspaceId: WS, inCloud: () => true })).toBeNull();
  });
});
