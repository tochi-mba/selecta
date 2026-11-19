/** Spawn helper and page-side client for the stem worker (ADR-0459 Tier 3).
 *
 * Follows `spawn.ts`: Vite module-worker convention, PCM moved as transferables (copied once
 * unless the caller owns the arrays outright), answers matched by request id.
 */

import { transferable } from './spawn';
import type { StemBackend } from '../stems/runtime';
import type { StemModelRef, StemSeparateRequest, StemWorkerResponse } from './stemsWorker';

export function spawnStemsWorker(): Worker {
  return new Worker(new URL('./stemsWorker.ts', import.meta.url), { type: 'module' });
}

export interface SeparationResult {
  backend: StemBackend;
  implementation: string;
  /** Stem-major planar channels: [drums L, drums R, bass L, bass R, other L, other R, vocals L, vocals R]. */
  stems: Float32Array[];
}

export interface SeparateOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  /** True only when the arrays were made for this call, so they may be moved. */
  owned?: boolean;
  timeoutMs?: number;
}

/** A function the prefetcher calls to split one stereo 44.1 kHz window. */
export type StemSeparator = (channels: [Float32Array, Float32Array], options?: SeparateOptions) => Promise<SeparationResult>;

let nextRequestId = 1;

export function abortError(message = 'The stem separation was cancelled.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function separateInWorker(
  worker: Worker,
  channels: [Float32Array, Float32Array],
  model: StemModelRef,
  options: SeparateOptions = {},
): Promise<SeparationResult> {
  const id = nextRequestId;
  nextRequestId += 1;
  if (options.signal?.aborted) return Promise.reject(abortError());
  const left = transferable(channels[0], options.owned === true);
  const right = transferable(channels[1], options.owned === true);
  const request: StemSeparateRequest = { type: 'separate', id, sampleRate: 44100, channels: [left.pcm, right.pcm], model };
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onMessage = (event: MessageEvent<StemWorkerResponse>) => {
      const data = event.data;
      if (!data || data.id !== id) return;
      if (data.type === 'progress') {
        options.onProgress?.(data.total > 0 ? data.done / data.total : 0);
        return;
      }
      done();
      if (data.type === 'result') resolve({ backend: data.backend, implementation: data.implementation, stems: data.stems });
      else reject(data.cancelled ? abortError() : new Error(data.error));
    };
    const onError = (event: ErrorEvent) => {
      done();
      reject(new Error(event.message || 'The stem worker failed.'));
    };
    const onMessageError = () => {
      done();
      reject(new Error('The stems could not be read.'));
    };
    const onAbort = () => {
      try {
        worker.postMessage({ type: 'cancel', id });
      } catch {
        // The worker is gone; nothing to cancel.
      }
      done();
      reject(abortError());
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    options.signal?.addEventListener('abort', onAbort);
    const timeoutMs = options.timeoutMs ?? 10 * 60_000;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(() => {
        try {
          worker.postMessage({ type: 'cancel', id });
        } catch {
          // already gone
        }
        done();
        reject(new Error(`The stem worker exceeded its ${timeoutMs} ms deadline.`));
      }, timeoutMs);
    }
    try {
      const transfer = [...left.transfer, ...right.transfer];
      worker.postMessage(request, transfer);
    } catch (error) {
      done();
      reject(error instanceof Error ? error : new Error('The stem request could not be sent.'));
    }
  });
}

/** Bind a worker and model into the separator the prefetcher and benchmark use. */
export function workerSeparator(worker: Worker, model: StemModelRef): StemSeparator {
  return (channels, options) => separateInWorker(worker, channels, model, options);
}
