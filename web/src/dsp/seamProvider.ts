/** The seam provider the browser scheduler asks for each transition (ADR-0459, BF-0459-04).
 *
 * For one transition it is handed the two decoded songs. It runs the lightweight analysis
 * (onsets, tempo) on a bounded slice of each, the tail of the outgoing song and the head of the
 * incoming one, lays a constant-tempo beat grid over the whole song from the onsets, and asks
 * seamScript.ts for the schedule of the move the mix's seam settings name (`mix[to].seam`, as
 * the local player reads it). Every schedule it hands out is recorded, so a surface and the
 * browser tests can name what was scheduled, never what was heard.
 *
 * Stretched entries (BF-0459-05): when the script asks for B to be stretched to A's tempo, the
 * provider renders that clip (B's entry window, along the schedule's ramp) before handing the
 * schedule over, off-thread in the worker provider. If the stretch fails or runs out of time, the
 * seam is scripted again without it and the schedule says why, so nothing claims a stretch that
 * will not play. Records never keep the rendered clip.
 *
 * Mixed-source seams (ADR-0465): a seam joins a device track and a hosted track only when the
 * capability record says both paths are seam-safe; otherwise it is the plain fade with the
 * reason recorded.
 */

import { detectOnsets } from './analysis/onsets';
import { DEFAULT_HORIZON_S, WorkerBudget, workerCalibrationState, WORKER_CALIBRATION_IMPLEMENTATION, type WorkerCalibration } from './budget';
import { estimateTempo } from './analysis/tempo';
import type { AnalysisResponse } from './workers/analysisWorker';
import { analyseInWorker, spawnAnalysisWorker } from './workers/spawn';
import { seamWorkStarted } from './seamWork';
import { fadeSchedule, type SeamSchedule, type StretchedClip, type TrackTiming } from './seams';
import { scriptSeam, type Ability, type ScriptRequest, type SeamAbilities } from './seamScript';
import { isStemMove, withStemMove, type StemReading, type StemStretcher } from './stemSchedule';
import { rampCurve, timeStretch } from './stretch';
import type { StretchRamp } from './stretchLimits';
import { spawnStretchWorker, stretchInWorker, STRETCH_TIMEOUT_MS } from './workers/stretchSpawn';
import type { AccountSeamAnswer, AccountSeamAsk } from '../cloud/accountSeams';
import { settleRendered } from '../cloud/renderedPlan';

/** At most this much of each song is analysed for one seam. */
export const ANALYSE_SECONDS = 60;
/** A shrunk budget never analyses less than this: below about 15 s of a song the onset grid's
 * support drops under MIN_GRID_SUPPORT on real music (measured on pop at 126 BPM: 0.85 at 60 s,
 * 0.50 at 15 s, 0.40 at 10 s), and a short slice would be blamed on the song's beat. */
export const MIN_ANALYSE_SECONDS = 20;
/** With `patient`, a block may take this many times its calibrated time, and at least this long. */
export const PATIENT_FACTOR = 6;
export const PATIENT_MIN_MS = 8000;
/** An onset within this distance of a grid line votes for that phase. */
const PHASE_TOLERANCE_SECONDS = 0.03;
const PHASE_STEPS = 64;

/** Lead-in and tail rendered around a stretched clip, so the stretch's edge frames are never
 * heard; the scheduler skips the lead-in and hands over before the tail. */
export const CLIP_CONTEXT_SECONDS = 0.1;
/** The clip must reach this far past the handover for the 30 ms crossfade into native B. */
const HANDOVER_MARGIN_SECONDS = 0.05;

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
  return timingFromAnalysis(buffer, sliceFacts(pcm, buffer.sampleRate), offset, { onsetTimes: onsets.onsetTimes, tempo: estimateTempo(onsets) });
}

/** Rebuild a song's timing record from worker output without moving channel data off the page.
 * This is shared by synchronous diagnostics and the production worker-backed seam provider. */
/** What the trust check needs from an analysed slice, read before the slice is handed to a worker:
 * a transferred Float32Array is emptied on this side, and an empty slice would read as no pulse and
 * no grid, so every song would look unsure. */
