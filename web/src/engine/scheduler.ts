import {
  CROSSFADE_IMPLEMENTATION,
  FALLBACK_FADE_SECONDS,
  fadeInPoints,
  fadeOutPoints,
  GainPoint,
  SEAM_FADE_SECONDS,
} from '../dsp/crossfade';
import { applySends, canMakeEffects, makeReturns, type EffectReturn } from '../dsp/seamEffects';
import { applyMoves, canMakeMoves, makeMovesChain, type MovesChain } from '../dsp/seamMoves';
import type { SeamEvent, SeamSchedule, SeamStems, SeamStretch, StretchedClip } from '../dsp/seams';
import { warpAt, type StemLayer } from '../dsp/stemMoves/types';
import { rampSourceSeconds, stretchRefusal, type StretchRamp } from '../dsp/stretchLimits';
import type { EngineGraph } from './graph';
import type { EngineStore } from './state';

/** The playback core, modelled on player.ts's SetPlayer tick (ADR-0457, ADR-0459 Tier 1).
 *
 * Tracks play in index order with no gaps: a short tick schedules the current and the next
 * source on the sound card's own clock (context.currentTime), so a busy main thread cannot make
 * it stutter. Every transition uses the equal-power curves of dsp/crossfade.ts:
 *  - with a seam provider, the next song enters on the provider's dsp/seams.ts SeamSchedule
 *    (a beatmatched seam, or the schedule's own 3 s fade when analysis was not confident);
 *  - when a provider gives no usable schedule (none, or one whose start has passed), the
 *    fallback is a 3 s equal-power fade into the end of the current song;
 *  - with no provider at all, songs meet gaplessly with the 30 ms seam crossfade on the exact
 *    boundary, as player.ts does;
 *  - when the next song decodes too late for any of that, it fades in over 3 s rather than
 *    leaving silence (player.ts END_FADE).
 * A stretched entry (dsp/seams.ts SeamStretch) plays as the Python engine's `in_context` does:
 * B's layer gets a second source, the pre-rendered clip of B stretched to A's tempo, which starts
 * with the seam and hands over to native B with a 30 ms crossfade once it has eased back to B's
 * own tempo. Both sources feed the same move chain and fader; only native B's end tears the layer
 * down, and native B stays the layer's `source`, so the next seam analyses B's own audio.
 * A stem move (dsp/stemSchedule.ts) plays each stem as its own source with its own move chain,
 * fader and echo send: A's full mix hands to A's stems, and B's stems (already stretched onto
 * A's bars) hand to B's full mix at the plan's handover, both through the schedule's ordinary
 * gain events. The stem sources hang off B's layer, so a stop or a new start silences them with
 * it, and native B stays the layer's `source`.
 * Pause suspends the context, which freezes its clock, so position accounting stays truthful
 * through a pause. A generation counter makes every await re-check whether it still speaks for
 * the newest start; a stale continuation schedules nothing, so there are never two overlapping
 * schedules.
 */

export const SEAM_FADE = SEAM_FADE_SECONDS;
export const END_FADE = FALLBACK_FADE_SECONDS;
export const TICK_MS = 50;
/** What the player says when no song left in the mix can be opened here; a shell may draw its own banner for it. */
export const NOTHING_PLAYABLE_NOTICE = 'None of the songs left in this mix can play on this device right now. Connect your music in Library, then press Play.';
export const LOAD_NEXT_WITHIN = 45;
/** With `planAhead`, the next transition is planned once this much of a song has played. */
export const PLAN_AHEAD_AFTER = 1;
/** The first song of a start waits at most this long for its level, so Play stays quick. */
export const FIRST_LEVEL_WAIT_MS = 2500;
const START_LEAD = 0.05;

/** What loading a track by index came to. 'missing' means past the end of the list; 'failed'
 * means the file could not be resolved or decoded and is excluded from the mix (ADR-0457:
 * never silence inside a seam, never a silent substitution). */
export type LoadedTrack =
  | { kind: 'buffer'; buffer: AudioBuffer }
  | { kind: 'missing' }
  | { kind: 'failed'; error: string };

