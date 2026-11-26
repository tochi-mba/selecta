import type { Position, Speaker } from '../devices/usePlaybackDevice';
import type { ResolvedTrack } from '../media/resolve';
import { buildGraph, EngineGraph } from './graph';
import { installLimiter, InstallLimiterOptions, LimiterInstall } from './limiter';
import { createLoader, Loader } from './loader';
import type { ProbeResult } from './probe';
import { createScheduler, LoadedTrack, Scheduler, SchedulerClock, SchedulerTimers, SeamProvider, Transition } from './scheduler';
import { BACKGROUND_TAB_NOTICE, createEngineStore, downgradeDeviceOutput, EngineState, EngineStore, noticeWhilePlaying, OUTPUT_CHANGED_NOTICE, UnsupportedHere } from './state';

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
  /** The engine that owns the context and this speaker; disposed with the speaker. */
  disposeOwner?: () => void;
  /** How many songs the programme holds. Without it a null from resolve ends the set, which is
   * only right for resolvers that never answer null for an unavailable song. */
  queueLength?: () => number;
  /** Builds dsp/seams.ts schedules for transitions; gapless boundaries without one. */
  seam?: SeamProvider;
  /** cloud.seam_lead (scheduler.ts SchedulerDeps). */
  planAhead?: () => boolean;
  level?: (buffer: AudioBuffer) => Promise<number>;
  /** Told each time a song's audio is ready to play, read only, so a surface can draw it without
   * decoding the file again. Called synchronously on the way to the scheduler: it must only start
   * its own work for later, and whatever it throws is ignored. */
  decoded?: (id: TrackSource['id'], buffer: AudioBuffer) => void;
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
  private readonly decodeBytes: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  private readonly scheduler: Scheduler;
  private readonly resolve: ResolveTrack;
  private readonly disposeOwner?: () => void;
  private readonly queueLength: (() => number) | null;
  private readonly decoded: BrowserSpeakerOptions['decoded'];
  private readonly limiterReady: Promise<LimiterInstall>;
  private limiterInstalled: LimiterInstall | null = null;
  private visualTaps: { left: AnalyserNode; right: AnalyserNode } | null = null;
  private visualSplit: ChannelSplitterNode | null = null;
  private readonly watchedDocument: Document | null;
  private readonly watchedDevices: MediaDevices | null;
  private readonly onVisibilityChange = () => {
    if (this.disposed || this.watchedDocument?.visibilityState !== 'hidden') return;
    // this speaker keeps its own wording; other engines are told only if they are playing
    downgradeDeviceOutput({ status: 'uncertain' }, noticeWhilePlaying(BACKGROUND_TAB_NOTICE, this.store), this.store);
  };
  private readonly onOutputDeviceChange = () => {
    if (this.disposed) return;
    const playing = this.store.get().phase === 'playing';
    // A route change must not send audio into a newly attached output at an unexpected level.
    // Pause the scheduler/context and require a fresh Play gesture; never auto-resume.
    downgradeDeviceOutput({ status: 'output_unverified' }, OUTPUT_CHANGED_NOTICE, this.store);
    if (playing) void this.scheduler.pause();
  };

  constructor(options: BrowserSpeakerOptions) {
    this.store = options.store ?? createEngineStore();
    this.refused = options.probe.ok ? null : { state: 'unsupported_here', reason: options.probe.reason };
    this.resolve = options.resolve;
    this.disposeOwner = options.disposeOwner;
    this.queueLength = options.queueLength ?? null;
    this.decoded = options.decoded;
    this.graph = options.graph ?? buildGraph(options.audio.context);
    const context = options.audio.context;
    this.decodeBytes = (bytes) => context.decodeAudioData(bytes);
    this.loader = createLoader(this.decodeBytes, { keep: options.keep });
    this.scheduler = createScheduler({
      graph: this.graph,
      store: this.store,
      load: (index) => this.loadTrack(index),
      hold: () => options.audio.hold(),
      wake: () => options.audio.wake(),
      seam: options.seam,
      planAhead: options.planAhead,
      level: options.level,
      timers: options.timers,
    });
    this.watchedDocument = typeof document === 'undefined' ? null : document;
    this.watchedDevices = typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null;
    this.watchedDocument?.addEventListener('visibilitychange', this.onVisibilityChange);
    this.watchedDevices?.addEventListener('devicechange', this.onOutputDeviceChange);
    // The limiter goes in before the first note, so the stage is never swapped mid-song.
    this.limiterReady = installLimiter(this.graph, {
      probe: options.probe,
      ...options.limiter,
      isActive: () => !this.disposed,
    })
      .then((installed) => {
        if (!this.disposed) this.limiterInstalled = installed;
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

  /** The hand-overs the scheduler really scheduled, read only, for Listen (engine/scheduler.ts
   * SchedulerClock). Time heard is reported as it comes out, after the limiter's lookahead, to
   * match position(). */
  clock(): SchedulerClock | null {
    if (this.disposed) return null;
    const clock = this.scheduler.clock?.() ?? null;
    if (!clock?.entered) return clock;
    const latency = this.limiterInstalled?.latencySeconds ?? 0;
    return { ...clock, entered: { ...clock.entered, heard: Math.max(0, clock.entered.heard - latency) } };
  }

  /** Why this device may not play, or null when the probe passed. */
  refusal(): UnsupportedHere | null {
    return this.refused;
  }

  state(): EngineState {
    return this.store.get();
  }

  /** Called by the lease owner after a previously granted screen wake lock is revoked. */
  wakeLockLost(): void {
    if (this.disposed) return;
    downgradeDeviceOutput(
      { status: 'uncertain' },
      'The screen wake lock was released, so the device may sleep and stop the sound.',
      this.store,
    );
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
    if (result.ok && this.decoded) {
      try {
        this.decoded(source.id, result.buffer);
      } catch {
        // a picture of the song never stands in the way of playing it
      }
    }
    return result.ok ? { kind: 'buffer', buffer: result.buffer } : { kind: 'failed', error: result.error };
  }

  /** A song at a mix position, decoded through the same capped cache the scheduler plays from, so
   * a transition rendered ahead from it is made from the very samples that will play
   * (cloud.device_render). Null when it cannot be read here. Tells no surface it was decoded. */
  async decodedAt(index: number): Promise<AudioBuffer | null> {
    if (this.disposed || !Number.isSafeInteger(index) || index < 0) return null;
    try {
      const source = await this.resolve(index);
      if (!source || this.disposed) return null;
      const result = await this.loader.load(source.id, source.data);
      return result.ok ? result.buffer : null;
    } catch {
      return null;
    }
  }

  /** A song not in the mix yet (a request's), decoded by the context that plays, so a transition
   * made ahead from it has the samples it will play with. Outside the loader's cache, so it never
   * pushes out a song about to play. Null when it cannot be read here. */
  async decodedSource(source: TrackSource): Promise<AudioBuffer | null> {
    if (this.disposed) return null;
    try {
      return await this.decodeBytes(await source.data());
    } catch {
      return null;
    }
  }

  async start(songIndex: number, offsetMs: number, playing: boolean): Promise<void> {
    if (this.disposed) return;
    if (this.refused) {
      // The probe failed, so this device offers controller surfaces, never a player claim
      // (ADR-0460). The reason recorded at probe time is the one shown.
      this.store.set({ phase: 'idle', notice: this.refused.reason });
      return;
    }
    if (!Number.isSafeInteger(songIndex) || songIndex < 0 || !Number.isFinite(offsetMs) || offsetMs < 0 || typeof playing !== 'boolean') {
      this.store.set({ phase: 'idle', notice: 'That playback position is not valid, so SelectaDJ did not start.' });
      return;
    }
    await this.limiterReady;
    if (this.disposed) return;
    await this.scheduler.start(songIndex, offsetMs, playing);
  }

  stop(fadeMs: number): void {
    if (!this.disposed) this.scheduler.stop(fadeMs);
  }

  /** Set the device's master output level (normalized to [0, 1]). */
  setVolume(volume: number): void {
    if (!this.disposed) this.graph.setVolume(volume);
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

  /** The mixed output's frequency bands from the graph's existing analyser, read only, for the
   * visualizer and the beat bus (ADR-0477). Reading it changes nothing in the sound. */
  spectrum(): Uint8Array | null {
    if (this.disposed) return null;
    return this.graph.spectrum();
  }

  /** Unsmoothed left and right analysers for the visualizer and the beat bus, like player.ts
   * getVisualTaps. They hang off the graph's analyser as a dead-end side branch: the splitter feeds
   * only these two analysers, which connect to nothing, so the path to the speakers is untouched.
   * Made on first ask, so a device that never shows the music pays nothing. */
  spectrumTaps(): { left: AnalyserNode; right: AnalyserNode } | null {
    if (this.disposed) return null;
    if (!this.visualTaps) {
      const context = this.graph.context;
      const split = context.createChannelSplitter(2);
      const left = context.createAnalyser();
      const right = context.createAnalyser();
      for (const tap of [left, right]) { tap.fftSize = 1024; tap.smoothingTimeConstant = 0; }
      this.graph.analyser.connect(split);
      split.connect(left, 0);
      split.connect(right, 1);
      this.visualTaps = { left, right };
      this.visualSplit = split;
    }
    return this.visualTaps;
  }

  active(): boolean {
    return !this.disposed && this.scheduler.playing();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.watchedDocument?.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.watchedDevices?.removeEventListener('devicechange', this.onOutputDeviceChange);
    this.scheduler.dispose();
    this.loader.clear();
    try {
      this.visualSplit?.disconnect();
    } catch {
      // already gone with its context
    }
    this.visualTaps = null;
    this.visualSplit = null;
    this.graph.dispose();
    this.disposeOwner?.();
  }
}
