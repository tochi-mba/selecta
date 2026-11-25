import { flagOn } from '../flags';
import { hasArt, putArt } from './artStore';
import { artSupported, makeArt, type ArtRequest, type ArtResponse, type MadeArt } from './artWorker';
import { readFilePicture, type FilePicture } from './tags';

// Covers from the person's own files in Cloud (ADR-0478, FL-0478-01, flag `library.art_embedded`).
//
// The import hands each file it has just hashed to `captureArt` and moves on: it never waits for
// a cover and a cover can never fail it. One file at a time, when the page is idle, the picture
// is read from the file's tag region (`readFilePicture`), downscaled in a worker to two sizes with
// a palette hue, and kept on this device (`artStore.ts`). The picture is never uploaded.

export type { ArtSize, MadeArt } from './artWorker';

/** Files waiting for their cover. A File is a pointer to the disk, not its bytes, so a long
 * queue costs little; past this the rest of a very large import simply has no cover yet. */
const MAX_QUEUE = 20_000;
/** How long one picture may take in the worker before it is given up. */
const WORKER_TIMEOUT_MS = 20_000;
/** An idle worker is let go after this, so its memory is freed between imports. */
const WORKER_IDLE_MS = 30_000;

type Job = { file: File; sha: string };
const queue: Job[] = [];
const queued = new Set<string>();
let running = false;

/** Queue a file's own picture to become its cover, keyed by the content hash the import just
 * computed. Returns at once; does nothing while the flag is off or where the browser cannot
 * decode pictures off the page. Never throws. */
export function captureArt(file: File, sha: string): void {
  try {
    if (!flagOn('library.art_embedded') || !artSupported()) return;
    if (queued.has(sha) || queue.length >= MAX_QUEUE) return;
    queued.add(sha);
    queue.push({ file, sha });
    if (!running) void drain();
  } catch {
    // a cover is never worth an import
  }
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const scope = globalThis as { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number };
    if (typeof scope.requestIdleCallback === 'function') scope.requestIdleCallback(() => resolve(), { timeout: 2_000 });
    else setTimeout(resolve, 50);
  });
}

async function drain(): Promise<void> {
  running = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await idle();
      try {
        await captureOne(job);
      } catch {
        // an unreadable picture is no cover, and the next file carries on
      } finally {
        queued.delete(job.sha);
      }
    }
  } finally {
    running = false;
    scheduleWorkerRelease();
  }
}

async function captureOne({ file, sha }: Job): Promise<void> {
  if (!flagOn('library.art_embedded') || (await hasArt(sha))) return;
  const picture = await readFilePicture(file);
  if (!picture) return;
  const art = await makeArtOffPage(picture);
  if (art) await putArt(sha, art);
}

// ---------- the worker ----------

let worker: Worker | null = null;
let workerBroken = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;

function scheduleWorkerRelease(): void {
  if (releaseTimer !== undefined) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = undefined;
    if (running) return;
    worker?.terminate();
    worker = null;
  }, WORKER_IDLE_MS);
}

function spawn(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    if (typeof Worker !== 'function') throw new Error('no workers');
    worker = new Worker(new URL('./artWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function inWorker(target: Worker, picture: FilePicture): Promise<MadeArt | null> {
  const id = nextId;
  nextId += 1;
  // a copy the worker can own outright: the picture's own buffer goes over without a second copy
  const bytes = picture.bytes.byteOffset === 0 && picture.bytes.byteLength === picture.bytes.buffer.byteLength
    ? picture.bytes.buffer as ArrayBuffer
    : picture.bytes.slice().buffer as ArrayBuffer;
  const request: ArtRequest = { id, mime: picture.mime, bytes };
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onError);
    };
    const onMessage = (event: MessageEvent<ArtResponse>) => {
      if (!event.data || event.data.id !== id) return;
      done();
      const art = event.data.art;
      resolve(art && art.small instanceof Blob && art.large instanceof Blob ? art : null);
    };
    const onError = () => {
      done();
      reject(new Error('The cover worker failed.'));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('The cover took too long.'));
    }, WORKER_TIMEOUT_MS);
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onError);
    try {
      target.postMessage(request, [bytes]);
    } catch (error) {
      done();
      reject(error);
    }
  });
}

/** In the worker where there is one; otherwise on the page, at idle, one at a time. */
async function makeArtOffPage(picture: FilePicture): Promise<MadeArt | null> {
  const target = spawn();
  if (target) {
    try {
      return await inWorker(target, picture);
    } catch {
      // a worker that failed or hung is let go, and later pictures are made on the page instead;
      // this one's bytes were handed over, so it simply has no cover until the next import
      target.terminate();
      if (worker === target) worker = null;
      workerBroken = true;
      return null;
    }
  }
  return makeArt(picture.bytes, picture.mime);
}
