import { SEAM_FADE_SECONDS } from '../dsp/crossfade';
import type { SeamSchedule, SeamStems, SeamStretch } from '../dsp/seams';
import { rampSourceSeconds, stretchRefusal, type StretchRamp } from '../dsp/stretchLimits';

/** Whether a seam schedule can be played as given, against the songs it joins (moved out of
 * scheduler.ts unchanged, so the playback core stays one job per file). Each check answers with
 * a reason in plain words, or null. */

/** How far ahead of now anything new is started, so the sound card never gets a time in the past. */
export const START_LEAD = 0.05;

/** What the checks read of the playing song: its clock, and its stretched entry while that runs. */
export type Playing = { startedAt: number; offset: number; duration: number; entering?: { until: number } };

/** The clip's ramp in its own output seconds from B's entry. */
export const entryRamp = (stretch: SeamStretch, entryAt: number): StretchRamp => ({
  ratio: stretch.ratio,
  holdSeconds: stretch.holdUntil - entryAt,
  rampSeconds: stretch.rampUntil - stretch.holdUntil,
});

/** Why a stretched entry cannot be played as given, or null. */
function unusableStretch(stretch: SeamStretch, entryAt: number, sourceAt: number, to: AudioBuffer): string | null {
  const { ratio, holdUntil, rampUntil, sourceFrom, inputSeconds, handoverAt, handoverSourceAt, clip } = stretch;
  if (![ratio, holdUntil, rampUntil, sourceFrom, inputSeconds, handoverAt, handoverSourceAt].every(Number.isFinite)) {
    return 'the seam schedule has an invalid stretch';
  }
  const refusal = stretchRefusal(ratio, inputSeconds);
  if (refusal) return `the seam schedule asks for a stretch outside its limits: ${refusal}`;
  if (!(holdUntil >= entryAt && rampUntil >= holdUntil && handoverAt >= rampUntil - 1e-6)) return 'the seam schedule has inconsistent stretch timing';
  if (Math.abs(sourceFrom - sourceAt) > 1e-6) return 'the stretched entry does not start where the next song enters';
  if (!(inputSeconds > 0) || Math.abs(handoverSourceAt - (sourceFrom + inputSeconds)) > 1e-6 || handoverSourceAt >= to.duration) {
    return 'the stretched entry hands over outside the next song';
  }
  // native B must pick up exactly where the clip has reached, or the handover would jump
  if (Math.abs(sourceFrom + rampSourceSeconds(entryRamp(stretch, entryAt), handoverAt - entryAt) - handoverSourceAt) > 0.005) {
    return 'the stretched entry and the next song would not line up at the handover';
  }
  if (!clip) return 'the stretched entry was not prepared';
  const length = clip.channels?.[0]?.length ?? 0;
  if (!Array.isArray(clip.channels) || !clip.channels.length || clip.channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== length)) {
    return 'the stretched entry is malformed';
  }
  if (!(clip.sampleRate > 0) || !(clip.skipSeconds >= 0) || length / clip.sampleRate < clip.skipSeconds + (handoverAt - entryAt) + SEAM_FADE_SECONDS) {
    return 'the stretched entry is too short to reach the handover';
  }
  return null;
}

const finitePoints = (points: unknown, low: number, high: number): boolean => Array.isArray(points)
  && points.every((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[1] >= low && point[1] <= high);

/** Why a stem move cannot be played as given, or null. `entryAt`/`sourceAt` are B's full-mix
 * start, which must be the plan's handover. */
function unusableStems(stems: SeamStems, entryAt: number, sourceAt: number, can: { moves: boolean; effects: boolean }): string | null {
  const plan = stems.plan;
  if (!plan || !Array.isArray(plan.layers) || !plan.layers.length) return 'the stem move has no stems to play';
  const handover = plan.handoverToNative;
  if (!handover || ![handover.at, handover.startAt, handover.bSourceAt].every(Number.isFinite)) return 'the stem move has an invalid handover';
  if (Math.abs(handover.startAt - entryAt) > 1e-6 || Math.abs(handover.bSourceAt - sourceAt) > 1e-6) {
    return 'the stem move hands over somewhere other than where the next song enters';
  }
  if (!Array.isArray(plan.bWarp) || !plan.bWarp.length || !plan.bWarp.every((pin) => Number.isFinite(pin[0]) && Number.isFinite(pin[1]))) {
    return 'the stem move has an invalid beat map';
  }
  const buffers = stems.buffers;
  if (!buffers) return 'the stems for this transition were not prepared';
  if (!(buffers.sampleRate > 0) || !Number.isFinite(buffers.a?.origin) || !Number.isFinite(buffers.b?.at)) return 'the stems for this transition are malformed';
  for (const layer of plan.layers) {
    if ((layer.side !== 'a' && layer.side !== 'b') || !Number.isFinite(layer.from) || !(layer.until > layer.from) || !Number.isFinite(layer.sourceFrom)) {
      return 'the stem move has an invalid stem';
    }
    if (!finitePoints(layer.gain, 0, 1) || !layer.gain.length) return 'the stem move has an invalid stem gain';
    if (!(layer.eq ?? []).every((eq) => ['low', 'mid', 'high'].includes(eq.band) && finitePoints(eq.points, 0, 1))) return 'the stem move has an invalid stem EQ';
    if (!(layer.filter ?? []).every((sweep) => ['highpass', 'lowpass'].includes(sweep.filter) && finitePoints(sweep.points, 1e-9, Infinity))) {
      return 'the stem move has an invalid stem filter';
    }
    if (!(layer.sends ?? []).every((send) => send.effect === 'echo' && finitePoints(send.points, 0, 1))) return 'the stem move has an invalid echo send';
    if ((layer.eq?.length || layer.filter?.length) && !can.moves) return 'this device cannot shape the stems with EQ and filters';
    if (layer.sends?.length && (!plan.echo || !can.effects)) return 'the stem move sends to an echo this device cannot make';
    const channels = (layer.side === 'a' ? buffers.a : buffers.b).stems?.[layer.stem];
    const length = channels?.[0]?.length ?? 0;
    if (!Array.isArray(channels) || !length || channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== length)) {
      return `the ${layer.stem} stem for this transition was not prepared`;
    }
    const offset = layer.side === 'a' ? layer.sourceFrom - buffers.a.origin : layer.from - buffers.b.at;
    if (offset < -1e-6 || offset + (layer.until - layer.from) > length / buffers.sampleRate + 1e-3) {
      return `the ${layer.stem} stem for this transition does not cover the move`;
    }
  }
  return null;
}

