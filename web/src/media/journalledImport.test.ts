import { afterEach, describe, expect, it, vi } from 'vitest';
import { runImport } from './importer';
import type { ImportEvent, ImportWait, Request, RetryPolicy, TagReader } from './importer';
import { fileKey, ImportJournal } from './importJournal';
import { failureKind, IMPORT_RETRY_NOW, patientRetry } from './journalledImport';
import { MediaStore } from './store';
import { bytesFile, captureRequest, fakeDirectory, fakeHandle } from './testFixtures';
import type { CapturedCall } from './testFixtures';

// The journalled import (cloud.resilient_import): written down before any network call, a
// failed send kept and tried again, never re-reading a file an interrupted run already did, and
// the availability report never failing the import.

const songsPosts = (calls: CapturedCall[]) => calls.filter((call) => call.path === '/api/local-media/songs');

function countingTags() {
  const read: string[] = [];
  const readTags: TagReader = async (file) => { read.push(file.name); return { title: file.name.replace(/\.[^.]+$/, ''), artist: 'A', duration_s: 1 }; };
  return { readTags, read };
}

/** Tries again at once on any failure that is not a refusal, telling `onWait` as the real one does. */
const eagerRetry: RetryPolicy = async (work, { onWait } = {}) => {
  for (let tries = 0; ; tries += 1) {
    try {
      const done = await work();
      if (tries) onWait?.(null);
      return done;
    } catch (error) {
      if (failureKind(error) === 'refused' || failureKind(error) === 'abort' || tries > 5) throw error;
      onWait?.({ why: 'server', retryAt: null });
    }
  }
};

