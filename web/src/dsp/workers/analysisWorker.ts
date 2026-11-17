/** Module worker running the lightweight analysis off-thread (ADR-0459, BF-0459-06).
 *
 * Spawned by `spawn.ts` with the Vite module-worker convention. PCM arrives as a transferred
 * Float32Array (zero copy), the onset/tempo/key estimates run here, and a small result goes
 * back. Nothing in this file ever touches the audio callback: the engine's worklet never
 * waits on a worker.
 *
 * `analyse` is exported as a pure function so tests exercise the exact code the worker runs
 * without needing a Worker runtime.
 */

import { detectOnsets } from '../analysis/onsets';
import { estimateKey, type KeyEstimate } from '../analysis/key';
import { estimateTempo, type TempoEstimate } from '../analysis/tempo';

export type AnalysisTask = 'onsets' | 'tempo' | 'key';

export interface AnalysisRequest {
  id: number;
  sampleRate: number;
  /** Mono PCM; the buffer is transferred, not copied. */
  pcm: Float32Array;
  /** Which estimates to run; all three when omitted. */
  tasks?: AnalysisTask[];
}

export interface AnalysisResponse {
  id: number;
  tempo?: TempoEstimate;
  key?: KeyEstimate;
  onsetTimes?: number[];
  error?: string;
}

/** Run the requested estimates. Pure; deterministic for a given request. */
export function analyse(request: AnalysisRequest): AnalysisResponse {
  const tasks = new Set<AnalysisTask>(request.tasks ?? ['onsets', 'tempo', 'key']);
  const response: AnalysisResponse = { id: request.id };
  try {
    if (tasks.has('onsets') || tasks.has('tempo')) {
      const onsets = detectOnsets(request.pcm, request.sampleRate);
      if (tasks.has('onsets')) {
        response.onsetTimes = onsets.onsetTimes;
      }
      if (tasks.has('tempo')) {
        response.tempo = estimateTempo(onsets);
      }
    }
    if (tasks.has('key')) {
      response.key = estimateKey(request.pcm, request.sampleRate);
    }
  } catch (problem) {
    response.error = problem instanceof Error ? problem.message : String(problem);
  }
  return response;
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage: (message: AnalysisResponse) => void;
};

const scope = globalThis as unknown as Partial<WorkerScope> & { window?: unknown };

/** The message body as an AnalysisRequest, or null when it is not a well-formed one. */
export function trustedRequest(event: MessageEvent<AnalysisRequest>): AnalysisRequest | null {
  const request: unknown = event.data;
  if (typeof request !== 'object' || request === null) return null;
  const { id, sampleRate, pcm } = request as Partial<AnalysisRequest>;
  if (typeof id !== 'number' || typeof sampleRate !== 'number' || !(pcm instanceof Float32Array)) {
    return null;
  }
  return request as AnalysisRequest;
}

// Only wire the message loop when actually running as a worker; importing this module from
// the page (or from tests) must stay side-effect free.
if (typeof scope.postMessage === 'function' && scope.window === undefined) {
  (scope as WorkerScope).onmessage = (event) => {
    // A dedicated worker only hears the page that spawned it, and those messages carry an
    // empty origin; anything bearing an origin did not come from that page.
    if (event.origin !== '') return;
    const request = trustedRequest(event);
    if (request) (scope as WorkerScope).postMessage(analyse(request));
  };
}
