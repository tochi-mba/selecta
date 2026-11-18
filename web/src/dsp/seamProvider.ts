/** The seam provider the browser scheduler asks for each transition (ADR-0459, BF-0459-04).
 *
 * For one transition it is handed the two decoded songs. It runs the lightweight analysis
 * (onsets, tempo) on a bounded slice of each, the tail of the outgoing song and the head of the
 * incoming one, lays a constant-tempo beat grid over the whole song from the onsets, and asks
 * seamScript.ts for the schedule of the move the mix's seam settings name (`mix[to].seam`, as
 * the local player reads it). Every schedule it hands out is recorded, so a surface and the
 * browser tests can name what was scheduled, never what was heard.
 *
 * Mixed-source seams (ADR-0465): a seam joins a device track and a hosted track only when the
 * capability record says both paths are seam-safe; otherwise it is the plain fade with the
 * reason recorded.
 */

import { detectOnsets } from './analysis/onsets';
import { WorkerBudget } from './budget';
import { estimateTempo } from './analysis/tempo';
import type { AnalysisResponse } from './workers/analysisWorker';
import { analyseInWorker, spawnAnalysisWorker } from './workers/spawn';
import { fadeSchedule, type SeamSchedule, type TrackTiming } from './seams';
import { scriptSeam, type Ability, type SeamAbilities } from './seamScript';

/** At most this much of each song is analysed for one seam. */
export const ANALYSE_SECONDS = 60;
/** An onset within this distance of a grid line votes for that phase. */
const PHASE_TOLERANCE_SECONDS = 0.03;
const PHASE_STEPS = 64;

export type MusicSource = 'device' | 'hosted';
/** The seam settings a mix item carries (api.ts SeamSettings), as far as the browser reads them. */
export type SeamSettingsLike = { move?: string | null; bars?: number | null; exit_bar?: number | null; entry_bar?: number | null };

/** The slice of an AudioBuffer analysis reads. */
export type PcmLike = { sampleRate: number; duration: number; numberOfChannels: number; getChannelData(channel: number): Float32Array };

export type SeamRecord = {
  fromIndex: number;
  toIndex: number;
  sources: { a: MusicSource | null; b: MusicSource | null };
  schedule: SeamSchedule;
};

/** The phase of a constant-tempo grid that the most onsets sit on, then the grid over the
 * song's whole length. Empty when there is no tempo or no onset to place it. */
export function beatGrid(bpm: number, onsetTimes: readonly number[], durationSeconds: number): number[] {
  if (!(bpm > 0) || !onsetTimes.length) return [];
  const period = 60 / bpm;
  let best = 0;
  let bestVotes = -1;
  for (let step = 0; step < PHASE_STEPS; step += 1) {
    const phase = (step / PHASE_STEPS) * period;
    let votes = 0;
    for (const time of onsetTimes) {
      const off = (((time - phase) % period) + period) % period;
      if (Math.min(off, period - off) <= PHASE_TOLERANCE_SECONDS) votes += 1;
    }
    if (votes > bestVotes) {
      bestVotes = votes;
      best = phase;
    }
  }
  const beats: number[] = [];
  for (let time = best; time < durationSeconds; time += period) beats.push(time);
  return beats;
}

/** Mono samples of one part of a song: the tail of the outgoing, the head of the incoming. */
export function sliceMono(buffer: PcmLike, part: 'head' | 'tail', seconds = ANALYSE_SECONDS): { pcm: Float32Array; offset: number } {
  const total = Math.floor(buffer.duration * buffer.sampleRate);
  const length = Math.min(total, Math.floor(seconds * buffer.sampleRate));
  const from = part === 'tail' ? total - length : 0;
  const pcm = new Float32Array(length);
  const channels = Math.max(1, buffer.numberOfChannels);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) pcm[index] += (data[from + index] ?? 0) / channels;
  }
  return { pcm, offset: from / buffer.sampleRate };
}

/** How much the loudness moves frame to frame: the coefficient of variation of 1024-sample RMS.
 * A steady tone or a drone is near 0; anything with a pulse moves. The onset flux is normalised
 * to its own peak, so without this a steady tone's tiny ripples could look like a beat. */
