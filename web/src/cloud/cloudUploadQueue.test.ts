import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudError } from './api';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { MediaStore, resetLegacyDisposalForTests, type StoredSong } from '../media/store';
import { bytesFile, fakeHandle } from '../media/testFixtures';
import type { BatteryLike, ConnectionLike, Pacing } from './cloudUploadPacing';
import {
  answerMobileData, bindUploadQueue, cancelUploads, chooseFilesAgain, endUploadQueue, PLAN_BATCH, pauseUploads, resumeUploads, startUpload,
  uploadRows, uploadSnapshot, type UploadQueueParts,
} from './cloudUploadQueue';
import { fakeUploadServer, type FakeServerOptions } from './testUploadServer';

// The upload queue (cloud.move_to_cloud, plan 6b and 6d): order, every outcome, the full library,
// the grant revoked, consent, batches of 100, holds that lapsed, carrying on after a reload, one
// tab running it, pause, resume and cancel, mobile data, the battery and parts in flight.

const WS = 'ws-up';
const hash = async (file: Blob) => `h-${await file.text()}`;
const NO_DEVICE: Pacing = { locks: () => null, online: () => true, battery: async () => null, connection: () => null, phone: () => false };

type Spec = { id: number; text: string; name?: string; at?: number; ref?: 'handle' | 'repick'; permission?: string; broken?: boolean; sha?: string };

function songOf(spec: Spec): StoredSong {
  const name = spec.name ?? `song-${spec.id}.mp3`;
  const file = bytesFile(spec.text, name);
  return {
    songId: spec.id,
    identity: { content_sha256: spec.sha ?? `h-${spec.text}`, title: `Song ${spec.id}`, artist: 'Artist', duration_s: 200 },
    ref: spec.ref === 'repick' ? { kind: 'repick', name, size: file.size } : { kind: 'handle', handle: fakeHandle(file, { permission: spec.permission ?? 'granted', broken: spec.broken ?? false }) },
    importedAt: spec.at ?? spec.id,
  };
}

let store: MediaStore;
let unbind: (() => void) | null = null;

async function setup(options: FakeServerOptions, specs: Spec[], extra: Partial<UploadQueueParts> = {}) {
  const server = fakeUploadServer(options);
  store = await MediaStore.open(WS);
  for (const spec of specs) await store.put(songOf(spec));
  const reports: number[] = [];
  unbind = bindUploadQueue({
    workspaceId: WS, api: server.api, openStore: async () => store, hasUploadConsent: async () => true, fetchImpl: server.fetchImpl,
    hash, retryDelay: () => 0, onAvailabilityChanged: () => { reports.push(Date.now()); }, ...extra, pacing: { ...NO_DEVICE, ...(extra.pacing ?? {}) },
  });
  await vi.waitFor(() => expect(uploadSnapshot().workspaceId).toBe(WS));
  return { server, reports };
}

const finished = () => vi.waitFor(() => expect(uploadSnapshot().phase).toBe('finished'), { timeout: 8_000 });
const outcomes = () => Object.fromEntries(uploadRows().map((row) => [row.songId, row.outcome]));
const previewed = (server: ReturnType<typeof fakeUploadServer>) => server.calls.filter((call) => call.path === '/uploads/preview').map((call) => (call.body as { files: { song_id: number }[] }).files.map((file) => file.song_id));

beforeEach(() => {
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  resetLegacyDisposalForTests();
});

afterEach(async () => {
  unbind?.();
  unbind = null;
  await endUploadQueue();
});

