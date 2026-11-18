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

/** The lightweight timing of one song from a bounded slice of it. */
export function analyseTiming(buffer: PcmLike, part: 'head' | 'tail'): TrackTiming {
  const { pcm, offset } = sliceMono(buffer, part);
  const onsets = detectOnsets(pcm, buffer.sampleRate);
  const tempo = estimateTempo(onsets);
  const onsetTimes = onsets.onsetTimes.map((time) => time + offset);
  return { beats: beatGrid(tempo.bpm, onsetTimes, buffer.duration), tempo, durationSeconds: buffer.duration };
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