export function pulseStrength(pcm: Float32Array, frame = 1024): number {
  const levels: number[] = [];
  for (let start = 0; start + frame <= pcm.length; start += frame) {
    let sum = 0;
    for (let index = start; index < start + frame; index += 1) sum += pcm[index] * pcm[index];
    levels.push(Math.sqrt(sum / frame));
  }
  if (levels.length < 2) return 0;
  const mean = levels.reduce((total, level) => total + level, 0) / levels.length;
  if (!(mean > 1e-6)) return 0;
  const variance = levels.reduce((total, level) => total + (level - mean) ** 2, 0) / levels.length;
  return Math.sqrt(variance) / mean;
}

/** Below this pulse strength there is no beat to match, whatever the tempo estimate says. */
export const MIN_PULSE = 0.05;
/** At least this share of the grid's beats inside the analysed slice must sit on an onset. */
export const MIN_GRID_SUPPORT = 0.5;

/** The share of grid beats inside [from, to) that have an onset within 60 ms. */
export function gridSupport(beats: readonly number[], onsetTimes: readonly number[], from: number, to: number): number {
  const inside = beats.filter((beat) => beat >= from && beat < to);
  if (!inside.length) return 0;
  const hit = inside.filter((beat) => onsetTimes.some((time) => Math.abs(time - beat) <= PHASE_TOLERANCE_SECONDS * 2));
  return hit.length / inside.length;
}

/** The lightweight timing of one song from a bounded slice of it. The tempo's confidence is
 * capped when the slice has no pulse or the grid is not borne out by the onsets, so a steady
 * tone or a loose fit is never beatmatched on (seams.ts falls back to a fade). */
export function analyseTiming(buffer: PcmLike, part: 'head' | 'tail'): TrackTiming {
  const { pcm, offset } = sliceMono(buffer, part);
  const onsets = detectOnsets(pcm, buffer.sampleRate);
  return timingFromAnalysis(buffer, pcm, offset, { onsetTimes: onsets.onsetTimes, tempo: estimateTempo(onsets) });
}

/** Rebuild a song's timing record from worker output without moving channel data off the page.
 * This is shared by synchronous diagnostics and the production worker-backed seam provider. */
function timingFromAnalysis(buffer: PcmLike, pcm: Float32Array, offset: number, analysis: Pick<AnalysisResponse, 'onsetTimes' | 'tempo'>): TrackTiming {
  const estimate = analysis.tempo ?? { bpm: 0, confidence: 0, ambiguous: true, implementation: 'worker-analysis-missing-v0' };
  const onsetTimes = (analysis.onsetTimes ?? []).map((time) => time + offset);
  const beats = beatGrid(estimate.bpm, onsetTimes, buffer.duration);
  const pulse = pulseStrength(pcm);
  const support = gridSupport(beats, onsetTimes, offset, offset + pcm.length / buffer.sampleRate);
  const trusted = pulse >= MIN_PULSE && support >= MIN_GRID_SUPPORT;
  const tempo = trusted ? estimate : { ...estimate, confidence: Math.min(estimate.confidence, pulse >= MIN_PULSE ? support * 0.5 : 0) };
  return { beats, tempo, durationSeconds: buffer.duration };
}

export type SeamProviderOptions = {
  /** The seam settings for the transition into the song at `toIndex` (mix[toIndex].seam). */
  settingsFor(toIndex: number): SeamSettingsLike | null | undefined;
  /** What this device can do, read from its capability record when the seam is planned. */
  abilities(): SeamAbilities;
  /** Which music path a song came from, once it has been resolved. */
  sourceOf?(index: number): MusicSource | null;
  /** Whether a music path is seam-safe, from the capability record. */
  sourceSafe?(source: MusicSource): Ability;
  /** Analysis, injectable for tests. */
  timing?(buffer: PcmLike, part: 'head' | 'tail'): TrackTiming;
  onPlanned?(record: SeamRecord): void;
};

export type SeamRequestLike = { fromIndex: number; from: PcmLike; toIndex: number; to: PcmLike };

