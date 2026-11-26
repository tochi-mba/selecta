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
import { integratedLoudness, samplePeakDb } from '../loudness';
import { tonalProfile, type TonalProfile } from '../analysis/tonalProfile';
import { browserBeatSource } from '../analysis/beatSource';
import { FEATURE_SR } from '../analysis/features';
import { measureSong, type SongFacts } from '../analysis/song';

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
