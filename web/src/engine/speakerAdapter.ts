import type { Position, Speaker } from '../devices/usePlaybackDevice';
import type { ResolvedTrack } from '../media/resolve';
import { buildGraph, EngineGraph } from './graph';
import { installLimiter, InstallLimiterOptions, LimiterInstall } from './limiter';
import { createLoader, Loader } from './loader';
import type { ProbeResult } from './probe';
import { createScheduler, LoadedTrack, Scheduler, SchedulerTimers, SeamProvider, Transition } from './scheduler';
import { createEngineStore, EngineState, EngineStore, UnsupportedHere } from './state';

/** The browser engine as an ADR-0415 playback device (ADR-0457, BF-0457-05).
 *
 * BrowserSpeaker implements the Speaker interface that usePlaybackDevice drives, so Rooms,
 * remote control and take-over treat this engine like any other speaker. It never finds its own
 * audio: the media layer injects `resolve(index)` (media/resolve.ts `resolveByIndex` over a
 * `MediaResolver`), which answers with a ResolvedTrack or null. The media contract's null means
 * "not available on this device right now", and resolveByIndex also answers null past the end of
 * the programme, so the speaker needs `queueLength` to tell the two apart: inside the queue a
 * null is an unavailable song that is skipped with a notice (ADR-0458: no silent skip), past it
 * the set has ended. A failed capability probe means start() refuses with the recorded reason
 * instead of pretending (ADR-0460); position() answers from the audio clock minus the limiter's
 * lookahead, so it names what is coming out now; active() is false after dispose or after the
 * lease is lost (stop).
 */

/** The engine's view of a resolved song. media/resolve.ts ResolvedTrack must stay assignable
 * to it (checked in speakerAdapter.test.ts). */
export type TrackSource = {
  id: number | string;
  /** Read the file's bytes; called at most once per decode, results cached by id. */
  data: () => Promise<ArrayBuffer>;
};
export type ResolveTrack = (index: number) => Promise<TrackSource | ResolvedTrack | null>;

/** The slice of an EngineContext the speaker needs (context.ts makes one from a gesture). */
export type SpeakerAudio = {
  context: AudioContext;
  wake(): Promise<boolean>;
  hold(): Promise<void>;
};

export type BrowserSpeakerOptions = {
  audio: SpeakerAudio;
  probe: ProbeResult;
  resolve: ResolveTrack;
  /** How many songs the programme holds. Without it a null from resolve ends the set, which is
   * only right for resolvers that never answer null for an unavailable song. */
  queueLength?: () => number;
  /** Builds dsp/seams.ts schedules for transitions; gapless boundaries without one. */
  seam?: SeamProvider;
  store?: EngineStore;
  /** How many decoded songs to keep in memory (loader.ts, default 3). */
  keep?: number;
  /** A ready-made graph, mainly for tests; built on the context otherwise. */
  graph?: EngineGraph;
  /** Overrides for installing the worklet limiter (tests inject fakes). */
  limiter?: Omit<InstallLimiterOptions, 'probe'>;
  timers?: SchedulerTimers;
};

export class BrowserSpeaker implements Speaker {
  private disposed = false;
  private readonly refused: UnsupportedHere | null;
  private readonly store: EngineStore;
  private readonly graph: EngineGraph;
  private readonly loader: Loader;
  private readonly scheduler: Scheduler;
  private readonly resolve: ResolveTrack;
  private readonly queueLength: (() => number) | null;
  private readonly limiterReady: Promise<LimiterInstall>;
  private limiterInstalled: LimiterInstall | null = null;

  constructor(options: BrowserSpeakerOptions) {
    this.store = options.store ?? createEngineStore();
    this.refused = options.probe.ok ? null : { state: 'unsupported_here', reason: options.probe.reason };
    this.resolve = options.resolve;
    this.queueLength = options.queueLength ?? null;
    this.graph = options.graph ?? buildGraph(options.audio.context);
    const context = options.audio.context;
    this.loader = createLoader((bytes) => context.decodeAudioData(bytes), { keep: options.keep });
    this.scheduler = createScheduler({
      graph: this.graph,
      store: this.store,
      load: (index) => this.loadTrack(index),
      hold: () => options.audio.hold(),
      wake: () => options.audio.wake(),
      seam: options.seam,
      timers: options.timers,
    });
    // The limiter goes in before the first note, so the stage is never swapped mid-song.
    this.limiterReady = installLimiter(this.graph, { probe: options.probe, ...options.limiter })
      .then((installed) => {
        this.limiterInstalled = installed;
        return installed;
      });
  }

  /** Which limiter the graph runs: the worklet true-peak limiter, or the named fallback. */
  limiter(): Promise<LimiterInstall> {
    return this.limiterReady;
  }

  /** The transition the scheduler planned last, so surfaces can name it (ADR-0459). */
  lastTransition(): Transition | null {
    return this.scheduler.lastTransition();
  }

  /** Why this device may not play, or null when the probe passed. */
  refusal(): UnsupportedHere | null {
    return this.refused;
  }

  state(): EngineState {
    return this.store.get();
  }

  onState(watch: (state: EngineState) => void): () => void {
    return this.store.subscribe(watch);
  }

  private async loadTrack(index: number): Promise<LoadedTrack> {
    let source: TrackSource | null;
    try {
      source = await this.resolve(index);
    } catch (error) {
      return { kind: 'failed', error: (error as Error).message || 'That song could not be found.' };
    }
    if (this.disposed) return { kind: 'missing' };
    if (!source) {
      const length = this.queueLength?.();
      if (length !== undefined && index >= 0 && index < length) {
        return { kind: 'failed', error: 'That song is not available on this device right now.' };
      }
      return { kind: 'missing' };
    }
    const result = await this.loader.load(source.id, source.data);
    return result.ok ? { kind: 'buffer', buffer: result.buffer } : { kind: 'failed', error: result.error };
  }

  async start(songIndex: number, offsetMs: number, playing: boolean): Promise<void> {
    if (this.disposed) return;
    if (this.refused) {
      // The probe failed, so this device offers controller surfaces, never a player claim
      // (ADR-0460). The reason recorded at probe time is the one shown.
      this.store.set({ phase: 'idle', notice: this.refused.reason });
      return;
    }
    await this.limiterReady;
    if (this.disposed) return;
    await this.scheduler.start(songIndex, offsetMs, playing);
  }

  stop(fadeMs: number): void {
    if (!this.disposed) this.scheduler.stop(fadeMs);
  }

  pause(): void {
    void this.scheduler.pause();
  }

  resume(): void {
    void this.scheduler.resume();
  }

  position(): Position | null {
    if (this.disposed) return null;
    const at = this.scheduler.position();
    if (!at) return null;
    // The worklet limiter delays the output by its lookahead; report what is coming out now.
    const latencyMs = Math.round((this.limiterInstalled?.latencySeconds ?? 0) * 1000);
    const offsetMs = Math.max(0, at.offsetMs - latencyMs);
    return { song_index: at.index, offset_ms: offsetMs, state: at.paused ? 'paused' : 'playing' };
  }

  active(): boolean {
    return !this.disposed && this.scheduler.playing();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.dispose();
    this.loader.clear();
    this.graph.dispose();
  }
}
