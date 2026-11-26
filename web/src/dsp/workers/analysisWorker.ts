/** Module worker running the lightweight analysis off-thread (ADR-0459, BF-0459-06).
 *
 * Spawned by `spawn.ts` with the Vite module-worker convention. PCM arrives as a transferred
 * Float32Array (zero copy), the onset/tempo/key estimates run here, and a small result goes
 * back. Nothing in this file ever touches the audio callback: the engine's worklet never
 * waits on a worker.
 *
 * `analyse` is exported as a pure function so tests exercise the exact code the worker runs
 * without needing a Worker runtime. `analyseRequest` adds the neural beat tracker, which runs
 * asynchronously (onnxruntime-web), for a `song` asked with `beatModel`.
 */

import { detectOnsets } from '../analysis/onsets';
import { estimateKey, type KeyEstimate } from '../analysis/key';
import { estimateTempo, type TempoEstimate } from '../analysis/tempo';
import { integratedLoudness, samplePeakDb } from '../loudness';
import { tonalProfile, type TonalProfile } from '../analysis/tonalProfile';
import { browserBeatSource } from '../analysis/beatSource';
import { readBeatModelBytes } from '../analysis/beatThis/model';
import { loadBeatRuntime, type BeatRuntime } from '../analysis/beatThis/runtime';
import { beatThisSource } from '../analysis/beatThis/source';
import { FEATURE_SR } from '../analysis/features';
import { measureSong, measureSongAsync, type SongFacts } from '../analysis/song';

/** `profile` (whole-song tonal profile, cloud.browser_harmonic) is only run when asked for. */
/** `loudness` (the whole song's level, cloud.seam_lead) reads `channels`, not `pcm`. */
/** `song` (whole-song facts, cloud.device_analysis) reads `channels` at `sampleRate`; asked
 * with `profile` and an empty `pcm`, the profile is made from the same signal. */
export type AnalysisTask = 'onsets' | 'tempo' | 'key' | 'profile' | 'loudness' | 'song';

export interface AnalysisRequest {
  id: number;
  sampleRate: number;
  /** Mono PCM; the buffer is transferred, not copied. */
  pcm: Float32Array;
  /** Which estimates to run; onsets, tempo and key when omitted. */
  tasks?: AnalysisTask[];
  /** Every channel of the song, for `loudness` and `song`; transferred, not copied. */
  channels?: Float32Array[];
  /** `song` with the neural beat tracker: the fingerprint of the verified model kept in this
   * browser's private storage (analysis/beatThis/gate.ts chose it). */
  beatModel?: { sha256: string };
}

export interface AnalysisResponse {
  id: number;
  tempo?: TempoEstimate;
  key?: KeyEstimate;
  onsetTimes?: number[];
  profile?: TonalProfile;
  /** Integrated loudness (BS.1770) and sample peak of `channels`. */
  lufs?: number;
  peakDb?: number;
  /** The whole song's facts (`song`). */
  facts?: SongFacts;
  /** With `beatModel`: how long the neural tracker took, for this device's benchmark. */
  beatMs?: number;
  /** With `beatModel`: why the interim source measured instead. */
  beatFallback?: string;
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
    if (tasks.has('loudness') && request.channels?.length) {
      response.lufs = integratedLoudness(request.channels, request.sampleRate);
      response.peakDb = samplePeakDb(request.channels);
    }
    if (tasks.has('song') && request.channels?.length) {
      const measured = measureSong(request.channels, request.sampleRate, browserBeatSource);
      response.facts = measured.facts;
      // the profile from the same 22,050 Hz signal, so a song is decoded once for both
      if (tasks.has('profile') && request.pcm.length === 0) {
        response.profile = tonalProfile(measured.detail.mono22k, FEATURE_SR);
      }
    }
    if (tasks.has('profile') && !response.profile) {
      response.profile = tonalProfile(request.pcm, request.sampleRate);
    }
  } catch (problem) {
    response.error = problem instanceof Error ? problem.message : String(problem);
  }
  return response;
}

const SHA256 = /^[0-9a-f]{64}$/;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The runtime over the verified model in private storage, checked again by hash here: a file
 * changed on disk since it was verified is refused. */
export async function loadVerifiedBeatRuntime(sha256: string): Promise<BeatRuntime> {
  const bytes = await readBeatModelBytes();
  if (!bytes) throw new Error('the beat model is not in this browser\'s storage');
  if ((await sha256Hex(bytes)) !== sha256) throw new Error('the beat model in storage does not match its fingerprint');
  return loadBeatRuntime(new Uint8Array(bytes));
}

let runtime: { sha256: string; loading: Promise<BeatRuntime> } | null = null;

/** A pause between chunks, so the worker answers other messages during a long song. */
const breath = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** `analyse`, with a `song` measured by the neural tracker when `beatModel` names it. A model
 * that will not load or run falls back to the interim source for this song, and says why. */
export async function analyseRequest(
  request: AnalysisRequest,
  load: (sha256: string) => Promise<BeatRuntime> = loadVerifiedBeatRuntime,
): Promise<AnalysisResponse> {
  const tasks = new Set<AnalysisTask>(request.tasks ?? []);
  const sha = request.beatModel?.sha256;
  if (!tasks.has('song') || !request.channels?.length || typeof sha !== 'string' || !SHA256.test(sha)) return analyse(request);
  const response: AnalysisResponse = { id: request.id };
  try {
    if (!runtime || runtime.sha256 !== sha) runtime = { sha256: sha, loading: load(sha) };
    const loaded = await runtime.loading;
    const measured = await measureSongAsync(request.channels, request.sampleRate, beatThisSource(loaded.run, breath));
    response.facts = measured.facts;
    response.beatMs = measured.beatMs;
    if (tasks.has('profile') && request.pcm.length === 0) response.profile = tonalProfile(measured.detail.mono22k, FEATURE_SR);
    if (tasks.has('profile') && !response.profile) response.profile = tonalProfile(request.pcm, request.sampleRate);
    return response;
  } catch (problem) {
    runtime = null;
    const fallback = analyse({ ...request, beatModel: undefined });
    fallback.beatFallback = problem instanceof Error ? problem.message : String(problem);
    return fallback;
  }
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
    if (request) void analyseRequest(request).then((response) => (scope as WorkerScope).postMessage(response));
  };
}