/** The earliest A-timeline second a schedule sounds anything of its own. */
function firstSound(schedule: SeamSchedule, entryAt: number): number {
  if (!schedule.stems) return entryAt;
  return Math.min(entryAt, ...schedule.stems.plan.layers.map((layer) => layer.from));
}

/** Check a schedule against the songs it joins; a reason when it cannot be used as given. */
export function unusable(schedule: SeamSchedule, from: Playing, to: AudioBuffer, now: number, can = { moves: false, effects: false }): string | null {
  if (!schedule || !Array.isArray(schedule.events) || schedule.events.length === 0) return 'the seam schedule has no events';
  if (schedule.kind !== 'beatmatch' && schedule.kind !== 'fade') return 'the seam schedule has an unknown kind';
  if (typeof schedule.implementation !== 'string' || !schedule.implementation) return 'the seam schedule has no implementation id';
  if (!Number.isFinite(schedule.startSeconds) || !Number.isFinite(schedule.windowSeconds) || schedule.windowSeconds <= 0) {
    return 'the seam schedule has invalid window timing';
  }
  for (const event of schedule.events) {
    if (!event || (event.deck !== 'a' && event.deck !== 'b') || !Number.isFinite(event.at) || event.at < 0) {
      return 'the seam schedule has an invalid event';
    }
    if (event.kind === 'gain' || event.kind === 'eq') {
      if (!Number.isFinite(event.value) || (event.value as number) < 0 || (event.value as number) > 1) {
        return 'the seam schedule has an invalid gain';
      }
      if (event.kind === 'eq' && event.band !== 'low' && event.band !== 'mid' && event.band !== 'high') {
        return 'the seam schedule has an unknown EQ band';
      }
    } else if (event.kind === 'filter') {
      if ((event.filter !== 'highpass' && event.filter !== 'lowpass') || !Number.isFinite(event.hz) || (event.hz as number) <= 0) {
        return 'the seam schedule has an invalid filter';
      }
    } else if (event.kind === 'send') {
      if ((event.effect !== 'echo' && event.effect !== 'wash') || !Number.isFinite(event.value) || (event.value as number) < 0 || (event.value as number) > 1) {
        return 'the seam schedule has an invalid effect send';
      }
      if (!schedule.effects?.[event.effect]) return 'the seam schedule sends to an effect it does not describe';
    } else if (event.kind !== 'start' && event.kind !== 'stop') {
      return 'the seam schedule has an unknown event';
    }
  }
  const entry = schedule.events.find((event) => event.deck === 'b' && event.kind === 'start');
  if (!entry) return 'the seam schedule never starts the next song';
  if (schedule.events.filter((event) => event.deck === 'b' && event.kind === 'start').length !== 1) {
    return 'the seam schedule starts the next song more than once';
  }
  if (!schedule.stems && Math.abs(schedule.startSeconds - entry.at) > 1e-6) return 'the seam schedule has inconsistent start timing';
  const sourceAt = entry.sourceAt ?? 0;
  if (!Number.isFinite(sourceAt) || sourceAt < 0 || sourceAt >= to.duration) return 'the seam enters the next song outside its audio';
  if (schedule.stretch && schedule.stems) return 'the seam asks for a stretched entry and a stem move at once';
  if (schedule.stretch) {
    const problem = unusableStretch(schedule.stretch, entry.at, sourceAt, to);
    if (problem) return problem;
  }
  if (schedule.stems) {
    const problem = unusableStems(schedule.stems, entry.at, sourceAt, can);
    if (problem) return problem;
  }
  const base = from.startedAt - from.offset;
  const startAt = base + firstSound(schedule, entry.at);
  const endAt = from.startedAt + (from.duration - from.offset);
  if (!(startAt > now + START_LEAD)) return 'the seam was prepared too late to start on time';
  if (from.entering && startAt < from.entering.until) return 'the seam starts before the current song has handed over from its stretched entry';
  if (!(startAt < endAt)) return 'the seam starts after the current song has ended';
  if (schedule.events.some((event) => !Number.isFinite(event.at))) return 'the seam schedule has an invalid time';
  return null;
}
