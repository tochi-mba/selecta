/** Module worker that renders and audits one transition script offline (device studio,
 * ADR-0479; docs/engineering/device-render.md).
 *
 * A sibling of the analysis worker rather than a task inside it: a render is abandoned by ending
 * its worker (a song skipped mid-render), which must not take a long whole-song measurement down
 * with it, and the two never hold each other's audio. The request carries only the windows of
 * source audio the script reads (`engine.neededWindows`), transferred, not copied; the clip comes
 * back transferred. While it works the worker holds those windows, the clip and the render's
 * working signals, and lets go of all of them when it answers.
 *
 * `renderSeam` is a pure function so tests run the exact code the worker runs.
 */

import { audit, auditFacts, type AuditReport, type VocalSpans } from '../render/audit';
import { renderScript, type SourceAudio, type SourceProvider } from '../render/engine';
import { RENDER_IMPLEMENTATION } from '../render/ids';
import type { AuditFacts } from '../render/repair';
import { SAMPLE_RATE, type SourceRef } from '../render/script';
import { readSourceRef, scriptFromJson } from '../render/scriptJson';
import { type Stretcher, wsolaStretcher } from '../render/warpStretch';

export interface RenderSeamSource {
  /** The source reference as the script's JSON writes it (`{"song": 12, "role": "mix"}`). */
  ref: unknown;
  /** Stereo at 44,100 Hz; transferred. */
  channels: Float32Array[];
  /** The source sample where `channels[0][0]` sits. */
  offset: number;
  /** The whole source's length in samples, when the window ends before it. */
  length?: number;
}

export interface RenderSeamRequest {
  id: number;
  task: 'renderSeam';
  /** The script as JSON text (schema 1). */
  script: string;
  sources: RenderSeamSource[];
  vocalSpans?: VocalSpans;
  /** Whether `cloud.device_render` is on; the page decides, the worker refuses when it is not. */
  enabled: boolean;
}

export type RenderSeamResponse =
  | {
      id: number;
      status: 'ready';
      implementation: string;
      sampleRate: number;
      clip: Float32Array[];
      report: AuditReport;
      facts: AuditFacts;
      driftMs: { a: number; b: number; nudge: number };
    }
  | { id: number; status: 'unsupported_here'; implementation: string; reason: string }
  | { id: number; status: 'off' | 'error'; implementation: string; reason: string };

function key(ref: SourceRef): string {
  return JSON.stringify([ref.song, ref.role, ref.stem, ref.start, ref.duration]);
}

/** A provider over the windows the request carried; a reference it was not given is an error. */
export function windowProvider(sources: RenderSeamSource[]): SourceProvider {
  const byRef = new Map<string, SourceAudio>();
  for (const source of sources) {
    byRef.set(key(readSourceRef(source.ref)), { channels: source.channels, sampleRate: SAMPLE_RATE, offset: source.offset, length: source.length });
  }
  return {
    samples(ref) {
      const found = byRef.get(key(ref));
      if (!found) throw new Error(`no audio was sent for source ${JSON.stringify(ref)}`);
      return found;
    },
  };
}

/** Render and audit one script. Pure; never throws (a failure comes back as data). */
export function renderSeam(request: RenderSeamRequest, stretcher: Stretcher = wsolaStretcher): { response: RenderSeamResponse; transfer: ArrayBuffer[] } {
  const implementation = `${RENDER_IMPLEMENTATION}+${stretcher.id}`;
  const { id } = request;
  if (request.enabled !== true) {
    return { response: { id, status: 'off', implementation, reason: 'rendering transitions on this device is switched off' }, transfer: [] };
  }
  try {
    const script = scriptFromJson(request.script);
    const rendered = renderScript(script, windowProvider(request.sources), stretcher);
    if (rendered.status !== 'ready') return { response: { id, status: 'unsupported_here', implementation, reason: rendered.reason }, transfer: [] };
    const report = audit(rendered, request.vocalSpans ?? {});
    const clip = rendered.audio;
    return {
      response: { id, status: 'ready', implementation: rendered.implementation, sampleRate: SAMPLE_RATE, clip, report, facts: auditFacts(report), driftMs: rendered.driftMs },
      transfer: clip.map((channel) => channel.buffer as ArrayBuffer),
    };
  } catch (problem) {
    return { response: { id, status: 'error', implementation, reason: problem instanceof Error ? problem.message : String(problem) }, transfer: [] };
  }
}

/** The message body as a RenderSeamRequest, or null when it is not a well-formed one. */
export function trustedRenderRequest(data: unknown): RenderSeamRequest | null {
  if (typeof data !== 'object' || data === null) return null;
  const request = data as Partial<RenderSeamRequest>;
  if (typeof request.id !== 'number' || request.task !== 'renderSeam' || typeof request.script !== 'string' || !Array.isArray(request.sources)) return null;
  for (const source of request.sources) {
    if (!source || !Array.isArray(source.channels) || !source.channels.every((channel) => channel instanceof Float32Array) || typeof source.offset !== 'number') return null;
  }
  return request as RenderSeamRequest;
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: RenderSeamResponse, transfer: ArrayBuffer[]) => void;
};

const scope = globalThis as unknown as Partial<WorkerScope> & { window?: unknown };

// Only wire the message loop when running as a worker; importing this module stays side-effect free.
if (typeof scope.postMessage === 'function' && scope.window === undefined) {
  (scope as WorkerScope).onmessage = (event) => {
    // a dedicated worker only hears the page that spawned it, whose messages carry no origin
    if (event.origin !== '') return;
    const request = trustedRenderRequest(event.data);
    if (!request) return;
    const { response, transfer } = renderSeam(request);
    (scope as WorkerScope).postMessage(response, transfer);
  };
}