/** A SeamProvider (engine/scheduler.ts) over the analysis and the seam script. */
export function makeSeamProvider(options: SeamProviderOptions) {
  const timing = options.timing ?? analyseTiming;
  return (request: SeamRequestLike): SeamSchedule => {
    const sources = { a: options.sourceOf?.(request.fromIndex) ?? null, b: options.sourceOf?.(request.toIndex) ?? null };
    const a = timing(request.from, 'tail');
    const b = timing(request.to, 'head');
    const settings = options.settingsFor(request.toIndex) ?? {};
    let schedule: SeamSchedule;
    const unsafe = sources.a && sources.b && sources.a !== sources.b
      ? [sources.a, sources.b].map((source) => options.sourceSafe?.(source) ?? { ok: true as const }).find((ability) => !ability.ok)
      : undefined;
    if (unsafe && !unsafe.ok) {
      const at = Math.max(30, a.durationSeconds - 5);
      schedule = {
        ...fadeSchedule(at, 0, `mixed-source seam: ${unsafe.reason}`),
        degraded: [{ wanted: settings.move || 'blend', instead: 'fade', reason: `one music path is not seam-safe: ${unsafe.reason}` }],
      };
    } else {
      schedule = scriptSeam({
        a, b,
        move: settings.move,
        bars: settings.bars,
        exitBar: settings.exit_bar,
        entryBar: settings.entry_bar,
        abilities: options.abilities(),
      });
    }
    options.onPlanned?.({ fromIndex: request.fromIndex, toIndex: request.toIndex, sources, schedule });
    return schedule;
  };
}

export type WorkerSeamProvider = ((request: SeamRequestLike) => Promise<SeamSchedule>) & { dispose(): void };

export type WorkerSeamProviderOptions = SeamProviderOptions & {
  /** Override for a worker factory in browser integration and verification harnesses. */
  workerFactory?: () => Worker;
};

/** Production seam provider. It performs onset and tempo analysis in a module worker and only
 * does the small beat-grid/schedule assembly on the caller. If worker analysis is unavailable,
 * it emits a labelled fade rather than running a long PCM analysis on the audio/UI thread. */
export function makeWorkerSeamProvider(options: WorkerSeamProviderOptions): WorkerSeamProvider {
  const makeWorker = options.workerFactory ?? spawnAnalysisWorker;
  let worker: Worker | null = null;
  let disposed = false;
  const getWorker = () => {
    if (!worker) worker = makeWorker();
    return worker;
  };

  const provide = async (request: SeamRequestLike): Promise<SeamSchedule> => {
    const sources = { a: options.sourceOf?.(request.fromIndex) ?? null, b: options.sourceOf?.(request.toIndex) ?? null };
    const settings = options.settingsFor(request.toIndex) ?? {};
    if (disposed) return fadeSchedule(Math.max(30, request.from.durationSeconds - 5), 0, 'seam preparation stopped');
    try {
      const analyse = async (buffer: PcmLike, part: 'head' | 'tail') => {
        const { pcm, offset } = sliceMono(buffer, part);
        const response = await analyseInWorker(getWorker(), pcm, buffer.sampleRate, ['onsets', 'tempo'], { owned: true });
        if (response.error || !response.tempo) throw new Error(response.error || 'tempo analysis returned no result');
        return timingFromAnalysis(buffer, pcm, offset, response);
      };
      const a = await analyse(request.from, 'tail');
      const b = await analyse(request.to, 'head');
      if (disposed) return fadeSchedule(Math.max(30, a.durationSeconds - 5), 0, 'seam preparation stopped');
      const unsafe = sources.a && sources.b && sources.a !== sources.b
        ? [sources.a, sources.b].map((source) => options.sourceSafe?.(source) ?? { ok: true as const }).find((ability) => !ability.ok)
        : undefined;
      const schedule = unsafe && !unsafe.ok
        ? {
            ...fadeSchedule(Math.max(30, a.durationSeconds - 5), 0, `mixed-source seam: ${unsafe.reason}`),
            degraded: [{ wanted: settings.move || 'blend', instead: 'fade' as const, reason: `one music path is not seam-safe: ${unsafe.reason}` }],
          }
        : scriptSeam({
            a, b,
            move: settings.move,
            bars: settings.bars,
            exitBar: settings.exit_bar,
            entryBar: settings.entry_bar,
            abilities: options.abilities(),
          });
      options.onPlanned?.({ fromIndex: request.fromIndex, toIndex: request.toIndex, sources, schedule });
      return schedule;
    } catch (problem) {
      worker?.terminate();
      worker = null;
      const reason = problem instanceof Error ? problem.message : String(problem);
      const schedule = {
        ...fadeSchedule(Math.max(30, request.from.durationSeconds - 5), 0, `seam analysis worker failed: ${reason}`),
        degraded: [{ wanted: settings.move || 'beatmatch', instead: 'fade' as const, reason: `worker analysis unavailable: ${reason}` }],
      };
      options.onPlanned?.({ fromIndex: request.fromIndex, toIndex: request.toIndex, sources, schedule });
      return schedule;
    }
  };
  return Object.assign(provide, {
    dispose() {
      if (disposed) return;
      disposed = true;
      worker?.terminate();
      worker = null;
    },
  });
}

