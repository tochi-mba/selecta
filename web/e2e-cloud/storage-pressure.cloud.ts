import { expect, Page, test } from '@playwright/test';
import { build } from 'vite';

// BF-0458-06 (ADR-0458): the local media cache under storage pressure, in a real browser.
//
// The shipped web/src/media/store.ts and importer.ts are bundled (e2e-cloud/mediaPressureEntry.ts)
// and loaded into a page on the e2e server's origin, so they run against the browser's own
// IndexedDB and OPFS, not fakes. Pressure is simulated where the browser reports it: a
// transaction that aborts with QuotaExceededError (a full disk is reported at commit), an OPFS
// write that throws it, IndexedDB refusing to open (private mode, blocked storage), and an OPFS
// entry the browser evicted. Each must degrade to a re-import or a recompute, with the member
// told, never an error and never a claim that something was saved when it wasn't.

let bundle = '';

test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: new URL('./mediaPressureEntry.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), formats: ['iife'], name: 'SelectaMedia' },
    },
  });
  const outputs = (Array.isArray(built) ? built : [built]) as { output: { code?: string }[] }[];
  bundle = outputs[0].output.map((chunk) => chunk.code ?? '').join('\n');
  expect(bundle).toContain('QuotaExceededError');
});

/** A blank page on the server's origin (so the app itself never loads, and storage belongs to
 * that origin) with the media runtime on `window.SelectaMedia` and a fresh IndexedDB. */
async function mediaPage(page: Page) {
  await page.route('**/e2e/storage-pressure', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>media</title>' }));
  await page.goto('/e2e/storage-pressure');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(async () => {
    await new Promise<void>((done) => {
      const gone = indexedDB.deleteDatabase('selecta-media');
      gone.onsuccess = gone.onerror = gone.onblocked = () => done();
    });
  });
}

test('a full IndexedDB pauses the import, tells the member, claims nothing, and a re-import finishes', async ({ page }) => {
  await mediaPage(page);
  const result = await page.evaluate(async () => {
    type Media = typeof import('./mediaPressureEntry');
    const media = (window as unknown as { SelectaMedia: Media }).SelectaMedia;
    // The disk is full: every write's transaction aborts with QuotaExceededError at commit.
    const scope = window as unknown as { full: boolean };
    scope.full = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function patched(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args);
      if (scope.full) {
        const transaction = this.transaction;
        Object.defineProperty(transaction, 'error', { get: () => new DOMException('The disk is full.', 'QuotaExceededError') });
        transaction.abort();
      }
      return request;
    };
    let nextId = 1;
    const ids = new Map<string, number>();
    const request = (async (path: string, init?: RequestInit) => {
      if (path === '/api/local-media/songs') {
        const { songs } = JSON.parse(String(init?.body)) as { songs: { content_sha256: string }[] };
        return { songs: songs.map((song) => {
          if (!ids.has(song.content_sha256)) ids.set(song.content_sha256, nextId++);
          return { song_id: ids.get(song.content_sha256), content_sha256: song.content_sha256 };
        }) };
      }
      return {};
    }) as Parameters<Media['runImport']>[0]['request'];
    const files = ['a.mp3', 'b.flac', 'c.wav'].map((name, at) => new File([`song ${at}`], name, { type: 'audio/mpeg' }));
    const readTags = async (file: File) => ({ title: file.name, artist: 'Artist', duration_s: 1 });
    const store = await media.MediaStore.open();
    const events: string[] = [];
    const full = await media.runImport({ source: files, request, store, deviceId: 'dev', readTags, onProgress: (event) => {
      if (event.kind === 'paused') events.push(`paused:${event.paused}`);
    } });
    const heldWhileFull = (await store.all()).length;
    const told = new media.StorageFullError().message;
    scope.full = false;
    const again = await media.runImport({ source: files, request, store, deviceId: 'dev', readTags });
    const reopened = await media.MediaStore.open();
    const texts = await Promise.all(files.map((file) => file.text()));
    return { full, events, heldWhileFull, told, degraded: store.degraded, again, kept: (await reopened.all()).length, texts };
  });
  expect(result.full).toMatchObject({ paused: true, imported: 0, cancelled: false });
  expect(result.events).toEqual(['paused:storage_full']);
  expect(result.heldWhileFull, 'nothing is claimed that was not stored').toBe(0);
  expect(result.told).toContain('run out of browser storage');
  expect(result.degraded, 'a full disk is not private mode').toBe(false);
  expect(result.again).toMatchObject({ paused: false, imported: 3, failed: 0 });
  expect(result.kept, 'the re-import is really stored').toBe(3);
  expect(result.texts, 'the member\'s files are untouched').toEqual(['song 0', 'song 1', 'song 2']);
});

test('with IndexedDB refused (private mode), the index lives in memory and says a re-import will be needed', async ({ page }) => {
  await mediaPage(page);
  const result = await page.evaluate(async () => {
    type Media = typeof import('./mediaPressureEntry');
    const media = (window as unknown as { SelectaMedia: Media }).SelectaMedia;
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function refused() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const store = await media.MediaStore.open();
    await store.put({ songId: 7, identity: { content_sha256: 'a'.repeat(64), title: 'Seven', artist: 'Artist' }, ref: { kind: 'repick', name: 'seven.mp3', size: 5 }, importedAt: 1 });
    const now = (await store.all()).map((song) => song.songId);
    const next = await media.MediaStore.open();
    IDBFactory.prototype.open = open;
    return { degraded: store.degraded, now, nextDegraded: next.degraded, nextVisit: (await next.all()).length };
  });
  expect(result).toEqual({ degraded: true, now: [7], nextDegraded: true, nextVisit: 0 });
});

test('the OPFS cache reports a full disk, and an evicted entry is a miss to recompute, never an error', async ({ page }) => {
  await mediaPage(page);
  const result = await page.evaluate(async () => {
    type Media = typeof import('./mediaPressureEntry');
    const media = (window as unknown as { SelectaMedia: Media }).SelectaMedia;
    const estimate = await navigator.storage.estimate();
    const stored = await media.cacheWrite('bytes-1', new Uint8Array([1, 2, 3, 4]));
    const read = await media.cacheRead('bytes-1');
    // The browser evicts the cache under pressure: the entry is simply gone.
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(`cache-${encodeURIComponent('bytes-1')}`);
    const afterEviction = await media.cacheRead('bytes-1');
    // A full disk while writing derived data.
    const write = FileSystemWritableFileStream.prototype.write;
    FileSystemWritableFileStream.prototype.write = async function full() {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    };
    const full = await media.cacheWrite('bytes-2', new Uint8Array([5, 6]));
    FileSystemWritableFileStream.prototype.write = write;
    await media.cacheEvict('bytes-2');
    await media.cacheEvict('never-written');
    const gone = await media.cacheRead('bytes-2');
    const bytes = (buffer: ArrayBuffer | null) => (buffer ? [...new Uint8Array(buffer)] : null);
    return { quota: typeof estimate.quota, stored, read: bytes(read), afterEviction: bytes(afterEviction), full, gone: bytes(gone) };
  });
  expect(result.quota).toBe('number');
  expect(result.stored).toEqual({ ok: true });
  expect(result.read).toEqual([1, 2, 3, 4]);
  expect(result.afterEviction).toBeNull();
  expect(result.full).toEqual({ ok: false, why: 'storage_full' });
  expect(result.gone).toBeNull();
});
