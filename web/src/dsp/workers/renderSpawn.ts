/** The page's side of the render worker (renderWorker.ts): one worker, one render at a time, and
 * a way to walk away from a render that is no longer wanted.
 *
 * Nothing renders unless `cloud.device_render` is named on (flags.ts `flagListed`): with it off
 * no worker is started and the answer says so. Source windows are moved to the worker, not
 * copied (see `transferable` in spawn.ts for when a copy is made instead), and the clip is moved
 * back. Abandoning a render (an AbortSignal, a deadline) ends that worker outright, so its
 * memory goes with it; the next render starts a fresh one.
 */

import { flagListed } from '../../flags';
import type { VocalSpans } from '../render/audit';
import { RENDER_IMPLEMENTATION } from '../render/ids';
import type { RenderSeamRequest, RenderSeamResponse, RenderSeamSource } from './renderWorker';
import { transferable } from './spawn';

export function spawnRenderWorker(): Worker {
  return new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
}

export interface RenderOptions {
  vocalSpans?: VocalSpans;
  signal?: AbortSignal;
  /** Ends the render after this long; 60 s by default. */
  timeoutMs?: number;
  /** True when every source window was made for this call and may be moved. */
  owned?: boolean;
}

export class SeamRenderer {
  private worker: Worker | null = null;
  private nextId = 1;
  /** Renders sent to the current worker and not yet answered; ending the worker ends them all. */
  private readonly pending = new Set<(reason: Error) => void>();

  constructor(private readonly spawn: () => Worker = spawnRenderWorker) {}

  render(script: string, sources: RenderSeamSource[], options: RenderOptions = {}): Promise<RenderSeamResponse> {
    const id = this.nextId;
    this.nextId += 1;
    if (!flagListed('cloud.device_render')) {
      return Promise.resolve({ id, status: 'off', implementation: RENDER_IMPLEMENTATION, reason: 'rendering transitions on this device is switched off' });
    }
    if (options.signal?.aborted) return Promise.reject(new DOMException('The render was abandoned.', 'AbortError'));
    const moved: ArrayBuffer[] = [];
    const sent = sources.map((source) => ({
      ...source,
      channels: source.channels.map((channel) => {
        const sending = transferable(channel, options.owned === true);
        moved.push(...sending.transfer);
        return sending.pcm;
      }),
    }));
    const request: RenderSeamRequest = { id, task: 'renderSeam', script, sources: sent, vocalSpans: options.vocalSpans, enabled: true };
    const worker = (this.worker ??= this.spawn());
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        this.pending.delete(abandonQuietly);
        if (timer !== undefined) clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const abandon = (reason: Error) => {
        done();
        this.end();
        reject(reason);
      };
      const abandonQuietly = (reason: Error) => {
        done();
        reject(reason);
      };
      this.pending.add(abandonQuietly);
      const onMessage = (event: MessageEvent<RenderSeamResponse>) => {
        if (!event.data || event.data.id !== id) return;
        done();
        resolve(event.data);
      };
      const onError = (event: ErrorEvent) => abandon(new Error(event.message || 'The render worker failed.'));
      const onAbort = () => abandon(new DOMException('The render was abandoned.', 'AbortError'));
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      options.signal?.addEventListener('abort', onAbort);
      const timeoutMs = options.timeoutMs ?? 60_000;
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => abandon(new Error(`The render exceeded its ${timeoutMs} ms deadline.`)), timeoutMs);
      }
      try {
        worker.postMessage(request, moved);
      } catch (problem) {
        abandon(problem instanceof Error ? problem : new Error('The render request could not be sent.'));
      }
    });
  }

  /** End the worker, and any render it is doing. */
  end(): void {
    this.worker?.terminate();
    this.worker = null;
    const waiting = [...this.pending];
    this.pending.clear();
    for (const stop of waiting) stop(new DOMException('The render worker was ended.', 'AbortError'));
  }
}