describe('uploading songs from this device', () => {
  it('uploads songs in the current mix first, then the newest, and plays them from the cloud library only', async () => {
    const { server, reports } = await setup({}, [1, 2, 3, 4].map((id) => ({ id, text: `song ${id} bytes` })), { mixSongs: () => [2] });
    expect(await startUpload({ songIds: [1, 2, 3, 4] })).toEqual({ ok: true, queued: 4, choose: 0 });
    await finished();
    expect(previewed(server)).toEqual([[2, 4, 3, 1]]);
    expect(outcomes()).toEqual({ 1: 'uploaded', 2: 'uploaded', 3: 'uploaded', 4: 'uploaded' });
    // every part of every file went once, and each song left this device's list for its record
    expect(server.puts).toHaveLength(4 * 4);
    expect(new Set(server.puts.map((put) => put.url)).size).toBe(server.puts.length);
    expect(await store.all()).toEqual([]);
    expect(store.cloudOnlyRecords().map((record) => record.songId).sort()).toEqual([1, 2, 3, 4]);
    expect(reports.length).toBeGreaterThan(0);
    expect(uploadSnapshot().words).toBe('Uploaded 4 songs to your cloud library.');
  });

  it('keeps a song on this device when the member asked, or when the server named another song', async () => {
    const { server } = await setup({ acceptAs: (id) => (id === 2 ? 99 : id ?? undefined) }, [{ id: 1, text: 'one' }, { id: 2, text: 'two' }, { id: 3, text: 'three' }]);
    await startUpload({ songIds: [3], keepHere: true });
    await finished();
    await startUpload({ songIds: [1, 2] });
    await finished();
    expect(outcomes()).toEqual({ 1: 'uploaded', 2: 'uploaded' });
    expect(server.sessions.size).toBe(3);
    // 1 is cloud only; 2 came back as another song id and 3 was kept here, so both stay
    expect((await store.all()).map((song) => song.songId).sort()).toEqual([2, 3]);
    expect(store.isCloudOnly(1)).toBe(true);
  });

  it('gives every song its own outcome, and nothing is sent for a file that changed', async () => {
    const { server } = await setup({ inCloud: new Set([2]), refuse: new Map([[3, 'too_large']]), reject: new Map([[9, 'song_mismatch']]) }, [
      { id: 1, text: 'fine' },
      { id: 2, text: 'already there' },
      { id: 3, text: 'too big' },
      { id: 4, text: 'edited since', sha: 'h-the bytes it was added with' },
      { id: 5, text: 'moved away', broken: true },
      { id: 6, text: 'not allowed', permission: 'prompt' },
      { id: 9, text: 'not this song' },
    ]);
    await startUpload({ songIds: [1, 2, 3, 4, 5, 6, 9] });
    await finished();
    expect(outcomes()).toEqual({ 1: 'uploaded', 2: 'in_cloud_library', 3: 'refused', 4: 'changed', 5: 'choose_again', 6: 'permission_again', 9: 'refused' });
    expect(uploadRows().find((row) => row.songId === 3)?.reason).toBe('too_large');
    expect(uploadRows().find((row) => row.songId === 9)?.reason).toBe('song_mismatch');
    // the changed, moved and not-allowed files were never previewed, planned or sent
    expect(previewed(server).flat().sort()).toEqual([1, 2, 3, 9]);
    // already in the cloud library as this very song: it plays from there only too
    expect(store.isCloudOnly(2)).toBe(true);
    // refused, changed and unread songs stay on this device as they were
    expect((await store.all()).map((song) => song.songId).sort()).toEqual([3, 4, 5, 6, 9]);
    expect(uploadSnapshot().words).toContain('1 already in your cloud library, 2 not accepted, 1 changed on this device since it was added');
  });

  it('waits for files a browser cannot read twice, matched by name and size and confirmed by hash', async () => {
    const { server } = await setup({}, [{ id: 7, text: 'picked once', ref: 'repick' }, { id: 8, text: 'picked too', ref: 'repick' }]);
    expect(await startUpload({ songIds: [7, 8] })).toEqual({ ok: true, queued: 2, choose: 2 });
    await vi.waitFor(() => expect(uploadSnapshot().choose.map((one) => one.songId)).toEqual([7, 8]));
    expect(server.calls).toEqual([]);
    const answer = await chooseFilesAgain([bytesFile('picked once', 'song-7.mp3'), bytesFile('different!!', 'song-8.mp3'), bytesFile('x', 'other.mp3')]);
    expect(answer).toEqual({ matched: 1, changed: 1, unmatched: 1 });
    await finished();
    expect(outcomes()).toEqual({ 7: 'uploaded', 8: 'changed' });
  });

  it('lets go of a song taken out of SelectaDJ while it waited', async () => {
    const connection: ConnectionLike = { type: 'cellular' };
    const { server } = await setup({}, [{ id: 1, text: 'stays' }, { id: 8, text: 'goes' }], { pacing: { connection: () => connection } });
    await startUpload({ songIds: [1, 8] });
    await vi.waitFor(() => expect(uploadSnapshot().phase).toBe('asking'));
    await store.remove(8);
    await answerMobileData('now');
    await finished();
    expect(outcomes()).toEqual({ 1: 'uploaded', 8: 'removed' });
    expect(previewed(server)).toEqual([[1]]);
  });
});

