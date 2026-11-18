import {
  CROSSFADE_IMPLEMENTATION,
  FALLBACK_FADE_SECONDS,
  fadeInPoints,
  fadeOutPoints,
  GainPoint,
  SEAM_FADE_SECONDS,
} from '../dsp/crossfade';
import { applyMoves, canMakeMoves, makeMovesChain, type MovesChain } from '../dsp/seamMoves';
import type { SeamEvent, SeamSchedule } from '../dsp/seams';
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
 * Pause suspends the context, which freezes its clock, so position accounting stays truthful
 * through a pause. A generation counter makes every await re-check whether it still speaks for
 * the newest start; a stale continuation schedules nothing, so there are never two overlapping
 * schedules.
 */

export const SEAM_FADE = SEAM_FADE_SECONDS;
export const END_FADE = FALLBACK_FADE_SECONDS;
export const TICK_MS = 50;
export const LOAD_NEXT_WITHIN = 45;
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
export type SeamProvider = (request: SeamRequest) => SeamSchedule | null | Promise<SeamSchedule | null>;

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

/** `moves` is the seam move chain (dsp/seamMoves.ts), present when a seam provider may ask for
 * EQ or filter moves and the context can build it; neutral until a schedule moves it. */
type Layer = { source: AudioBufferSourceNode; gain: GainNode; moves?: MovesChain };
type Current = Layer & { index: number; startedAt: number; offset: number; duration: number };
type Planned = Layer & { index: number; at: number; offset: number; duration: number };

/** Write a gain point list onto a param: the first point is set, the rest ramp linearly. */
function applyPoints(param: AudioParam, points: readonly GainPoint[], base = 0): void {
  points.forEach(([at, value], index) => {
    const time = Math.max(0, base + at);
    if (index === 0) param.setValueAtTime(value, time);
    else param.linearRampToValueAtTime(value, time);
  });
}

/** Check a schedule against the songs it joins; a reason when it cannot be used as given. */
function unusable(schedule: SeamSchedule, from: Current, to: AudioBuffer, now: number): string | null {
  const entry = schedule.events.find((event) => event.deck === 'b' && event.kind === 'start');
  if (!entry) return 'the seam schedule never starts the next song';
  const sourceAt = entry.sourceAt ?? 0;
  if (!(sourceAt >= 0) || sourceAt >= to.duration) return 'the seam enters the next song outside its audio';
  const base = from.startedAt - from.offset;
  const startAt = base + entry.at;
  const endAt = from.startedAt + (from.duration - from.offset);
  if (!(startAt > now + START_LEAD)) return 'the seam was prepared too late to start on time';
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

  const layer = (buffer: AudioBuffer, index: number): Layer => {
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
    gain.connect(index % 2 === 0 ? deps.graph.deckA : deps.graph.deckB);
    const made: Layer = { source, gain, moves };
    layers.add(made);
    source.onended = () => {
      source.disconnect();
      moves?.dispose();
      gain.disconnect();
      layers.delete(made);
    };
    return made;
  };

  const stopAt = (made: Layer, when: number) => {
    try {
      made.source.stop(when);
    } catch {
      // a layer that has not started cannot be stopped, and that is fine
    }
  };

  const silence = (made: Layer) => {
    made.gain.gain.cancelScheduledValues(context.currentTime);
    try {
      made.source.stop();
    } catch {
      // a layer that has not started cannot be stopped, and that is fine
    }
    made.source.disconnect();
    made.moves?.dispose();
    made.gain.disconnect();
    layers.delete(made);
  };

  const silenceAll = () => {
    for (const made of [...layers]) silence(made);
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
    const played = current.offset + Math.max(0, context.currentTime - current.startedAt);
    return Math.min(played, current.duration);
  };

  /** Apply a validated schedule: 'a' is the current song, 'b' the entering one. */
  const applySchedule = (schedule: SeamSchedule, from: Current, made: Layer): { at: number; offset: number } => {
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
    let entered = { at: base, offset: 0 };
    for (const event of schedule.events) {
      if (event.kind === 'start' && event.deck === 'b') {
        entered = { at: base + event.at, offset: event.sourceAt ?? 0 };
        made.source.start(entered.at, entered.offset);
      } else if (event.kind === 'stop' && event.deck === 'a') {
        stopAt(from, base + event.at + 0.02);
      }
    }
    return entered;
  };

  /** A 3 s equal-power crossfade that ends with the current song, or starts now if that is
   * already too close. */
  const fadeInto = (from: Current, made: Layer, buffer: AudioBuffer, now: number): { at: number; offset: number } => {
    const endAt = from.startedAt + (from.duration - from.offset);
    const at = Math.max(now + START_LEAD, endAt - END_FADE);
    const fadeEnd = at + Math.min(END_FADE, buffer.duration / 2);
    applyPoints(made.gain.gain, fadeInPoints(at, fadeEnd));
    made.source.start(at);
    if (endAt > at) {
      applyPoints(from.gain.gain, fadeOutPoints(at, Math.min(fadeEnd, endAt)));
      stopAt(from, Math.min(fadeEnd, endAt) + 0.02);
    }
    return { at, offset: 0 };
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
      const made = layer(buffer, nextIndex);
      let entered: { at: number; offset: number };
      const problem = schedule ? unusable(schedule, from, buffer, now) : null;
      if (seamAt <= now + START_LEAD) {
        // Decoded too late for the boundary: fade in rather than leave a gap or jump-cut.
        const at = now + START_LEAD;
        applyPoints(made.gain.gain, fadeInPoints(at, at + Math.min(END_FADE, buffer.duration / 2)));
        made.source.start(at);
        entered = { at, offset: 0 };
        transition = { kind: 'late_fade', implementation: CROSSFADE_IMPLEMENTATION, reason: 'the next song was ready too late for a seam' };
      } else if (schedule && !problem) {
        entered = applySchedule(schedule, from, made);
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
        entered = { at: seamAt, offset: 0 };
        transition = { kind: 'boundary', implementation: CROSSFADE_IMPLEMENTATION };
      }
      planned = { ...made, index: nextIndex, at: entered.at, offset: entered.offset, duration: buffer.duration };
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
        index: planned.index,
        startedAt: planned.at,
        offset: planned.offset,
        duration: planned.duration,
      };
      planned = null;
    }
    const left = current.duration - songTime();
    if (!planned && !planning && !atEnd && left < LOAD_NEXT_WITHIN) {
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
      deps.store.set({ phase: 'idle', notice: '' });
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
    const offset = Math.min(Math.max(offsetMs / 1000, 0), Math.max(buffer.duration - 0.05, 0));
    const made = layer(buffer, index);
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
    },
  };
}