const files = (...names: string[]) => names.map((name, at) => {
  const file = bytesFile(`bytes of ${name}`, name);
  Object.defineProperty(file, 'lastModified', { value: 1_000 + at });
  return file;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('failureKind', () => {
  it('names what a request met without reading its message', () => {
    expect(failureKind(new DOMException('x', 'AbortError'))).toBe('abort');
    expect(failureKind({ status: 401 })).toBe('signin');
    expect(failureKind({ name: 'LoginRequiredError' })).toBe('signin');
    expect(failureKind({ status: 503 })).toBe('server');
    expect(failureKind({ status: 429 })).toBe('server');
    expect(failureKind({ status: 422 })).toBe('refused');
    expect(failureKind(new TypeError('Failed to fetch'))).toBe('server');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(failureKind(new TypeError('Failed to fetch'))).toBe('offline');
  });
});

describe('patientRetry', () => {
  it('waits out a server error and carries on on Try now, saying when it waits and when it is done', async () => {
    const waits: (ImportWait | null)[] = [];
    let calls = 0;
    const running = patientRetry(async () => {
      calls += 1;
      if (calls === 1) throw { status: 503 };
      return 'sent';
    }, { onWait: (wait) => waits.push(wait) });
    await vi.waitFor(() => expect(waits).toHaveLength(1));
    expect(waits[0]).toMatchObject({ why: 'server', retryAt: expect.any(Number) });
    window.dispatchEvent(new Event(IMPORT_RETRY_NOW));
    await expect(running).resolves.toBe('sent');
    expect(waits.at(-1)).toBeNull();
  });

  it('offline: waits with no countdown and carries on when the browser is back online', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const waits: (ImportWait | null)[] = [];
    let calls = 0;
    const running = patientRetry(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return 'sent';
    }, { onWait: (wait) => waits.push(wait) });
    await vi.waitFor(() => expect(waits).toEqual([{ why: 'offline', retryAt: null }]));
    window.dispatchEvent(new Event('online'));
    await expect(running).resolves.toBe('sent');
  });

  it('a refusal that would only repeat is thrown at once; a stop stops the wait', async () => {
    await expect(patientRetry(async () => { throw { status: 422 }; }, {})).rejects.toMatchObject({ status: 422 });
    const controller = new AbortController();
    const running = patientRetry(async () => { throw { status: 503 }; }, { signal: controller.signal });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('runImport with a journal', () => {
  it('writes every file to the journal before any network call', async () => {
    const journal = ImportJournal.inMemory('ws-1');
    const seenAtSend: number[] = [];
    const { request: inner, calls } = captureRequest();
    const request = (async (path: string, init?: RequestInit) => {
      if (path === '/api/local-media/songs') seenAtSend.push(journal.size);
      return inner(path, init);
    }) as Request;
    const store = await MediaStore.open('ws-journal-1');
    const summary = await runImport({ source: files('a.mp3', 'b.mp3'), request, store, journal, readTags: countingTags().readTags, reportDevice: () => 'dev-1' });
    expect(summary).toMatchObject({ imported: 2, failed: 0, cancelled: false });
    expect(seenAtSend[0]).toBeGreaterThanOrEqual(1);
    expect(songsPosts(calls).length).toBeGreaterThan(0);
    expect(journal.unsent()).toEqual([]);
    expect(journal.size).toBe(2);
  });

  it('a failed POST keeps the batch and is tried again; nothing is thrown away', async () => {
    const journal = ImportJournal.inMemory('ws-1');
    let fails = 1;
    const { request: inner, calls } = captureRequest();
    const request = (async (path: string, init?: RequestInit) => {
      if (path === '/api/local-media/songs' && fails > 0) { fails -= 1; throw { status: 503 }; }
      return inner(path, init);
    }) as Request;
    const events: ImportEvent[] = [];
    const store = await MediaStore.open('ws-journal-2');
    const summary = await runImport({
      source: files('a.mp3', 'b.mp3', 'c.mp3'), request, store, journal, retry: eagerRetry,
      readTags: countingTags().readTags, reportDevice: () => 'dev-1', onProgress: (event) => events.push(event),
    });
    expect(summary).toMatchObject({ imported: 3, failed: 0 });
    expect(songsPosts(calls).length).toBeGreaterThan(0);
    expect(events.some((event) => event.kind === 'waiting' && event.wait?.why === 'server')).toBe(true);
    expect(events.some((event) => event.kind === 'waiting' && event.wait === null)).toBe(true);
    expect(journal.unsent()).toEqual([]);
  });

  it('a send that is refused leaves the files fingerprinted; the next run sends them without reading them again', async () => {
    const journal = ImportJournal.inMemory('ws-1');
    const picked = files('a.mp3', 'b.mp3');
    const refusing = (async (path: string) => {
      if (path === '/api/local-media/songs') throw Object.assign(new Error('nope'), { status: 422 });
      return {};
    }) as Request;
    const store = await MediaStore.open('ws-journal-3');
    const first = countingTags();
    await expect(runImport({ source: picked, request: refusing, store, journal, readTags: first.readTags, reportDevice: () => 'dev-1' })).rejects.toMatchObject({ status: 422 });
    expect(first.read.sort()).toEqual(['a.mp3', 'b.mp3']);
    expect(journal.unsent().map((row) => row.state)).toEqual(['fingerprinted', 'fingerprinted']);

    const second = countingTags();
    const { request, calls } = captureRequest();
    const events: ImportEvent[] = [];
    const summary = await runImport({ source: picked, request, store, journal, readTags: second.readTags, reportDevice: () => 'dev-1', onProgress: (event) => events.push(event) });
    expect(summary.imported).toBe(2);
    expect(second.read).toEqual([]);
    expect(events.filter((event) => event.kind === 'checked' && event.resumed)).toHaveLength(2);
    expect((songsPosts(calls)[0].body as { songs: unknown[] }).songs).toHaveLength(2);
  });

  it('a file already saved by an earlier run is skipped by path, size and modified time', async () => {
    const journal = ImportJournal.inMemory('ws-1');
    const store = await MediaStore.open('ws-journal-4');
    const handles = [fakeHandle(files('a.mp3')[0]), fakeHandle(files('b.mp3')[0])];
    const folder = fakeDirectory('Music', [fakeDirectory('Set', handles)]);
    await runImport({ source: folder, request: captureRequest().request, store, journal, readTags: countingTags().readTags, reportDevice: () => 'dev-1' });
    expect(journal.get(fileKey('Set/a.mp3', (await handles[0].getFile()).size, 1_000))).toMatchObject({ state: 'saved' });

    const again = countingTags();
    const { request, calls } = captureRequest();
    const summary = await runImport({ source: folder, request, store, journal, readTags: again.readTags, reportDevice: () => 'dev-1' });
    expect(again.read).toEqual([]);
    expect(songsPosts(calls)).toHaveLength(0);
    expect(summary.imported).toBe(2);

    // the same name with a different size is a different file: it is read
    const changed = bytesFile('a longer set of bytes', 'a.mp3');
    Object.defineProperty(changed, 'lastModified', { value: 1_000 });
    const third = countingTags();
    await runImport({ source: fakeDirectory('Music', [fakeDirectory('Set', [fakeHandle(changed)])]), request: captureRequest().request, store, journal, readTags: third.readTags, reportDevice: () => 'dev-1' });
    expect(third.read).toEqual(['a.mp3']);
  });

  it('the availability report is never fatal, and waits while there is no registered device', async () => {
    const journal = ImportJournal.inMemory('ws-1');
    const { request: inner, calls } = captureRequest();
    const request = (async (path: string, init?: RequestInit) => {
      if (path === '/api/local-media/availability') throw Object.assign(new Error('unknown_device'), { status: 404 });
      return inner(path, init);
    }) as Request;
    const store = await MediaStore.open('ws-journal-5');
    await expect(runImport({ source: files('a.mp3'), request, store, journal, readTags: countingTags().readTags, reportDevice: () => 'dev-1' }))
      .resolves.toMatchObject({ imported: 1, failed: 0 });

    const quiet = captureRequest();
    await runImport({ source: files('b.mp3'), request: quiet.request, store, journal: ImportJournal.inMemory('ws-1'), readTags: countingTags().readTags, reportDevice: () => null });
    expect(quiet.calls.some((call) => call.path === '/api/local-media/availability')).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('a stop (a pause for sign-in) keeps the journal and says cancelled, not failed', async () => {
    const journal = ImportJournal.inMemory('ws-1');
    const controller = new AbortController();
    const request = (async (path: string) => {
      if (path === '/api/local-media/songs') {
        controller.abort('selecta-import-suspended');
        throw { status: 401 };
      }
      return {};
    }) as Request;
    const store = await MediaStore.open('ws-journal-6');
    const summary = await runImport({ source: files('a.mp3', 'b.mp3'), request, store, journal, signal: controller.signal, readTags: countingTags().readTags, reportDevice: () => 'dev-1' });
    expect(summary.cancelled).toBe(true);
    expect(journal.size).toBeGreaterThan(0);
    expect(journal.unsent().every((row) => row.state === 'fingerprinted')).toBe(true);
  });

  it('reading carries on while sending waits offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const journal = ImportJournal.inMemory('ws-1');
    const { request: inner } = captureRequest();
    let online = false;
    const request = (async (path: string, init?: RequestInit) => {
      if (!online) throw new TypeError('Failed to fetch');
      return inner(path, init);
    }) as Request;
    const events: ImportEvent[] = [];
    const store = await MediaStore.open('ws-journal-7');
    const running = runImport({ source: files('a.mp3', 'b.mp3', 'c.mp3'), request, store, journal, batchSize: 1, readTags: countingTags().readTags, reportDevice: () => 'dev-1', onProgress: (event) => events.push(event) });
    await vi.waitFor(() => expect(events.some((event) => event.kind === 'read')).toBe(true));
    expect(events.filter((event) => event.kind === 'checked')).toHaveLength(3);
    expect(journal.size).toBe(3);
    expect(events.some((event) => event.kind === 'waiting' && event.wait?.why === 'offline')).toBe(true);
    online = true;
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    const pump = setInterval(() => window.dispatchEvent(new Event(IMPORT_RETRY_NOW)), 5);
    const summary = await running.finally(() => clearInterval(pump));
    expect(summary.imported).toBe(3);
    expect(journal.unsent()).toEqual([]);
  });
});