describe('stopping honestly', () => {
  it('stops at the first file that will not fit, says what waits, and carries on once there is room', async () => {
    const { server } = await setup({ room: 25 }, [1, 2, 3, 4].map((id) => ({ id, text: `ten bytes${id}` })));
    await startUpload({ songIds: [1, 2, 3, 4] });
    await vi.waitFor(() => expect(uploadSnapshot().phase).toBe('stopped'));
    expect(uploadSnapshot().stop).toBe('quota');
    expect(outcomes()).toEqual({ 1: 'uploaded', 2: 'uploaded', 3: null, 4: null });
    expect(uploadSnapshot().words).toBe('Your cloud library is full. 2 songs uploaded. 2 songs wait.');
    server.setRoom(1_000);
    await resumeUploads();
    await finished();
    expect(outcomes()).toEqual({ 1: 'uploaded', 2: 'uploaded', 3: 'uploaded', 4: 'uploaded' });
  });

  it('stops with a plain reason when the grant is revoked part way', async () => {
    // the grant goes once the first file is done: the second file's parts are refused
    const { server } = await setup({
      fail: (method, path) => (method === 'POST' && path === '/uploads/s2/parts' ? new CloudError('Cloud uploads isn’t available on this account right now.', 403, 'flag_off') : null),
    }, [{ id: 1, text: 'first' }, { id: 2, text: 'second' }], { mixSongs: () => [1, 2] });
    await startUpload({ songIds: [1, 2] });
    await vi.waitFor(() => expect(uploadSnapshot().phase).toBe('stopped'));
    expect(outcomes()[1]).toBe('uploaded');
    expect(uploadSnapshot().stop).toBe('grant');
    expect(uploadSnapshot().words).toBe('Uploading to your cloud library isn\'t available on this account right now. 1 song waits. Songs already uploaded stay in your cloud library.');
    expect(store.isCloudOnly(2)).toBe(false);
    const sent = server.puts.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.puts.length).toBe(sent);
  });

  it('starts nothing without recorded consent', async () => {
    const { server } = await setup({}, [{ id: 1, text: 'one' }], { hasUploadConsent: async () => false });
    expect(await startUpload({ songIds: [1] })).toEqual({ ok: false, why: 'consent' });
    expect(server.calls).toEqual([]);
    expect(uploadRows()).toEqual([]);
  });
});

