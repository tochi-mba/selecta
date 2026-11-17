import type { Position, Speaker } from '../devices/usePlaybackDevice';
import { buildGraph, EngineGraph } from './graph';
import { createLoader, Loader } from './loader';
import type { ProbeResult } from './probe';
import { createScheduler, LoadedTrack, Scheduler, SchedulerTimers } from './scheduler';
import { createEngineStore, EngineState, EngineStore, UnsupportedHere } from './state';

/** The browser engine as an ADR-0415 playback device (ADR-0457, BF-0457-05).
 *
 * BrowserSpeaker implements the Speaker interface that usePlaybackDevice drives, so Rooms,
 * remote control and take-over treat this engine like any other speaker. It never finds its own
 * audio: the media agent injects `resolve(index)`, which answers with a track id and a way to
 * read its bytes (or null past the end of the queue), and that injected shape is the whole
 * dependency. A failed capability probe means start() refuses with the recorded reason instead
 * of pretending (ADR-0460); position() answers from the audio clock, never from hope; active()
 * is false after dispose or after the lease is lost (stop).
 */

export type TrackSource = {
  id: number | string;
  /** Read the file's bytes; called at most once per decode, results cached by id. */
  data: () => Promise<ArrayBuffer>;
};
export type ResolveTrack = (index: number) => Promise<TrackSource | null>;

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
  store?: EngineStore;
  /** How many decoded songs to keep in memory (loader.ts, default 3). */
  keep?: number;
  /** A ready-made graph, mainly for tests; built on the context otherwise. */
  graph?: EngineGraph;
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

  constructor(options: BrowserSpeakerOptions) {
    this.store = options.store ?? createEngineStore();
    this.refused = options.probe.ok ? null : { state: 'unsupported_here', reason: options.probe.reason };
    this.resolve = options.resolve;
    this.graph = options.graph ?? buildGraph(options.audio.context);
    const context = options.audio.context;
    this.loader = createLoader((bytes) => context.decodeAudioData(bytes), { keep: options.keep });
    this.scheduler = createScheduler({
      graph: this.graph,
      store: this.store,
      load: (index) => this.loadTrack(index),
      hold: () => options.audio.hold(),
      wake: () => options.audio.wake(),
      timers: options.timers,
    });
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
    if (!source || this.disposed) return { kind: 'missing' };
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
    return { song_index: at.index, offset_ms: at.offsetMs, state: at.paused ? 'paused' : 'playing' };
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
