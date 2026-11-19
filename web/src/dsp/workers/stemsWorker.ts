/** Module worker running the stem splitter off the page (ADR-0459 Tier 3).
 *
 * Spawned by `stemsSpawn.ts`. A stereo 44.1 kHz window arrives transferred; the worker loads the
 * verified model (once per hash), runs chunked inference with overlap-add, and transfers the
 * eight stem channels back. Progress is reported per segment, and a `cancel` message stops the
 * job at the next segment boundary. Nothing here touches the audio callback.
 *
 * `handleStemRequest` is exported with injectable dependencies so tests run the exact code the
 * worker runs without a Worker, onnxruntime-web or OPFS.
 */

import { bytesSha256 } from '../../media/identity';
import { separateChunked } from '../stems/chunked';
import { readStemModelBytes, STEM_MODEL, STEM_SEGMENT_SAMPLES } from '../stems/model';
import { loadStemRuntime, type StemBackend, type StemRuntime } from '../stems/runtime';

export interface StemModelRef {
  sha256: string;
  /** Model bytes handed over by the page; when absent the worker reads OPFS itself. */
  bytes?: ArrayBuffer;
}

export interface StemSeparateRequest {
  type: 'separate';
  id: number;
  sampleRate: number;
  /** Exactly two channels of equal length, transferred. */
  channels: Float32Array[];
  model: StemModelRef;
}

export interface StemCancelRequest {
  type: 'cancel';
  id: number;
}

export type StemWorkerRequest = StemSeparateRequest | StemCancelRequest;

export type StemWorkerResponse =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; backend: StemBackend; implementation: string; stems: Float32Array[] }
  | { type: 'error'; id: number; error: string; cancelled: boolean };

export interface StemWorkerDeps {
  readModel: (sha256: string) => Promise<ArrayBuffer | null>;
  hash: (bytes: ArrayBuffer) => Promise<string>;
  loadRuntime: (model: Uint8Array) => Promise<StemRuntime>;
  post: (message: StemWorkerResponse, transfer?: Transferable[]) => void;
}

const cancelled = new Set<number>();
let loaded: { sha256: string; runtime: Promise<StemRuntime> } | null = null;

export function resetStemWorkerForTests(): void {
  cancelled.clear();
  loaded = null;
}

async function runtimeFor(model: StemModelRef, deps: StemWorkerDeps): Promise<StemRuntime> {
  if (loaded?.sha256 === model.sha256) return loaded.runtime;
  const previous = loaded;
  const runtime = (async () => {
    if (previous) await (await previous.runtime.catch(() => null))?.release();
    const bytes = model.bytes ?? await deps.readModel(model.sha256);
    if (!bytes) throw new Error('the stem splitter is not downloaded on this device');
    if (await deps.hash(bytes) !== model.sha256) throw new Error('the stem splitter on this device does not match its fingerprint');
    return deps.loadRuntime(new Uint8Array(bytes));
  })();
  loaded = { sha256: model.sha256, runtime };
  runtime.catch(() => {
    if (loaded?.runtime === runtime) loaded = null;
  });
  return runtime;
}

export async function handleStemRequest(request: StemWorkerRequest, deps: StemWorkerDeps): Promise<void> {
  if (request.type === 'cancel') {
    cancelled.add(request.id);
    return;
  }
  const { id } = request;
  try {
    if (request.sampleRate !== STEM_MODEL.sampleRate) throw new Error(`stems need ${STEM_MODEL.sampleRate} Hz audio, got ${request.sampleRate}`);
    const [left, right] = request.channels;
    const runtime = await runtimeFor(request.model, deps);
    const stems = await separateChunked(left, right, runtime.runSegment, {
      segmentSamples: STEM_SEGMENT_SAMPLES,
      overlap: STEM_MODEL.overlap,
      planes: STEM_MODEL.stems.length * 2,
      isCancelled: () => cancelled.has(id),
      onProgress: (done, total) => deps.post({ type: 'progress', id, done, total }),
    });
    deps.post(
      { type: 'result', id, backend: runtime.backend, implementation: runtime.implementation, stems },
      stems.map((plane) => plane.buffer as ArrayBuffer),
    );
  } catch (problem) {
    const wasCancelled = cancelled.has(id) || (problem instanceof Error && problem.name === 'AbortError');
    deps.post({ type: 'error', id, error: problem instanceof Error ? problem.message : String(problem), cancelled: wasCancelled });
  } finally {
    cancelled.delete(id);
  }
}

/** The message body as a well-formed request, or null. */
export function trustedStemRequest(event: MessageEvent<unknown>): StemWorkerRequest | null {
  const request: unknown = event.data;
  if (typeof request !== 'object' || request === null) return null;
  const candidate = request as { [key: string]: unknown; id?: unknown; type?: unknown; sampleRate?: unknown; channels?: unknown; model?: unknown };
  if (typeof candidate.id !== 'number') return null;
  if (candidate.type === 'cancel') return { type: 'cancel', id: candidate.id };
  if (candidate.type !== 'separate' || typeof candidate.sampleRate !== 'number') return null;
  const channels = candidate.channels;
  if (!Array.isArray(channels) || channels.length !== 2 ||
      !channels.every((channel) => channel instanceof Float32Array) || channels[0].length !== channels[1].length) {
    return null;
  }
  const model = candidate.model as Partial<StemModelRef> | null | undefined;
  if (typeof model !== 'object' || model === null || typeof model.sha256 !== 'string' ||
      (model.bytes !== undefined && !(model.bytes instanceof ArrayBuffer))) {
    return null;
  }
  return candidate as unknown as StemSeparateRequest;
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: StemWorkerResponse, transfer?: Transferable[]) => void;
};

const scope = globalThis as unknown as Partial<WorkerScope> & { window?: unknown };

// Only wire the message loop when actually running as a worker; importing this module from the
// page (or from tests) must stay side-effect free.
if (typeof scope.postMessage === 'function' && scope.window === undefined) {
  const deps: StemWorkerDeps = {
    readModel: (sha256) => readStemModelBytes(sha256),
    hash: bytesSha256,
    loadRuntime: (model) => loadStemRuntime(model),
    post: (message, transfer) => (scope as WorkerScope).postMessage(message, transfer ?? []),
  };
  (scope as WorkerScope).onmessage = (event) => {
    // A dedicated worker only hears the page that spawned it, and those messages carry an
    // empty origin; anything bearing an origin did not come from that page.
    if (event.origin !== '') return;
    const request = trustedStemRequest(event);
    if (request) void handleStemRequest(request, deps);
  };
}