type SliceFacts = { pulse: number; seconds: number };
function sliceFacts(pcm: Float32Array, sampleRate: number): SliceFacts {
  return { pulse: pulseStrength(pcm), seconds: pcm.length / sampleRate };
}

function timingFromAnalysis(buffer: PcmLike, slice: SliceFacts, offset: number, analysis: Pick<AnalysisResponse, 'onsetTimes' | 'tempo'>): TrackTiming {
  const estimate = analysis.tempo ?? { bpm: 0, confidence: 0, ambiguous: true, implementation: 'worker-analysis-missing-v0' };
  const onsetTimes = (analysis.onsetTimes ?? []).map((time) => time + offset);
  const beats = beatGrid(estimate.bpm, onsetTimes, buffer.duration);
  const pulse = slice.pulse;
  const support = gridSupport(beats, onsetTimes, offset, offset + slice.seconds);
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
  /** The moves this account has on, read when each seam is planned; every move when absent. */
  allowed?(): readonly string[] | undefined;
  /** Stem moves (stemSchedule.ts): the prefetcher's cache and the mix's stem settings. Without
   * it no stem move is weighed. Only the worker provider plays them. */
  stems?: StemReading;
};

export type SeamRequestLike = { fromIndex: number; from: PcmLike; toIndex: number; to: PcmLike; fromLevel?: number; toLevel?: number };

/** B's input window and the ramp for a schedule's stretched entry: the clip's lead-in starts
 * up to CLIP_CONTEXT_SECONDS before B's entry and its tail runs as far past the handover. */
export function clipInput(schedule: SeamSchedule, to: PcmLike): { channels: Float32Array[]; ramp: StretchRamp; skipSeconds: number } {
  const stretch = schedule.stretch;
  if (!stretch) throw new Error('the seam has no stretched entry');
  const rate = to.sampleRate;
  const total = Math.floor(to.duration * rate);
  const from = Math.max(0, Math.round((stretch.sourceFrom - CLIP_CONTEXT_SECONDS) * rate));
  const end = Math.min(total, Math.round((stretch.handoverSourceAt + CLIP_CONTEXT_SECONDS) * rate));
  const skipSeconds = (stretch.sourceFrom - from / rate) / stretch.ratio;
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < Math.max(1, to.numberOfChannels); channel += 1) channels.push(to.getChannelData(channel).slice(from, end));
  const ramp = { ratio: stretch.ratio, holdSeconds: skipSeconds + (stretch.holdUntil - schedule.startSeconds), rampSeconds: stretch.rampUntil - stretch.holdUntil };
  return { channels, ramp, skipSeconds };
}

/** The schedule with its rendered clip attached, after checking the clip covers the handover. */
export function withClip(schedule: SeamSchedule, clip: StretchedClip): SeamSchedule {
  const stretch = schedule.stretch;
  if (!stretch) throw new Error('the seam has no stretched entry');
  const length = clip.channels[0]?.length ?? 0;
  if (!clip.channels.length || clip.channels.some((channel) => channel.length !== length)) throw new Error('the stretched audio came back malformed');
  const needed = clip.skipSeconds + (stretch.handoverAt - schedule.startSeconds) + HANDOVER_MARGIN_SECONDS;
  if (length / clip.sampleRate < needed) throw new Error('the stretched audio came back too short');
  return { ...schedule, stretch: { ...stretch, clip } };
}

/** The schedule as a record keeps it: everything but the rendered clip and the stems' audio. */
export function recordable(schedule: SeamSchedule): SeamSchedule {
  let kept = schedule;
  if (kept.stretch?.clip) {
    const { clip: _clip, ...stretch } = kept.stretch;
    kept = { ...kept, stretch };
  }
  if (kept.stems?.buffers) kept = { ...kept, stems: { plan: kept.stems.plan } };
  if (kept.rendered) kept = { ...kept, rendered: { ...kept.rendered, channels: [] } };
  // what plays instead keeps no audio in the record either
  if (kept.instead) kept = { ...kept, instead: recordable(kept.instead) };
  return kept;
}

