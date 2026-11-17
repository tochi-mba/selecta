/** Spawn helper for the analysis worker (ADR-0459, BF-0459-06).
 *
 * Uses the Vite module-worker convention, so the bundler finds and splits the worker file:
 * `new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' })`.
 *
 * PCM crosses as a transferable, so the audio data is moved, never copied, and the caller's
 * array is detached afterwards: analysis never holds two copies of a song in memory.
 */

import type { AnalysisRequest, AnalysisResponse, AnalysisTask } from './analysisWorker';

export function spawnAnalysisWorker(): Worker {
  return new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' });
}

let nextRequestId = 1;

/** Run one analysis request on an already spawned worker. The pcm buffer is transferred. */
export function analyseInWorker(
  worker: Worker,
  pcm: Float32Array,
  sampleRate: number,
  tasks?: AnalysisTask[]
): Promise<AnalysisResponse> {
  const id = nextRequestId;
  nextRequestId += 1;
  const request: AnalysisRequest = { id, sampleRate, pcm, tasks };
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<AnalysisResponse>) => {
      if (event.data.id !== id) {
        return; // another caller's result on a shared worker
      }
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(new Error(event.message || 'The analysis worker failed.'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(request, [pcm.buffer]);
  });
}