describe('pacing the work', () => {
  it('plans in batches of at most 100', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const specs = Array.from({ length: 230 }, (_, at) => ({ id: at + 1, text: `s${at + 1}`, at: 1_000 - at }));
    const { server } = await setup({ partSize: 1_000 }, specs);
    await startUpload({ songIds: specs.map((spec) => spec.id) });
    await finished();
    expect(PLAN_BATCH).toBe(100);
    expect(previewed(server).map((batch) => batch.length)).toEqual([100, 100, 30]);
    const plans = server.calls.filter((call) => call.path === '/uploads/plan').map((call) => (call.body as { files: unknown[] }).files.length);
    expect(plans).toEqual([100, 100, 30]);
    expect(uploadSnapshot().counts.uploaded).toBe(230);
  }, 20_000);

  it('plans a song again once its two-day hold has lapsed', async () => {
    let lapse = true;
    const { server } = await setup({ holdSeconds: () => (lapse ? -60 : 2 * 24 * 3600) }, [{ id: 1, text: 'held too long' }]);
    await startUpload({ songIds: [1] });
    await vi.waitFor(() => expect(server.calls.filter((call) => call.path === '/uploads/plan')).toHaveLength(1));
    lapse = false;
    await finished();
    expect(server.routes()).toContain('DELETE /uploads/{id}');
    expect(server.sessions.get('s1')?.status).toBe('cancelled');
    expect(server.sessions.get('s2')?.status).toBe('accepted');
    expect(outcomes()).toEqual({ 1: 'uploaded' });
  });

  it('keeps up to three parts in flight, and one after a failed part', async () => {
    const { server } = await setup({ partSize: 1, putDelay: 5, failPut: (_url, attempt) => attempt === 7 && (server.resetMost(), true) }, [{ id: 1, text: 'twelve bytes' }]);
    await startUpload({ songIds: [1] });
    await finished();
    expect(server.sessions.get('s1')?.parts.size).toBe(12);
    // after the failure the queue sent one part at a time
    expect(server.mostInFlight()).toBe(1);
    expect(outcomes()).toEqual({ 1: 'uploaded' });
  });

  it('sends three parts at once, and one at a time while music plays here', async () => {
    const quick = await setup({ partSize: 1, putDelay: 5 }, [{ id: 1, text: 'twelve bytes' }]);
    await startUpload({ songIds: [1] });
    await finished();
    expect(quick.server.mostInFlight()).toBe(3);
    unbind?.();
    await endUploadQueue();
    const playing = await setup({ partSize: 1, putDelay: 5 }, [{ id: 2, text: 'twelve again' }], { playing: () => true });
    await startUpload({ songIds: [2] });
    await finished();
    expect(playing.server.mostInFlight()).toBe(1);
  });

  it('asks before mobile data, and waits for Wi-Fi when asked to', async () => {
    let change = () => {};
    const connection: ConnectionLike = { type: 'cellular', addEventListener: (_type, listen) => { change = listen; }, removeEventListener: () => {} };
    const { server } = await setup({}, [{ id: 1, text: '0123456789' }, { id: 2, text: 'abcdefghij' }], { pacing: { connection: () => connection } });
    await startUpload({ songIds: [1, 2] });
    await vi.waitFor(() => expect(uploadSnapshot().phase).toBe('asking'));
    expect(uploadSnapshot().ask).toEqual({ kind: 'mobile_data', bytes: 20 });
    expect(server.calls).toEqual([]);
    await answerMobileData('wifi');
    await vi.waitFor(() => expect(uploadSnapshot().waiting).toBe('wifi'));
    expect(uploadSnapshot().phase).toBe('paused');
    connection.type = 'wifi';
    change();
    await finished();
    expect(outcomes()).toEqual({ 1: 'uploaded', 2: 'uploaded' });
  });

  it('pauses below 20% battery when not charging, saying why, and carries on when charging', async () => {
    let change = () => {};
    const battery: BatteryLike = { level: 0.12, charging: false, addEventListener: (_type, listen) => { change = listen; }, removeEventListener: () => {} };
    const { server } = await setup({}, [{ id: 1, text: 'low battery' }], { pacing: { battery: async () => battery } });
    await startUpload({ songIds: [1] });
    await vi.waitFor(() => expect(uploadSnapshot().waiting).toBe('battery'));
    expect(uploadSnapshot().words).toBe('Paused: the battery is below 20%. Uploads carry on when this device is charging.');
    expect(server.puts).toEqual([]);
    battery.charging = true;
    change();
    await finished();
  });
});

describe('pause, resume and cancel', () => {
  it('pauses with the part on its way dropped, and resumes where it stopped', async () => {
    const { server } = await setup({ partSize: 2, putDelay: 15 }, [{ id: 1, text: 'abcdefgh' }, { id: 2, text: 'ijklmnop' }]);
    await startUpload({ songIds: [1, 2] });
    await vi.waitFor(() => expect(server.puts.length).toBeGreaterThan(0));
    await pauseUploads();
    expect(uploadSnapshot().phase).toBe('paused');
    expect(uploadSnapshot().words).toBe('Uploads paused. 2 songs wait.');
    await new Promise((resolve) => setTimeout(resolve, 60));
    const held = server.puts.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(server.puts.length).toBe(held);
    await resumeUploads();
    await finished();
    expect(new Set(server.puts.map((put) => put.url)).size).toBe(server.puts.length);
    expect(outcomes()).toEqual({ 1: 'uploaded', 2: 'uploaded' });
  });

  it('cancels: what has not gone stays on this device, and its holds are let go', async () => {
    const { server } = await setup({ partSize: 2, putDelay: 15 }, [{ id: 1, text: 'abcd' }, { id: 2, text: 'efgh' }, { id: 3, text: 'ijkl' }]);
    await startUpload({ songIds: [1, 2, 3] });
    await vi.waitFor(() => expect(outcomes()[1]).toBe('uploaded'));
    await cancelUploads();
    expect(uploadSnapshot().phase).toBe('finished');
    expect(uploadSnapshot().cancelled).toBe(true);
    expect(uploadSnapshot().words).toBe('Uploads cancelled. 1 song uploaded; the rest stay on this device.');
    await vi.waitFor(() => expect(server.sessions.get('s3')?.status).toBe('cancelled'));
    expect((await store.all()).map((song) => song.songId).sort()).toEqual([2, 3]);
  });
});