export type SchedulerTimers = {
  set(run: () => void, everyMs: number): number;
  clear(id: number): void;
};

/** What a seam provider is asked: the outgoing and incoming songs, decoded. */
export type SeamRequest = { fromIndex: number; from: AudioBuffer; toIndex: number; to: AudioBuffer };
/** Builds the dsp/seams.ts schedule for one transition (from the analysis it holds), or null
 * when it has none prepared. Times in the schedule are on the outgoing song's own timeline. */
export type SeamProvider = ((request: SeamRequest) => SeamSchedule | null | Promise<SeamSchedule | null>) & {
  /** Release provider-owned workers or other long-lived resources when its speaker ends. */
  dispose?: () => void;
};

/** Which transition actually ran, so a surface can name it honestly (ADR-0459). */
export type TransitionKind = 'seam_schedule' | 'boundary' | 'fallback_fade' | 'late_fade';
export type Transition = {
  kind: TransitionKind;
  implementation: string;
  /** The schedule's own kind, when one was used. */
  seamKind?: SeamSchedule['kind'];
  /** Why the schedule was not used, or why it fell back to a fade itself. */
  reason?: string;
};

export type SchedulerDeps = {
  graph: EngineGraph;
  store: EngineStore;
  load(index: number): Promise<LoadedTrack>;
  /** Intentional suspend (a pause), never confused with a system interruption. */
  hold(): Promise<void>;
  /** Resume within a gesture; reports whether the context actually runs. */
  wake(): Promise<boolean>;
  seam?: SeamProvider;
  timers?: SchedulerTimers;
  /** cloud.seam_lead: plan the next transition as soon as a song starts, not LOAD_NEXT_WITHIN
   * before it ends. A 16-bar blend at 120 BPM starts up to 50 s before the end, so planning at
   * 45 s left prepared many seams too late and they fell back to a 3 s fade. */
  planAhead?: () => boolean;
  /** cloud.seam_lead: the linear gain a song plays at so every song sits at one level
   * (engine/level.ts, -14 LUFS as local mode's SongInfo.gain_db). 1 when absent. */
  level?: (buffer: AudioBuffer) => Promise<number>;
};

export type SchedulerPosition = { index: number; offsetMs: number; paused: boolean };

export type Scheduler = {
  start(index: number, offsetMs: number, playing: boolean): Promise<void>;
  stop(fadeMs: number): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  position(): SchedulerPosition | null;
  playing(): boolean;
  /** The most recently planned transition, or null. */
  lastTransition(): Transition | null;
  dispose(): void;
};

/** B's stretched entry clip, its fader, and `hand`, which brings native B in at the handover. */
type Clip = { source: AudioBufferSourceNode; gain: GainNode; hand: GainNode };
/** `moves` is the seam move chain (dsp/seamMoves.ts), present when a seam provider may ask for
 * EQ or filter moves and the context can build it; neutral until a schedule moves it. */
/** One stem of a stem move: its source, move chain, fader and echo returns. */
type StemVoice = { source: AudioBufferSourceNode; gain: GainNode; moves?: MovesChain };
type Layer = { source: AudioBufferSourceNode; gain: GainNode; moves?: MovesChain; clip?: Clip; stems?: StemVoice[] };
/** While a stretched clip plays, where in the song the listener is; native B's own clock
 * (`startedAt`, `offset`) is exact from `until` on. */
type Entering = { until: number; position(now: number): number };
type Current = Layer & { index: number; startedAt: number; offset: number; duration: number; entering?: Entering };
/** `at` is when the song becomes audible; `startedAt`/`offset` are native B's own clock. */
type Planned = Layer & { index: number; at: number; startedAt: number; offset: number; duration: number; entering?: Entering };
type Entered = { at: number; startedAt: number; offset: number; entering?: Entering };

/** Write a gain point list onto a param: the first point is set, the rest ramp linearly. */
function applyPoints(param: AudioParam, points: readonly GainPoint[], base = 0): void {
  points.forEach(([at, value], index) => {
    const time = Math.max(0, base + at);
    if (index === 0) param.setValueAtTime(value, time);
    else param.linearRampToValueAtTime(value, time);
  });
}