/** The same seam scripted again without the stretch, saying why it could not be prepared. */
function unstretched(request: ScriptRequest, problem: unknown): SeamSchedule {
  const reason = `the stretch could not be prepared: ${problem instanceof Error ? problem.message : String(problem)}`;
  const schedule = scriptSeam({ ...request, abilities: { ...request.abilities, stretch: { ok: false, reason } } });
  const instead = schedule.kind === 'fade' ? 'fade' : 'unstretched';
  return { ...schedule, degraded: [...(schedule.degraded ?? []), { wanted: 'stretch', instead, reason }] };
}

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
        style: settings.move || 'blend',
        degraded: [{ wanted: settings.move || 'blend', instead: 'fade', reason: `one music path is not seam-safe: ${unsafe.reason}` }],
      };
    } else {
      const scripted: ScriptRequest = {
        a, b,
        move: settings.move,
        bars: settings.bars,
        exitBar: settings.exit_bar,
        entryBar: settings.entry_bar,
        abilities: options.abilities(),
        allowed: options.allowed?.(),
      };
      schedule = scriptSeam(scripted);
      if (schedule.stretch) {
        try {
          const input = clipInput(schedule, request.to);
          const result = timeStretch(input.channels, request.to.sampleRate, rampCurve(input.ramp));
          if (result.status !== 'ready') throw new Error(result.reason);
          schedule = withClip(schedule, { channels: result.channels, sampleRate: request.to.sampleRate, skipSeconds: input.skipSeconds });
        } catch (problem) {
          schedule = unstretched(scripted, problem);
        }
      }
    }
    options.onPlanned?.({ fromIndex: request.fromIndex, toIndex: request.toIndex, sources, schedule: recordable(schedule) });
    return schedule;
  };
}

export type WorkerSeamProvider = ((request: SeamRequestLike) => Promise<SeamSchedule>) & { dispose(): void };

export type WorkerSeamProviderOptions = SeamProviderOptions & {
  /** Override for a worker factory in browser integration and verification harnesses. */
  workerFactory?: () => Worker;
  /** Override for the stretch worker's factory, likewise. */
  stretchWorkerFactory?: () => Worker;
  /** How long a stretched entry may take to render before the seam goes without it. */
  stretchTimeoutMs?: number;
  /** Per-device worker calibration. Missing, stale, or mismatched evidence keeps Tier 2 off. */
  calibration?: WorkerCalibration | null;
  /** Current local device identity; it must match the calibration record. */
  deviceId?: string | null;
  /** Injectable clock for capability refresh and deterministic application integration. */
  now?: () => number;
  /** Receives the live scheduling state so the engine roster can stop claiming Tier 2 after misses. */
  onBudgetState?(state: { supported: boolean; reason?: string; deadlineMisses: number; horizonS?: number }): void;
  /** cloud.seam_lead: seams are planned minutes ahead, so a slow analysis block is waited for
   * (up to PATIENT_FACTOR times its calibrated time) and counted, and never shrinks the horizon:
   * one busy moment no longer ends beatmatching for the rest of the visit. */
  patient?: () => boolean;
  /** The account's planner (cloud/accountSeams.ts), asked before this device chooses: its plan
   * on the songs' measured grids, why it declined, or null when it wasn't asked. */
  planned?: (ask: AccountSeamAsk) => Promise<AccountSeamAnswer>;
};

/** Production seam provider. It performs onset and tempo analysis in a module worker and only
 * does the small beat-grid/schedule assembly on the caller. If worker analysis is unavailable,
 * it emits a labelled fade rather than running a long PCM analysis on the audio/UI thread. */