describe('carrying on', () => {
  it('resumes from the journal after a reload, skipping the parts already sent', async () => {
    const specs = [{ id: 1, text: 'aaaaaa' }, { id: 2, text: 'bbbbbb' }, { id: 3, text: 'cccccc' }];
    const { server } = await setup({ partSize: 2, putDelay: 10 }, specs);
    await startUpload({ songIds: [1, 2, 3] });
    await vi.waitFor(() => expect(server.puts.length).toBeGreaterThanOrEqual(4));
    // the tab goes away part way
    unbind?.();
    unbind = null;
    await endUploadQueue();
    const sent = server.puts.length;
    expect(sent).toBeLessThan(9);
    // the next visit opens the same index and journal from IndexedDB
    store = await MediaStore.open(WS);
    unbind = bindUploadQueue({
      workspaceId: WS, api: server.api, openStore: async () => store, hasUploadConsent: async () => true, fetchImpl: server.fetchImpl,
      hash, retryDelay: () => 0, pacing: NO_DEVICE,
    });
    await finished();
    expect(server.puts).toHaveLength(9);
    expect(new Set(server.puts.map((put) => put.url)).size).toBe(9);
    expect(server.calls.filter((call) => call.path === '/uploads/plan')).toHaveLength(1);
    expect(outcomes()).toEqual({ 1: 'uploaded', 2: 'uploaded', 3: 'uploaded' });
    expect(store.cloudOnlyRecords()).toHaveLength(3);
  });

  it('runs in one tab: another tab follows and takes over when that tab closes', async () => {
    const locks = sharedLocks();
    const specs = [{ id: 1, text: 'aaaa' }, { id: 2, text: 'bbbb' }, { id: 3, text: 'cccc' }];
    const { server } = await setup({ partSize: 2, putDelay: 10 }, specs, { pacing: { locks: () => locks } });
    await startUpload({ songIds: [1, 2, 3] });
    await vi.waitFor(() => expect(server.puts.length).toBeGreaterThan(0));
    // a second tab: its own copy of the module, the same IndexedDB and the same locks
    vi.resetModules();
    const other = await import('./cloudUploadQueue');
    const fromOther: string[] = [];
    const otherFetch = (async (url: RequestInfo | URL, init?: RequestInit) => { fromOther.push(String(url)); return server.fetchImpl(url, init); }) as typeof fetch;
    const stopOther = other.bindUploadQueue({
      workspaceId: WS, api: server.api, openStore: async () => store, hasUploadConsent: async () => true, fetchImpl: otherFetch,
      hash, retryDelay: () => 0, pacing: { ...NO_DEVICE, locks: () => locks },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(other.uploadsRunningHere()).toBe(false);
      expect(fromOther).toEqual([]);
      // the first tab closes part way: the second carries the queue on
      unbind?.();
      unbind = null;
      await endUploadQueue();
      await vi.waitFor(() => expect(other.uploadSnapshot().phase).toBe('finished'), { timeout: 8_000 });
      expect(fromOther.length).toBeGreaterThan(0);
      expect(Object.fromEntries(other.uploadRows().map((row) => [row.songId, row.outcome]))).toEqual({ 1: 'uploaded', 2: 'uploaded', 3: 'uploaded' });
      expect(new Set(server.puts.map((put) => put.url)).size).toBe(server.puts.length);
    } finally {
      stopOther();
      await other.endUploadQueue();
    }
  });
});

/** Web Locks shared by two copies of the module, as two tabs of one browser share them. */
function sharedLocks() {
  const tails = new Map<string, Promise<void>>();
  const holding = new Set<string>();
  return {
    async request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => unknown) {
      if (options.ifAvailable && holding.has(name)) return callback(null);
      const before = tails.get(name) ?? Promise.resolve();
      let release = () => {};
      const mine = new Promise<void>((resolve) => { release = resolve; });
      tails.set(name, before.then(() => mine));
      try {
        await new Promise<void>((resolve, reject) => {
          const stop = () => reject(new DOMException('Stopped.', 'AbortError'));
          if (options.signal?.aborted) { stop(); return; }
          options.signal?.addEventListener('abort', stop);
          void before.then(resolve);
        });
      } catch (error) {
        release();
        throw error;
      }
      holding.add(name);
      try {
        return await callback({ name });
      } finally {
        holding.delete(name);
        release();
      }
    },
    async query() {
      return { held: [...holding].map((name) => ({ name })) };
    },
  };
}