/** The clip's ramp in its own output seconds from B's entry. */
const entryRamp = (stretch: SeamStretch, entryAt: number): StretchRamp => ({
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
function unusable(schedule: SeamSchedule, from: Current, to: AudioBuffer, now: number, can = { moves: false, effects: false }): string | null {
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

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const context = deps.graph.context;
  const timers: SchedulerTimers = deps.timers ?? {
    set: (run, everyMs) => window.setInterval(run, everyMs),
    clear: (id) => window.clearInterval(id),
  };

  let generation = 0;
  let current: Current | null = null;
  let planned: Planned | null = null;
  let planning = false;
  let atEnd = false;
  let holdWanted = false;
  let timer: number | null = null;
  let disposed = false;
  // Suspends and resumes are serialised: a pause's suspend that is still in flight when a new
  // start wakes the context would otherwise land afterwards and silence the new song.
  let holding: Promise<void> = Promise.resolve();
  const hold = (): Promise<void> => {
    const made = deps.hold();
    holding = made.catch(() => undefined);
    return made;
  };
  let transition: Transition | null = null;
  const layers = new Set<Layer>();
  // echo and wash returns, by the source that feeds them: a tail rings on after its song stops
  const tails = new Map<AudioBufferSourceNode, EffectReturn[]>();
  // tails still ringing after their song stopped; a pause or stop silences them at once
  const ringing = new Set<EffectReturn>();
  const letRing = (source: AudioBufferSourceNode) => {
    const returns = tails.get(source);
    if (!returns) return;
    tails.delete(source);
    for (const made of returns) {
      ringing.add(made);
      globalThis.setTimeout(() => { if (ringing.delete(made)) made.dispose(); }, Math.ceil(made.tailSeconds * 1000) + 100);
    }
  };
  const cutTails = (source: AudioBufferSourceNode) => {
    for (const made of tails.get(source) ?? []) made.dispose();
    tails.delete(source);
  };

  const layer = (buffer: AudioBuffer, index: number, level = 1): Layer => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    const moves = deps.seam && canMakeMoves(context) ? makeMovesChain(context) : undefined;
    if (moves) {
      source.connect(moves.input);
      moves.output.connect(gain);
    } else {
      source.connect(gain);
    }
    // the song's own level sits after its fader, so seam gain curves keep meaning 0 to 1
    const levelled = level !== 1 && Number.isFinite(level) && level > 0 ? context.createGain() : null;
    if (levelled) {
      levelled.gain.value = level;
      gain.connect(levelled);
      levelled.connect(index % 2 === 0 ? deps.graph.deckA : deps.graph.deckB);
    } else {
      gain.connect(index % 2 === 0 ? deps.graph.deckA : deps.graph.deckB);
    }
    const made: Layer = { source, gain, moves };
    layers.add(made);
    source.onended = () => {
      letRing(source);
      source.disconnect();
      dropClip(made);
      dropStems(made);
      moves?.dispose();
      gain.disconnect();
      levelled?.disconnect();
      layers.delete(made);
    };
    return made;
  };

  const stopSource = (source: AudioBufferSourceNode, when?: number) => {
    try {
      source.stop(when);
    } catch {
      // a source that has not started cannot be stopped, and that is fine
    }
  };

  /** Give B's layer its stretched entry: the clip and native B both feed the move chain. */
  const addClip = (made: Layer, clip: StretchedClip): Clip => {
    const buffer = context.createBuffer(clip.channels.length, clip.channels[0].length, clip.sampleRate);
    clip.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
    const into = made.moves?.input ?? made.gain;
    const hand = context.createGain();
    made.source.disconnect();
    made.source.connect(hand);
    hand.connect(into);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(into);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    made.clip = { source, gain, hand };
    return made.clip;
  };

  const dropClip = (made: Layer) => {
    if (!made.clip) return;
    stopSource(made.clip.source);
    made.clip.source.disconnect();
    made.clip.gain.disconnect();
    made.clip.hand.disconnect();
    made.clip = undefined;
  };

  const dropStems = (made: Layer) => {
    for (const voice of made.stems ?? []) {
      stopSource(voice.source);
      cutTails(voice.source);
      voice.source.disconnect();
      voice.moves?.dispose();
      voice.gain.disconnect();
    }
    made.stems = undefined;
  };

  /** Build every stem's audio up front, so a failure falls back before anything is scheduled. */
  const stemAudio = (stems: SeamStems): Map<StemLayer, AudioBuffer> => {
    const made = new Map<StemLayer, AudioBuffer>();
    const buffers = stems.buffers!;
    for (const layer of stems.plan.layers) {
      const channels = (layer.side === 'a' ? buffers.a : buffers.b).stems[layer.stem]!;
      const audio = context.createBuffer(channels.length, channels[0].length, buffers.sampleRate);
      channels.forEach((channel, index) => audio.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
      made.set(layer, audio);
    }
    return made;
  };

  /** Start every stem of a stem move on its own chain, A's into A's deck, B's into B's. */
  const playStems = (made: Layer, stems: SeamStems, audio: Map<StemLayer, AudioBuffer>, base: number, outs: { a: AudioNode; b: AudioNode }) => {
    const { plan, buffers } = stems;
    const nyquist = context.sampleRate / 2;
    made.stems = plan.layers.map((layer) => {
      const source = context.createBufferSource();
      source.buffer = audio.get(layer) as AudioBuffer;
      const shaped = layer.eq?.length || layer.filter?.length || layer.sends?.length;
      const moves = shaped && canMakeMoves(context) ? makeMovesChain(context) : undefined;
      const gain = context.createGain();
      if (moves) {
        source.connect(moves.input);
        moves.output.connect(gain);
      } else {
        source.connect(gain);
      }
      const out = outs[layer.side];
      gain.connect(out);
      const deck = layer.side;
      if (moves) {
        const events: SeamEvent[] = [
          ...(layer.eq ?? []).flatMap((eq) => eq.points.map(([at, value]) => ({ deck, kind: 'eq' as const, band: eq.band, at, value }))),
          ...(layer.filter ?? []).flatMap((sweep) => sweep.points.map(([at, hz]) => ({ deck, kind: 'filter' as const, filter: sweep.filter, at, hz }))),
        ];
        applyMoves(moves, events, base, nyquist);
        if (layer.sends?.length && plan.echo && canMakeEffects(context)) {
          const returns = makeReturns(context, moves.output, out, { echo: plan.echo });
          tails.set(source, returns);
          const sends = layer.sends.flatMap((send) => send.points.map(([at, value]) => ({ deck, kind: 'send' as const, effect: 'echo' as const, at, value })));
          for (const made of returns) applySends(made, sends, base);
        }
      }
      // silent until its first point, whatever lies between the source's start and that point
      gain.gain.setValueAtTime(layer.gain[0][1], Math.max(0, base + Math.min(layer.from, layer.gain[0][0])));
      applyPoints(gain.gain, layer.gain, base);
      const offset = layer.side === 'a' ? layer.sourceFrom - buffers!.a.origin : layer.from - buffers!.b.at;
      source.start(Math.max(0, base + layer.from), Math.max(0, offset));
      stopSource(source, base + layer.until);
      source.onended = () => {
        letRing(source);
        source.disconnect();
        moves?.dispose();
        gain.disconnect();
      };
      return { source, gain, moves };
    });
  };

  const stopAt = (made: Layer, when: number) => {
    stopSource(made.source, when);
    if (made.clip) stopSource(made.clip.source, when);
    for (const voice of made.stems ?? []) stopSource(voice.source, when);
  };

  const silence = (made: Layer) => {
    made.gain.gain.cancelScheduledValues(context.currentTime);
    stopSource(made.source);
    cutTails(made.source);
    made.source.disconnect();
    dropClip(made);
    dropStems(made);
    made.moves?.dispose();
    made.gain.disconnect();
    layers.delete(made);
  };

  const silenceAll = () => {
    for (const made of [...layers]) silence(made);
    for (const made of ringing) made.dispose();
    ringing.clear();
    current = null;
    planned = null;
    atEnd = false;
  };

  const stopTimer = () => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  };

  const startTimer = () => {
    if (timer === null) timer = timers.set(tick, TICK_MS);
  };

  const songTime = (): number => {
    if (!current) return 0;
    const now = context.currentTime;
    const played = current.entering && now < current.entering.until
      ? current.entering.position(now)
      : current.offset + Math.max(0, now - current.startedAt);
    return Math.min(played, current.duration);
  };

  /** Apply a validated schedule: 'a' is the current song, 'b' the entering one. */
  const applySchedule = (schedule: SeamSchedule, from: Current, made: Layer, bOut: AudioNode, audio?: Map<StemLayer, AudioBuffer>): Entered => {
    const base = from.startedAt - from.offset;
    const byDeck = (deck: SeamEvent['deck']) => schedule.events
      .filter((event) => event.deck === deck && event.kind === 'gain' && event.value !== undefined)
      .sort((left, right) => left.at - right.at)
      .map((event) => [event.at, event.value as number] as const);
    applyPoints(from.gain.gain, byDeck('a'), base);
    applyPoints(made.gain.gain, byDeck('b'), base);
    // EQ and filter moves; the scripter only sends them to a device whose roster has the chain
    const nyquist = context.sampleRate / 2;
    if (from.moves) applyMoves(from.moves, schedule.events.filter((event) => event.deck === 'a'), base, nyquist);
    if (made.moves) applyMoves(made.moves, schedule.events.filter((event) => event.deck === 'b'), base, nyquist);
    // echo and wash: the returns hang off A's moves and come back past its fader, so the tail
    // outlives the fade; the scripter only sends effects to a device whose roster has them
    if (schedule.effects && from.moves && canMakeEffects(context)) {
      const out = from.index % 2 === 0 ? deps.graph.deckA : deps.graph.deckB;
      const returns = makeReturns(context, from.moves.output, out, schedule.effects);
      tails.set(from.source, [...(tails.get(from.source) ?? []), ...returns]);
      for (const made of returns) {
        applySends(made, schedule.events.filter((event) => event.deck === 'a' && event.kind === 'send' && event.effect === made.effect), base);
      }
    }
    let entered: Entered = { at: base, startedAt: base, offset: 0 };
    for (const event of schedule.events) {
      if (event.kind === 'start' && event.deck === 'b') {
        const at = base + event.at;
        const stretch = schedule.stretch;
        if (stretch?.clip && made.clip) {
          entered = enterStretched(made, stretch, stretch.clip, at, base, event.at);
        } else {
          entered = { at, startedAt: at, offset: event.sourceAt ?? 0 };
          made.source.start(at, entered.offset);
        }
      } else if (event.kind === 'stop' && event.deck === 'a') {
        stopAt(from, base + event.at + 0.02);
      }
    }
    if (schedule.stems && audio) {
      const { plan } = schedule.stems;
      const aOut = from.index % 2 === 0 ? deps.graph.deckA : deps.graph.deckB;
      playStems(made, schedule.stems, audio, base, { a: aOut, b: bOut });
      // the next song is audible from its first stem; its own clock runs from the handover
      const heard = Math.min(...plan.layers.filter((layer) => layer.side === 'b').map((layer) => layer.from));
      return {
        ...entered,
        at: base + Math.min(heard, plan.handoverToNative.startAt),
        entering: { until: entered.startedAt, position: (now) => warpAt(plan.bWarp, now - base) },
      };
    }
    return entered;
  };

  /** Start B as its stretched clip at `at`, and native B under it 30 ms before the handover,
   * crossfading linearly: both hold the same audio there (render/engine.py `in_context`). */
  const enterStretched = (made: Layer, stretch: SeamStretch, prepared: StretchedClip, at: number, base: number, entryAt: number): Entered => {
    const clip = made.clip as Clip;
    const handAt = base + stretch.handoverAt;
    const crossAt = handAt - SEAM_FADE;
    clip.source.start(at, prepared.skipSeconds);
    clip.gain.gain.setValueAtTime(1, at);
    clip.gain.gain.setValueAtTime(1, crossAt);
    clip.gain.gain.linearRampToValueAtTime(0, handAt);
    clip.hand.gain.setValueAtTime(0, at);
    clip.hand.gain.setValueAtTime(0, crossAt);
    clip.hand.gain.linearRampToValueAtTime(1, handAt);
    stopSource(clip.source, handAt + 0.02);
    made.source.start(crossAt, stretch.handoverSourceAt - SEAM_FADE);
    const ramp = entryRamp(stretch, entryAt);
    return {
      at,
      startedAt: handAt,
      offset: stretch.handoverSourceAt,
      entering: { until: handAt, position: (now) => stretch.sourceFrom + rampSourceSeconds(ramp, now - at) },
    };
  };

  /** A 3 s equal-power crossfade that ends with the current song, or starts now if that is
   * already too close. */
  const fadeInto = (from: Current, made: Layer, buffer: AudioBuffer, now: number): Entered => {
    const endAt = from.startedAt + (from.duration - from.offset);
    const at = Math.max(now + START_LEAD, endAt - END_FADE);
    const fadeEnd = at + Math.min(END_FADE, buffer.duration / 2);
    applyPoints(made.gain.gain, fadeInPoints(at, fadeEnd));
    made.source.start(at);
    if (endAt > at) {
      applyPoints(from.gain.gain, fadeOutPoints(at, Math.min(fadeEnd, endAt)));
      stopAt(from, Math.min(fadeEnd, endAt) + 0.02);
    }
    return { at, startedAt: at, offset: 0 };
  };

  /** The level a song plays at; 1 when none is measured, it fails, or it takes too long. */
  const levelOf = async (buffer: AudioBuffer, withinMs?: number): Promise<number> => {
    if (!deps.level) return 1;
    const measured = deps.level(buffer).catch(() => 1);
    if (withinMs === undefined) return measured;
    return Promise.race([measured, new Promise<number>((resolve) => setTimeout(() => resolve(1), withinMs))]);
  };

  /** Prepare the next song and schedule its entrance; a stale generation does nothing. */
  async function plan(nextIndex: number, mine: number): Promise<void> {
    planning = true;
    try {
      const loaded = await deps.load(nextIndex);
      if (mine !== generation || disposed || !current || planned) return;
      if (loaded.kind === 'missing') {
        atEnd = true;
        return;
      }
      if (loaded.kind === 'failed') {
        deps.store.set({ notice: 'The next song could not be read or is not on this device, so SelectaDJ will skip it.' });
        return plan(nextIndex + 1, mine);
      }
      const buffer = loaded.buffer;
      const level = await levelOf(buffer);
      if (mine !== generation || disposed || !current || planned) return;
      let schedule: SeamSchedule | null = null;
      let providerReason: string | undefined;
      if (deps.seam) {
        try {
          schedule = await deps.seam({ fromIndex: current.index, from: current.source.buffer as AudioBuffer, toIndex: nextIndex, to: buffer });
        } catch (error) {
          providerReason = `the seam could not be prepared: ${(error as Error | null)?.message || 'unknown reason'}`;
        }
        if (mine !== generation || disposed || !current || planned) return;
      }
      const from = current;
      const now = context.currentTime;
      const endAt = from.startedAt + (from.duration - from.offset);
      const seamAt = endAt - SEAM_FADE;
      const made = layer(buffer, nextIndex, level);
      let entered: Entered;
      let problem = schedule ? unusable(schedule, from, buffer, now, { moves: canMakeMoves(context), effects: canMakeEffects(context) }) : null;
      let audio: Map<StemLayer, AudioBuffer> | undefined;
      if (schedule?.stems && !problem && seamAt > now + START_LEAD) {
        try {
          audio = stemAudio(schedule.stems);
        } catch (error) {
          problem = `the stems could not be loaded into audio: ${(error as Error | null)?.message || 'unknown reason'}`;
        }
      }
      if (schedule?.stretch?.clip && !problem && seamAt > now + START_LEAD) {
        try {
          addClip(made, schedule.stretch.clip);
        } catch (error) {
          problem = `the stretched entry could not be loaded into audio: ${(error as Error | null)?.message || 'unknown reason'}`;
        }
      }
      if (seamAt <= now + START_LEAD) {
        // Decoded too late for the boundary: fade in rather than leave a gap or jump-cut.
        const at = now + START_LEAD;
        applyPoints(made.gain.gain, fadeInPoints(at, at + Math.min(END_FADE, buffer.duration / 2)));
        made.source.start(at);
        entered = { at, startedAt: at, offset: 0 };
        transition = { kind: 'late_fade', implementation: CROSSFADE_IMPLEMENTATION, reason: 'the next song was ready too late for a seam' };
      } else if (schedule && !problem) {
        entered = applySchedule(schedule, from, made, nextIndex % 2 === 0 ? deps.graph.deckA : deps.graph.deckB, audio);
        transition = { kind: 'seam_schedule', implementation: schedule.implementation, seamKind: schedule.kind, reason: schedule.reason };
      } else if (deps.seam) {
        entered = fadeInto(from, made, buffer, now);
        transition = {
          kind: 'fallback_fade',
          implementation: CROSSFADE_IMPLEMENTATION,
          reason: problem ?? providerReason ?? 'no seam was prepared for this transition',
        };
      } else {
        // Gapless: the 30 ms equal-power crossfade on the exact boundary sample.
        applyPoints(made.gain.gain, fadeInPoints(seamAt, seamAt + SEAM_FADE));
        made.source.start(seamAt);
        applyPoints(from.gain.gain, fadeOutPoints(seamAt, seamAt + SEAM_FADE));
        stopAt(from, seamAt + SEAM_FADE + 0.02);
        entered = { at: seamAt, startedAt: seamAt, offset: 0 };
        transition = { kind: 'boundary', implementation: CROSSFADE_IMPLEMENTATION };
      }
      planned = { ...made, index: nextIndex, ...entered, duration: buffer.duration };
    } finally {
      planning = false;
    }
  }

  function tick() {
    if (!current || deps.store.get().phase !== 'playing') return;
    const now = context.currentTime;
    if (planned && now >= planned.at) {
      current = {
        source: planned.source,
        gain: planned.gain,
        moves: planned.moves,
        clip: planned.clip,
        index: planned.index,
        startedAt: planned.startedAt,
        offset: planned.offset,
        duration: planned.duration,
        entering: planned.entering,
      };
      planned = null;
    }
    const left = current.duration - songTime();
    const ahead = deps.planAhead?.() === true && songTime() >= PLAN_AHEAD_AFTER;
    if (!planned && !planning && !atEnd && (left < LOAD_NEXT_WITHIN || ahead)) {
      void plan(current.index + 1, generation);
    }
    if (!planned && atEnd && now > current.startedAt + (current.duration - current.offset)) {
      silenceAll();
      stopTimer();
      deps.store.set({ phase: 'idle', notice: '' });
    }
  }

  /** Begin a track; `mine` ties every await back to the start that asked. */
  async function begin(index: number, offsetMs: number, playing: boolean, mine: number, clearNotice = true): Promise<void> {
    deps.store.set(clearNotice ? { phase: 'loading', notice: '' } : { phase: 'loading' });
    if (playing) {
      await holding;
      if (mine !== generation || disposed) return;
      const woken = await deps.wake();
      if (mine !== generation || disposed) return;
      if (!woken) {
        deps.store.set({ phase: 'idle', notice: 'Your browser is holding the sound back. Press play to start.' });
        return;
      }
    }
    const loaded = await deps.load(index);
    if (mine !== generation || disposed) return;
    if (loaded.kind === 'missing') {
      // reached by skipping songs this device can't play: say so, rather than stop in silence
      deps.store.set(clearNotice
        ? { phase: 'idle', notice: '' }
        : { phase: 'idle', notice: NOTHING_PLAYABLE_NOTICE });
      return;
    }
    if (loaded.kind === 'failed') {
      deps.store.set({ notice: 'That song could not be read or is not on this device, so SelectaDJ skipped it.' });
      return begin(index + 1, 0, playing, mine, false);
    }
    // A pause asked for while loading wins over the start's own wish to play.
    const sounding = playing && !holdWanted;
    if (!sounding) {
      // Hold before scheduling, so not even the start lead can sound before the pause lands.
      await hold();
      if (mine !== generation || disposed) return;
    }
    const buffer = loaded.buffer;
    const level = await levelOf(buffer, FIRST_LEVEL_WAIT_MS);
    if (mine !== generation || disposed) return;
    const offset = Math.min(Math.max(offsetMs / 1000, 0), Math.max(buffer.duration - 0.05, 0));
    const made = layer(buffer, index, level);
    const startedAt = context.currentTime + START_LEAD;
    made.gain.gain.setValueAtTime(1, startedAt);
    made.source.start(startedAt, offset);
    current = { ...made, index, startedAt, offset, duration: buffer.duration };
    atEnd = false;
    holdWanted = false;
    if (sounding) {
      deps.store.set({ phase: 'playing' });
      startTimer();
      tick();
    } else {
      deps.store.set({ phase: 'paused' });
    }
  }

  return {
    async start(index, offsetMs, playing) {
      if (disposed) return;
      generation += 1;
      holdWanted = false;
      silenceAll();
      await begin(index, offsetMs, playing, generation);
    },
    stop(fadeMs) {
      generation += 1;
      holdWanted = false;
      stopTimer();
      const fade = Math.max(0, fadeMs) / 1000;
      if (fade > 0 && context.state === 'running') {
        // Forget the songs now, not when the fade ends: a device that lost the lease never cuts
        // off mid-note, and never keeps playing under the new speaker (mirrors audioSpeaker.ts).
        const now = context.currentTime;
        for (const made of [...layers]) {
          made.gain.gain.cancelScheduledValues(now);
          made.gain.gain.setValueAtTime(made.gain.gain.value, now);
          made.gain.gain.linearRampToValueAtTime(0, now + fade);
          for (const voice of made.stems ?? []) {
            voice.gain.gain.cancelScheduledValues(now);
            voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
            voice.gain.gain.linearRampToValueAtTime(0, now + fade);
          }
          stopAt(made, now + fade + 0.02);
          layers.delete(made);
        }
        current = null;
        planned = null;
        atEnd = false;
      } else {
        silenceAll();
      }
      if (deps.store.get().phase !== 'idle') deps.store.set({ phase: 'idle' });
    },
    async pause() {
      if (disposed) return;
      const phase = deps.store.get().phase;
      if (phase === 'loading') {
        holdWanted = true;
        return;
      }
      if (phase !== 'playing') return;
      const mine = generation;
      await hold();
      // A start or stop that landed during the suspend owns the state now.
      if (mine !== generation || disposed) return;
      deps.store.set({ phase: 'paused' });
    },
    async resume() {
      if (disposed) return;
      const phase = deps.store.get().phase;
      if (phase === 'loading') {
        holdWanted = false;
        return;
      }
      if (phase !== 'paused' || !current) return;
      const mine = generation;
      await holding;
      if (mine !== generation || disposed) return;
      const woken = await deps.wake();
      if (mine !== generation || disposed) return;
      if (woken) {
        deps.store.set({ phase: 'playing', notice: '' });
        startTimer();
        tick();
      } else {
        deps.store.set({ notice: 'Your browser is holding the sound back. Press play to carry on.' });
      }
    },
    position() {
      if (disposed || !current) return null;
      const phase = deps.store.get().phase;
      if (phase !== 'playing' && phase !== 'paused') return null;
      return { index: current.index, offsetMs: Math.round(songTime() * 1000), paused: phase === 'paused' };
    },
    playing() {
      return !disposed && deps.store.get().phase === 'playing';
    },
    lastTransition() {
      return transition ? { ...transition } : null;
    },
    dispose() {
      if (disposed) return;
      generation += 1;
      stopTimer();
      silenceAll();
      disposed = true;
      try {
        deps.seam?.dispose?.();
      } catch {
        // Resource cleanup must not prevent the audio graph from being released.
      }
    },
  };
}
