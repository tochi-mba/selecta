import { describe, expect, it } from 'vitest';
import { assertNoPath } from './identity';
import { isAudioName, runImport } from './importer';
import type { ImportEvent, TagReader } from './importer';
import { MediaStore } from './store';
import { bytesFile, captureRequest, fakeDirectory, fakeHandle } from './testFixtures';
import type { CapturedCall } from './testFixtures';

/** Tags straight from the filename stem, with no duration probe, so tests stay instant. */
const tagsFromName: TagReader = async (file) => ({ title: file.name.replace(/\.[^.]+$/, ''), artist: 'Test Artist', duration_s: 1 });

const songsPosts = (calls: CapturedCall[]) => calls.filter((call) => call.path === '/api/local-media/songs');
const availabilityPosts = (calls: CapturedCall[]) => calls.filter((call) => call.path === '/api/local-media/availability');

describe('runImport', () => {
  it('registers in batches, reporting availability for the device after each batch', async () => {
    const { request, calls } = captureRequest();
    const store = await MediaStore.open();
    const files = [bytesFile('one', 'a.mp3'), bytesFile('two', 'b.mp3'), bytesFile('three', 'c.mp3')];
    const summary = await runImport({ source: files, request, store, deviceId: 'dev-1', readTags: tagsFromName, batchSize: 2 });
    expect(summary).toMatchObject({ imported: 3, duplicates: 0, failed: 0, cancelled: false, paused: false });
    const posts = songsPosts(calls);
    expect(posts).toHaveLength(2);
    expect((posts[0].body as { songs: unknown[] }).songs).toHaveLength(2);
    expect((posts[1].body as { songs: unknown[] }).songs).toHaveLength(1);
    const availability = availabilityPosts(calls);
    expect(availability).toHaveLength(2);
    expect(availability[0].body).toMatchObject({ device_id: 'dev-1', present: [1, 2], absent: [] });
    expect(calls.map((call) => call.path)).toEqual([
      '/api/local-media/songs', '/api/local-media/availability',
      '/api/local-media/songs', '/api/local-media/availability',
    ]);
  });

  it('sends no path in any payload, ever', async () => {
    const { request, calls } = captureRequest();
    const store = await MediaStore.open();
    const handles = [fakeHandle(bytesFile('one', 'a.mp3')), fakeHandle(bytesFile('two', 'b.mp3'))];
    await runImport({ source: fakeDirectory('Music', handles), request, store, deviceId: 'dev-1', readTags: tagsFromName });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(() => assertNoPath(call.body)).not.toThrow();
  });

  it('skips files that are not audio, counting them honestly', async () => {
    const { request, calls } = captureRequest();
    const store = await MediaStore.open();
    const summary = await runImport({
      source: [bytesFile('song', 'a.flac'), bytesFile('art', 'cover.jpg'), bytesFile('notes', 'cue.txt')],
      request, store, deviceId: 'dev-1', readTags: tagsFromName,
    });
    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(songsPosts(calls)).toHaveLength(1);
  });

  it('walks a directory tree and stores durable handle references', async () => {
    const { request } = captureRequest();
    const store = await MediaStore.open();
    const inner = fakeDirectory('b-sides', [fakeHandle(bytesFile('two', 'b.mp3'))]);
    const source = fakeDirectory('Music', [fakeHandle(bytesFile('one', 'a.mp3')), inner]);
    const summary = await runImport({ source, request, store, deviceId: 'dev-1', readTags: tagsFromName });
    expect(summary.imported).toBe(2);
    const stored = await store.all();
    expect(stored).toHaveLength(2);
    for (const song of stored) expect(song.ref.kind).toBe('handle');
  });

  it('marks a likely duplicate from the server without silently merging it', async () => {
    const { request } = captureRequest({ duplicates: { b: 1 } });
    const store = await MediaStore.open();
    const events: ImportEvent[] = [];
    const summary = await runImport({
      source: [bytesFile('one', 'a.mp3'), bytesFile('other encoding', 'b.mp3')],
      request, store, deviceId: 'dev-1', readTags: tagsFromName,
      onProgress: (event) => events.push(event),
    });
    expect(summary.imported).toBe(1);
    expect(summary.duplicates).toBe(1);
    const done = events.filter((event) => event.kind === 'file' && event.stage === 'done');
    expect(done).toHaveLength(2);
    expect(done.find((event) => event.kind === 'file' && event.name === 'b.mp3')).toMatchObject({ duplicateOf: 1 });
    // Both entries exist locally: a likely duplicate is a marker, never a merge.
    expect(await store.all()).toHaveLength(2);
  });

  it('cancels between files, keeping what already registered and claiming nothing more', async () => {
    const { request, calls } = captureRequest();
    const store = await MediaStore.open();
    const controller = new AbortController();
    const summary = await runImport({
      source: [bytesFile('one', 'a.mp3'), bytesFile('two', 'b.mp3'), bytesFile('three', 'c.mp3')],
      request, store, deviceId: 'dev-1', readTags: tagsFromName, batchSize: 1, signal: controller.signal,
      onProgress: (event) => {
        if (event.kind === 'file' && event.stage === 'done' && event.name === 'a.mp3') controller.abort();
      },
    });
    expect(summary.cancelled).toBe(true);
    expect(summary.imported).toBe(1);
    expect(songsPosts(calls)).toHaveLength(1);
  });

  it('emits per-file hashing, registering and done stages in order', async () => {
    const { request } = captureRequest();
    const store = await MediaStore.open();
    const events: ImportEvent[] = [];
    await runImport({ source: [bytesFile('one', 'a.mp3')], request, store, deviceId: 'dev-1', readTags: tagsFromName, onProgress: (event) => events.push(event) });
    const stages = events.filter((event) => event.kind === 'file').map((event) => (event as { stage: string }).stage);
    expect(stages).toEqual(['hashing', 'registering', 'done']);
    expect(events.at(-1)).toMatchObject({ kind: 'finished', imported: 1 });
  });

  it('pauses with a typed storage_full event when the local store is out of room', async () => {
    const { request } = captureRequest();
    const store = await MediaStore.open();
    store.put = async () => {
      throw new DOMException('No room.', 'QuotaExceededError');
    };
    const events: ImportEvent[] = [];
    const summary = await runImport({ source: [bytesFile('one', 'a.mp3')], request, store, deviceId: 'dev-1', readTags: tagsFromName, onProgress: (event) => events.push(event) });
    expect(summary.paused).toBe(true);
    expect(events).toContainEqual({ kind: 'paused', paused: 'storage_full' });
  });

  it('reports an unreadable file as failed and carries on with the rest', async () => {
    const { request } = captureRequest();
    const store = await MediaStore.open();
    const broken = fakeHandle(bytesFile('one', 'a.mp3'), { broken: true });
    const events: ImportEvent[] = [];
    const summary = await runImport({ source: [broken, fakeHandle(bytesFile('two', 'b.mp3'))], request, store, deviceId: 'dev-1', readTags: tagsFromName, onProgress: (event) => events.push(event) });
    expect(summary.failed).toBe(1);
    expect(summary.imported).toBe(1);
    expect(events.find((event) => event.kind === 'file' && event.stage === 'failed')).toMatchObject({ name: 'a.mp3' });
  });
});

describe('isAudioName', () => {
  it('accepts the audio family and refuses the rest', () => {
    for (const name of ['a.mp3', 'b.FLAC', 'c.wav', 'd.m4a', 'e.ogg', 'f.opus', 'g.aiff']) expect(isAudioName(name)).toBe(true);
    for (const name of ['cover.jpg', 'cue.txt', 'noext', 'archive.zip']) expect(isAudioName(name)).toBe(false);
  });
});
