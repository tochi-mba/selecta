/** Spawn helper for the analysis worker (ADR-0459, BF-0459-06).
 *
 * Uses the Vite module-worker convention, so the bundler finds and splits the worker file:
 * `new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' })`.
 *
 * PCM crosses as a transferable, so the audio data is moved, never copied, and the caller's
 * array is detached afterwards: analysis never holds two copies of a song in memory.
 *
 * Transfer safety: only a buffer the caller owns outright may be moved. A view into a larger
 * buffer (a subarray) would detach its neighbours too, a SharedArrayBuffer cannot be
 * transferred at all, and an AudioBuffer's getChannelData() array belongs to the playing
 * AudioBuffer (moving it would silence the song mid-play). Those are copied once instead; pass
 * `owned: true` only for an array made solely for this call.
 */

import type { AnalysisRequest, AnalysisResponse, AnalysisTask } from './analysisWorker';

export function spawnAnalysisWorker(): Worker {
  return new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' });
}

let nextRequestId = 1;

/** Run one analysis request on an already spawned worker. The pcm buffer is transferred. */
/** The array to send and whether its buffer may be transferred. */
export function transferable(pcm: Float32Array, owned: boolean): { pcm: Float32Array; transfer: ArrayBuffer[] } {
  const whole = pcm.byteOffset === 0 && pcm.byteLength === pcm.buffer.byteLength;
  const plain = typeof SharedArrayBuffer === 'undefined' || !(pcm.buffer instanceof SharedArrayBuffer);
  if (owned && whole && plain) return { pcm, transfer: [pcm.buffer as ArrayBuffer] };
  const copy = pcm.slice();
  return { pcm: copy, transfer: [copy.buffer] };
}

export function analyseInWorker(
  worker: Worker,
  pcm: Float32Array,
  sampleRate: number,
  tasks?: AnalysisTask[],
  options: { owned?: boolean; timeoutMs?: number; channels?: Float32Array[] } = {},
): Promise<AnalysisResponse> {
  const id = nextRequestId;
  nextRequestId += 1;
  const sending = transferable(pcm, options.owned === true);
  // `channels` are always copies made for this call (levelOf), so they are moved too
  const channels = options.channels;
  const request: AnalysisRequest = { id, sampleRate, pcm: sending.pcm, tasks, ...(channels ? { channels } : {}) };
  const moved = [...sending.transfer, ...(channels ?? []).map((channel) => channel.buffer as ArrayBuffer)];
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
    };
    const onMessage = (event: MessageEvent<AnalysisResponse>) => {
      if (!event.data || event.data.id !== id) {
        return; // another caller's result on a shared worker
      }
      done();
      resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      done();
      reject(new Error(event.message || 'The analysis worker failed.'));
    };
    const onMessageError = () => {
      done();
      reject(new Error('The analysis result could not be read.'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(() => {
        done();
        reject(new Error(`The analysis worker exceeded its ${timeoutMs} ms deadline.`));
      }, timeoutMs);
    }
    try {
      worker.postMessage(request, moved);
    } catch (error) {
      done();
      reject(error instanceof Error ? error : new Error('The analysis request could not be sent.'));
    }
  });
}
