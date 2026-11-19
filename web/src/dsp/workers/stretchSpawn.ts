/** Spawn helper for the stretch worker (ADR-0459, BF-0459-05).
 *
 * Same convention and transfer rules as spawn.ts: a channel the caller owns outright is moved,
 * anything else (a view, a SharedArrayBuffer, an AudioBuffer's own channel) is copied once. A
 * request settles on its own id only, and a deadline turns a stuck worker into an error the
 * seam provider can fall back from.
 */

import type { StretchRamp } from '../stretchLimits';
import { transferable } from './spawn';
import type { StretchRequest, StretchResponse } from './stretchWorker';

/** How long one stretch may take before the seam falls back to an unstretched one. */
export const STRETCH_TIMEOUT_MS = 15_000;

export function spawnStretchWorker(): Worker {
  return new Worker(new URL('./stretchWorker.ts', import.meta.url), { type: 'module' });
}

let nextRequestId = 1;

/** Stretch `channels` along `ramp` on an already spawned worker; the stretched channels. */
export function stretchInWorker(
  worker: Worker,
  channels: Float32Array[],
  sampleRate: number,
  ramp: StretchRamp,
  options: { owned?: boolean; timeoutMs?: number } = {},
): Promise<Float32Array[]> {
  const id = nextRequestId;
  nextRequestId += 1;
  const sending = channels.map((channel) => transferable(channel, options.owned === true));
  const request: StretchRequest = { id, sampleRate, channels: sending.map((sent) => sent.pcm), ramp };
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
    };
    const onMessage = (event: MessageEvent<StretchResponse>) => {
      if (!event.data || event.data.id !== id) return; // another caller's result on a shared worker
      done();
      const { channels: out, error } = event.data;
      if (error) reject(new Error(error));
      else if (!Array.isArray(out) || out.length !== channels.length || !out.every((channel) => channel instanceof Float32Array)) {
        reject(new Error('The stretch worker answered without the stretched audio.'));
      } else resolve(out);
    };
    const onError = (event: ErrorEvent) => {
      done();
      reject(new Error(event.message || 'The stretch worker failed.'));
    };
    const onMessageError = () => {
      done();
      reject(new Error('The stretched audio could not be read.'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    const timeoutMs = options.timeoutMs ?? STRETCH_TIMEOUT_MS;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(() => {
        done();
        reject(new Error(`the stretch took longer than ${Math.round(timeoutMs / 1000)} seconds`));
      }, timeoutMs);
    }
    try {
      worker.postMessage(request, sending.flatMap((sent) => sent.transfer));
    } catch (error) {
      done();
      reject(error instanceof Error ? error : new Error('The stretch request could not be sent.'));
    }
  });
}