export function makeWorkerSeamProvider(options: WorkerSeamProviderOptions): WorkerSeamProvider {
  const makeWorker = options.workerFactory ?? spawnAnalysisWorker;
  const makeStretcher = options.stretchWorkerFactory ?? spawnStretchWorker;
  let worker: Worker | null = null;
  let stretcher: Worker | null = null;
  let disposed = false;
  const now = options.now ?? (() => Date.now());
  const calibrationState = () => workerCalibrationState(options.calibration, options.deviceId, now());
  const liveBudget = calibrationState().supported && options.calibration
    ? WorkerBudget.fromCalibration(options.calibration, options.deviceId!, now())
    : null;
  let budget = liveBudget;
  const budgetState = (reason?: string) => {
    const calibration = calibrationState();
    const supported = calibration.supported && !!budget && !budget.atFloor;
    options.onBudgetState?.({
      supported,
      reason: reason ?? (!calibration.supported ? calibration.reason : budget?.atFloor ? 'this device is out of headroom, so lightweight analysis is paused' : undefined),
      deadlineMisses: budget?.deadlineMisses ?? 0,
      horizonS: budget?.horizonS,
    });
    return { supported, reason: reason ?? (!calibration.supported ? calibration.reason : budget?.atFloor ? 'this device is out of headroom, so lightweight analysis is paused' : undefined) };
  };
  const getWorker = () => {
    if (!worker) worker = makeWorker();
    return worker;
  };

  const prepare = async (request: SeamRequestLike): Promise<SeamSchedule> => {
    const sources = { a: options.sourceOf?.(request.fromIndex) ?? null, b: options.sourceOf?.(request.toIndex) ?? null };
    const settings = options.settingsFor(request.toIndex) ?? {};
    if (disposed) return fadeSchedule(Math.max(30, request.from.duration - 5), 0, 'seam preparation stopped');
    const initial = budgetState();
    if (!initial.supported || !budget) {
      const reason = initial.reason ?? 'this device has no current worker budget';
      const schedule = {
        ...fadeSchedule(Math.max(30, request.from.duration - 5), 0, reason),
        // the label survives the degrade: the member asked for this move, and the fade says so
        style: settings.move || 'beatmatch',
        degraded: [{ wanted: settings.move || 'beatmatch', instead: 'fade' as const, reason }],
      };
      options.onPlanned?.({ fromIndex: request.fromIndex, toIndex: request.toIndex, sources, schedule });
      return schedule;
    }
    let cloudClip: SeamSchedule | null = null;
    try {
      const analyse = async (buffer: PcmLike, part: 'head' | 'tail') => {
        const current = budgetState();
        if (!current.supported || !budget) throw new Error(current.reason ?? 'worker budget exhausted');
        // A missed deadline halves the work window on the next block as well as shrinking the
        // prepared horizon. This gives the calibrated budget an actual effect on DSP cost.
        const workSeconds = Math.max(MIN_ANALYSE_SECONDS, ANALYSE_SECONDS * Math.min(1, budget.horizonS / DEFAULT_HORIZON_S));
        const { pcm, offset } = sliceMono(buffer, part, workSeconds);
        const facts = sliceFacts(pcm, buffer.sampleRate);
        const began = now();
        const patient = options.patient?.() === true;
        let response: AnalysisResponse;
        try {
          response = await analyseInWorker(getWorker(), pcm, buffer.sampleRate, ['onsets', 'tempo'], {
            owned: true,
            timeoutMs: patient
              ? Math.max(PATIENT_MIN_MS, Math.ceil(budget.msPerBlock * PATIENT_FACTOR))
              : Math.max(1, Math.ceil(budget.msPerBlock)),
          });
        } catch (error) {
          const elapsed = Math.max(0, now() - began);
          if (budget.recordBlock(elapsed) && !patient) budget.shrinkHorizon();
          budgetState(elapsed > budget.msPerBlock
            ? `worker missed its calibrated deadline (${Math.round(elapsed)} ms over ${Math.round(budget.msPerBlock)} ms)`
            : undefined);
          throw error;
        }
        const elapsed = Math.max(0, now() - began);
        if (budget.recordBlock(elapsed) && patient) {
          // slow but finished, with time in hand: keep the result, and say the miss was counted
          budgetState();
        } else if (elapsed > budget.msPerBlock) {
          budget.shrinkHorizon();
          budgetState(`worker missed its calibrated deadline (${Math.round(elapsed)} ms over ${Math.round(budget.msPerBlock)} ms)`);
          throw new Error('worker missed its calibrated deadline');
        }
        if (response.error || !response.tempo) throw new Error(response.error || 'tempo analysis returned no result');
        return timingFromAnalysis(buffer, facts, offset, response);
      };
      // the account's plan comes on the songs' measured grids, so nothing is analysed for it
      const asked = await options.planned?.({
        fromIndex: request.fromIndex, toIndex: request.toIndex, fromSeconds: request.from.duration, toSeconds: request.to.duration,
        settings, abilities: options.abilities(), allowed: options.allowed?.(),
        from: request.from as AudioBuffer, to: request.to as AudioBuffer, fromLevel: request.fromLevel, toLevel: request.toLevel,
      }).catch(() => null) ?? null;
      // a clip rendered ahead that does not fit these very songs gives way before it is recorded
      const settled = settleRendered(asked, request);
      // a clip from the cloud studio has no live plan of its own: this device chooses as usual, and
      // that choice is kept as what plays if the clip cannot be used after all (cloud.studio_seams)
      const fromCloud = settled && 'schedule' in settled && settled.schedule.chosenBy?.by === 'cloud' && !settled.schedule.instead ? settled : null;
      cloudClip = fromCloud?.schedule ?? null;
      const answer = fromCloud ? null : settled;
      const plan = answer && 'schedule' in answer ? answer : null;
      const chosenBy = plan ? plan.schedule.chosenBy : answer && 'declined' in answer ? { by: 'device' as const, note: answer.declined } : undefined;
      // an injected analysis (tests, diagnostics) stands in for the worker's
      const a = plan ? plan.scripted.a : options.timing ? options.timing(request.from, 'tail') : await analyse(request.from, 'tail');
      const b = plan ? plan.scripted.b : options.timing ? options.timing(request.to, 'head') : await analyse(request.to, 'head');
      const afterAnalysis = budgetState();
      if (!afterAnalysis.supported) throw new Error(afterAnalysis.reason ?? 'worker budget exhausted');
      if (disposed) return fadeSchedule(Math.max(30, a.durationSeconds - 5), 0, 'seam preparation stopped');
      const unsafe = sources.a && sources.b && sources.a !== sources.b
        ? [sources.a, sources.b].map((source) => options.sourceSafe?.(source) ?? { ok: true as const }).find((ability) => !ability.ok)
        : undefined;
      const abilities = options.abilities();
      const scripted: ScriptRequest = plan ? plan.scripted : {
        a, b,
        // a stem move's fallback is the move SelectaDJ would pick without stems
        move: isStemMove(settings.move) ? 'auto' : settings.move,
        bars: settings.bars,
        exitBar: settings.exit_bar,
        entryBar: settings.entry_bar,
        abilities,
        allowed: options.allowed?.(),
      };
      let schedule: SeamSchedule = plan && !(unsafe && !unsafe.ok) ? plan.schedule : unsafe && !unsafe.ok
        ? {
            ...fadeSchedule(Math.max(30, a.durationSeconds - 5), 0, `mixed-source seam: ${unsafe.reason}`),
            style: settings.move || 'blend',
            degraded: [{ wanted: settings.move || 'blend', instead: 'fade' as const, reason: `one music path is not seam-safe: ${unsafe.reason}` }],
          }
        : scriptSeam(scripted);
      // the planner's choice is played as planned; stems are weighed only when this device chooses
      if (options.stems && !plan && !(unsafe && !unsafe.ok)) {
        const stretchStem: StemStretcher = async (channels, sampleRate, ramp) => {
          try {
            if (!stretcher) stretcher = makeStretcher();
            return await stretchInWorker(stretcher, channels, sampleRate, ramp, { owned: true, timeoutMs: options.stretchTimeoutMs ?? STRETCH_TIMEOUT_MS });
          } catch (problem) {
            stretcher?.terminate();
            stretcher = null;
            throw problem;
          }
        };
        schedule = await withStemMove({
          fromIndex: request.fromIndex,
          toIndex: request.toIndex,
          a, b,
          move: settings.move,
          normal: schedule,
          abilities,
          stems: options.stems,
          stretch: stretchStem,
        });
        if (disposed) return fadeSchedule(Math.max(30, a.durationSeconds - 5), 0, 'seam preparation stopped');
      }
      if (schedule.stretch && !schedule.stems) {
        try {
          const input = clipInput(schedule, request.to);
          if (!stretcher) stretcher = makeStretcher();
          const channels = await stretchInWorker(stretcher, input.channels, request.to.sampleRate, input.ramp, {
            owned: true,
            timeoutMs: options.stretchTimeoutMs ?? STRETCH_TIMEOUT_MS,
          });
          if (disposed) return fadeSchedule(Math.max(30, a.durationSeconds - 5), 0, 'seam preparation stopped');
          schedule = withClip(schedule, { channels, sampleRate: request.to.sampleRate, skipSeconds: input.skipSeconds });
        } catch (problem) {
          stretcher?.terminate();
          stretcher = null;
          schedule = unstretched(scripted, problem);
        }
      }
      // who chose it, said on the record for the Listening Room and the seam inspector
      if (chosenBy && !schedule.chosenBy) schedule = { ...schedule, chosenBy };
      if (fromCloud) schedule = { ...fromCloud.schedule, instead: schedule };
      options.onPlanned?.({ fromIndex: request.fromIndex, toIndex: request.toIndex, sources, schedule: recordable(schedule) });
      return schedule;
    } catch (problem) {
      // the cloud's clip still plays when this device could not work out its own choice
      if (cloudClip) {
        options.onPlanned?.({ fromIndex: request.fromIndex, toIndex: request.toIndex, sources, schedule: recordable(cloudClip) });
        return cloudClip;
      }
      worker?.terminate();
      worker = null;
      const reason = problem instanceof Error ? problem.message : String(problem);
      budgetState(reason);
      const schedule = {
        ...fadeSchedule(Math.max(30, request.from.duration - 5), 0, `seam analysis worker failed: ${reason}`),
        style: settings.move || 'beatmatch',
        degraded: [{ wanted: settings.move || 'beatmatch', instead: 'fade' as const, reason: `worker analysis unavailable: ${reason}` }],
      };
      options.onPlanned?.({ fromIndex: request.fromIndex, toIndex: request.toIndex, sources, schedule });
      return schedule;
    }
  };
  // background work (the key profiler) holds off while a transition is in hand (seamWork.ts)
  const provide = async (request: SeamRequestLike): Promise<SeamSchedule> => {
    const done = seamWorkStarted();
    try { return await prepare(request); } finally { done(); }
  };
  return Object.assign(provide, {
    dispose() {
      if (disposed) return;
      disposed = true;
      worker?.terminate();
      worker = null;
      stretcher?.terminate();
      stretcher = null;
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
  /** Required stable device identity; calibration without it is not reusable evidence. */
  deviceId: string;
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
export async function calibrateAnalysisInWorker(options: WorkerCalibrationOptions): Promise<WorkerCalibration | null> {
  const samples = options.samples ?? 3;
  // Match the provider's bounded analysis window so small calibrations cannot overstate capacity.
  const seconds = options.seconds ?? ANALYSE_SECONDS;
  const sampleRate = options.sampleRate ?? 44100;
  if (typeof options.deviceId !== 'string' || !options.deviceId.trim() ||
      !Number.isInteger(samples) || samples < 1 || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
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
    const measured = WorkerBudget.fromBenchmark(times);
    return {
      implementation: WORKER_CALIBRATION_IMPLEMENTATION,
      deviceId: options.deviceId,
      calibratedAt: Date.now(),
      samples,
      msPerBlock: measured.msPerBlock,
      horizonS: measured.horizonS,
    };
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
    echo: of('echo_returns', 'this device has no echo or reverb returns'),
  };
}
