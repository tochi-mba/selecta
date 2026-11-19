/** Module worker running the pitch-preserving time-stretch off-thread (ADR-0459, BF-0459-05).
 *
 * Spawned by `stretchSpawn.ts` with the Vite module-worker convention. B's entry window arrives
 * as transferred Float32Arrays (one per channel), the WSOLA stretch of stretch.ts runs here
 * along the requested ramp, and the stretched channels go back transferred too. The page never
 * runs the stretch on its own thread, and the audio callback never waits on this worker.
 *
 * `stretchRequest` is exported as a pure function so tests exercise the exact code the worker
 * runs without needing a Worker runtime.
 */

import { rampCurve, timeStretch } from '../stretch';
import type { StretchRamp } from '../stretchLimits';

export interface StretchRequest {
  id: number;
  sampleRate: number;
  /** One array per channel, all the same length; the buffers are transferred, not copied. */
  channels: Float32Array[];
  ramp: StretchRamp;
}

export interface StretchResponse {
  id: number;
  /** The stretched channels, when the stretch ran. */
  channels?: Float32Array[];
  error?: string;
}

/** Run one stretch. Pure; deterministic for a given request. */
export function stretchRequest(request: StretchRequest): StretchResponse {
  try {
    const result = timeStretch(request.channels, request.sampleRate, rampCurve(request.ramp));
    if (result.status !== 'ready') return { id: request.id, error: result.reason };
    return { id: request.id, channels: result.channels };
  } catch (problem) {
    return { id: request.id, error: problem instanceof Error ? problem.message : String(problem) };
  }
}

/** The message body as a StretchRequest, or null when it is not a well-formed one. */
export function trustedStretchRequest(event: MessageEvent<StretchRequest>): StretchRequest | null {
  const request: unknown = event.data;
  if (typeof request !== 'object' || request === null) return null;
  const { id, sampleRate, channels, ramp } = request as Partial<StretchRequest>;
  if (typeof id !== 'number' || typeof sampleRate !== 'number') return null;
  if (!Array.isArray(channels) || channels.length === 0 || !channels.every((channel) => channel instanceof Float32Array)) return null;
  if (typeof ramp !== 'object' || ramp === null) return null;
  if (![ramp.ratio, ramp.holdSeconds, ramp.rampSeconds].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  return request as StretchRequest;
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<StretchRequest>) => void) | null;
  postMessage: (message: StretchResponse, transfer?: Transferable[]) => void;
};

const scope = globalThis as unknown as Partial<WorkerScope> & { window?: unknown };

// Only wire the message loop when actually running as a worker; importing this module from
// the page (or from tests) must stay side-effect free.
if (typeof scope.postMessage === 'function' && scope.window === undefined) {
  (scope as WorkerScope).onmessage = (event) => {
    // A dedicated worker only hears the page that spawned it, and those messages carry an
    // empty origin; anything bearing an origin did not come from that page.
    if (event.origin !== '') return;
    const request = trustedStretchRequest(event);
    if (!request) return;
    const response = stretchRequest(request);
    (scope as WorkerScope).postMessage(response, (response.channels ?? []).map((channel) => channel.buffer as ArrayBuffer));
  };
}
