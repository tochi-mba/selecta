import type { EngineGraph } from './graph';
import type { EngineStore } from './state';

/** The playback core, modelled on player.ts's SetPlayer tick (ADR-0457).
 *
 * Tracks play in index order with no gaps: a short tick schedules the current and the next
 * source on the sound card's own clock (context.currentTime), so a busy main thread cannot make
 * it stutter. When the next song decodes in time, the seam is a 30 ms crossfade on the exact
 * boundary; when it arrives late, it fades in over 3 s rather than leaving silence (the same
 * SEAM_FADE and END_FADE as player.ts). Pause suspends the context, which freezes its clock, so
 * position accounting stays truthful through a pause. A generation counter makes every await
 * re-check whether it still speaks for the newest start; a stale continuation schedules nothing,
 * so there are never two overlapping schedules.
 */

export const SEAM_FADE = 0.03;
export const END_FADE = 3;
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

export type SchedulerDeps = {
  graph: EngineGraph;
  store: EngineStore;
  load(index: number): Promise<LoadedTrack>;
  /** Intentional suspend (a pause), never confused with a system interruption. */
  hold(): Promise<void>;
  /** Resume within a gesture; reports whether the context actually runs. */
  wake(): Promise<boolean>;
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
  dispose(): void;
};

type Layer = { source: AudioBufferSourceNode; gain: GainNode };
type Current = Layer & { index: number; startedAt: number; offset: number; duration: number };
type Planned = Layer & { index: number; at: number; offset: number; duration: number };

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
  let timer: number | null = null;
  let disposed = false;
  const layers = new Set<Layer>();

  const layer = (buffer: AudioBuffer, index: number): Layer => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(index % 2 === 0 ? deps.graph.deckA : deps.graph.deckB);
    const made = { source, gain };
    layers.add(made);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      layers.delete(made);
    };
    return made;
  };

  const silence = (made: Layer) => {
    made.gain.gain.cancelScheduledValues(context.currentTime);
    try {
      made.source.stop();
    } catch {
      // a layer that has not started cannot be stopped, and that is fine
    }
    made.source.disconnect();
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
        deps.store.set({ notice: 'The next song could not be read, so SelectaDJ will skip it.' });
        return plan(nextIndex + 1, mine);
      }
      const buffer = loaded.buffer;
      const now = context.currentTime;
      const endAt = current.startedAt + (current.duration - current.offset);
      const seamAt = endAt - SEAM_FADE;
      const made = layer(buffer, nextIndex);
      if (seamAt > now + START_LEAD) {
        // Ready in time: a 30 ms crossfade on the exact boundary sample.
        made.gain.gain.setValueAtTime(0, seamAt);
        made.gain.gain.linearRampToValueAtTime(1, seamAt + SEAM_FADE);
        made.source.start(seamAt);
        current.gain.gain.setValueAtTime(1, seamAt);
        current.gain.gain.linearRampToValueAtTime(0, seamAt + SEAM_FADE);
        current.source.stop(seamAt + SEAM_FADE + 0.02);
        planned = { ...made, index: nextIndex, at: seamAt, offset: 0, duration: buffer.duration };
      } else {
        // Decoded too late for the boundary: fade in rather than leave a gap or jump-cut.
        const at = now + START_LEAD;
        made.gain.gain.setValueAtTime(0, at);
        made.gain.gain.linearRampToValueAtTime(1, at + Math.min(END_FADE, buffer.duration / 2));
        made.source.start(at);
        planned = { ...made, index: nextIndex, at, offset: 0, duration: buffer.duration };
      }
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
  async function begin(index: number, offsetMs: number, playing: boolean, mine: number): Promise<void> {
    deps.store.set({ phase: 'loading', notice: '' });
    if (playing) {
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
      deps.store.set({ notice: 'That song could not be read, so SelectaDJ skipped it.' });
      return begin(index + 1, 0, playing, mine);
    }
    const buffer = loaded.buffer;
    const offset = Math.min(Math.max(offsetMs / 1000, 0), Math.max(buffer.duration - 0.05, 0));
    const made = layer(buffer, index);
    const startedAt = context.currentTime + START_LEAD;
    made.gain.gain.setValueAtTime(1, startedAt);
    made.source.start(startedAt, offset);
    current = { ...made, index, startedAt, offset, duration: buffer.duration };
    atEnd = false;
    if (playing) {
      deps.store.set({ phase: 'playing' });
      startTimer();
      tick();
    } else {
      await deps.hold();
      if (mine !== generation || disposed) return;
      deps.store.set({ phase: 'paused' });
    }
  }

  return {
    async start(index, offsetMs, playing) {
      if (disposed) return;
      generation += 1;
      silenceAll();
      await begin(index, offsetMs, playing, generation);
    },
    stop(fadeMs) {
      generation += 1;
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
          try {
            made.source.stop(now + fade + 0.02);
          } catch {
            // a layer that has not started cannot be stopped
          }
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
      if (disposed || deps.store.get().phase !== 'playing') return;
      await deps.hold();
      deps.store.set({ phase: 'paused' });
    },
    async resume() {
      if (disposed || deps.store.get().phase !== 'paused') return;
      if (await deps.wake()) {
        deps.store.set({ phase: 'playing', notice: '' });
        startTimer();
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
    dispose() {
      if (disposed) return;
      generation += 1;
      stopTimer();
      silenceAll();
      disposed = true;
    },
  };
}