type StatusOf = (feature: string) => { status: string; reason?: string } | undefined;

/** One feature of a capability record as an ability. */
export function abilityOf(status: StatusOf, feature: string, fallback = 'not recorded on this device'): Ability {
  const found = status(feature);
  return found?.status === 'ready' ? { ok: true } : { ok: false, reason: found?.reason || fallback };
}

/** Measure this device's analysis time for a few seconds of audio, as the benchmark samples a
 * WorkerBudget is calibrated from (dsp/budget.ts). The beatmatch capability rests on it. */
export function calibrateAnalysis(samples = 3, seconds = 4, sampleRate = 44100): WorkerBudget {
  const length = seconds * sampleRate;
  const pcm = new Float32Array(length);
  let seed = 1;
  for (let index = 0; index < length; index += 1) {
    seed = (seed * 16807) % 2147483647;
    pcm[index] = ((seed / 2147483647) * 2 - 1) * 0.1;
  }
  const buffer: PcmLike = { sampleRate, duration: seconds, numberOfChannels: 1, getChannelData: () => pcm };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const times: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const began = now();
    analyseTiming(buffer, 'head');
    times.push(now() - began);
  }
  return WorkerBudget.fromBenchmark(times);
}

export type WorkerCalibrationOptions = {
  samples?: number;
  seconds?: number;
  sampleRate?: number;
  /** The worker request deadline. A timeout fails calibration closed. */
  timeoutMs?: number;
  /** Override for deterministic integration harnesses. */
  workerFactory?: () => Worker;
};

/** Calibrate lightweight analysis through the same off-thread path the player uses. Unlike
 * `calibrateAnalysis`, this never runs the analysis synchronously on the page. It transfers a
 * synthetic owned buffer for each sample, measures worker round-trip latency conservatively,
 * and always tears the worker down. A missing worker, timeout, malformed response or startup
 * failure returns null so callers keep Tier 2 disabled instead of blocking the UI. */
export async function calibrateAnalysisInWorker(options: WorkerCalibrationOptions = {}): Promise<WorkerBudget | null> {
  const samples = options.samples ?? 3;
  const seconds = options.seconds ?? 4;
  const sampleRate = options.sampleRate ?? 44100;
  if (!Number.isInteger(samples) || samples < 1 || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }

  let worker: Worker | null = null;
  try {
    worker = (options.workerFactory ?? spawnAnalysisWorker)();
    const length = Math.ceil(seconds * sampleRate);
    const times: number[] = [];
    for (let sample = 0; sample < samples; sample += 1) {
      const pcm = new Float32Array(length);
      let seed = 1;
      for (let index = 0; index < length; index += 1) {
        seed = (seed * 16807) % 2147483647;
        pcm[index] = ((seed / 2147483647) * 2 - 1) * 0.1;
      }
      const began = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const response = await analyseInWorker(worker, pcm, sampleRate, ['onsets', 'tempo'], {
        owned: true,
        timeoutMs: options.timeoutMs ?? 10_000,
      });
      if (response.error || !response.tempo || !Number.isFinite(response.tempo.bpm)) return null;
      const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
      times.push(Math.max(0, ended - began));
    }
    return WorkerBudget.fromBenchmark(times);
  } catch {
    return null;
  } finally {
    worker?.terminate();
  }
}

/** The seam abilities a capability record (dsp/capability.ts) supports. */
export function abilitiesFrom(status: StatusOf): SeamAbilities {
  const of = (feature: string, fallback: string): Ability => abilityOf(status, feature, fallback);
  return {
    beatmatch: of('beatmatch', 'beatmatching is not measured on this device'),
    eqFilters: of('eq_filters', 'this device has no EQ or filters'),
    stretch: of('time_stretch', 'no vetted pitch-preserving stretch is bundled'),
    stems: of('stem_separation', 'stems are not available in the browser'),
    echo: { ok: false, reason: 'the echo and wash returns are not built for the browser yet' },
  };
}
