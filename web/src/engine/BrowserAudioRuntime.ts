import type {
  AudioEngine, BrowserAudioSessionPort, BrowserAudioSourcePort, EngineSnapshot, LocalRecording,
} from './contracts';
import { BrowserAudioLease } from './ownership';
import { boundedFade, boundedPosition, equalPowerCurves, remainingMs, transitionWindow } from './timing';

interface Deck {
  input: GainNode;
  low: BiquadFilterNode;
  high: BiquadFilterNode;
}
interface RunningSource {
  node: AudioBufferSourceNode;
  buffer: AudioBuffer;
  deck: number;
  index: number;
  startTime: number;
  offset: number;
}
const MAX_DESKTOP_FILE = 96 * 1024 * 1024;
const MAX_MOBILE_FILE = 48 * 1024 * 1024;
const MAX_SAFE_PCM = 128 * 1024 * 1024;
const DEFAULT_OUTPUT = 'System-selected speaker or headphones (physical sound unverified)';

function initial(): EngineSnapshot {
  return {
    phase: 'idle', tracks: 0, index: -1, title: null, position: 0, duration: 0,
    volume: 0.75, fadeSeconds: 4, lowDb: 0, highDb: 0, context: 'unavailable',
    output: DEFAULT_OUTPUT, soundCheck: 'unverified', confirmationTime: null,
    ownership: 'none', pending: null, error: null, generation: 0,
  };
}
const nativeDecoder: BrowserAudioSourcePort = {
  async decode(file, context) {
    return context.decodeAudioData(await file.arrayBuffer());
  },
};
/**
 * The live browser-only Web Audio engine. A pair of sources feeds independent EQ/gain
 * decks and a small AudioWorklet mixer; dynamics compression and master gain follow.
 * File decoding happens on the main asynchronous path, never inside process().
 * Decoder, render and remote control ports are injectable and must never fetch audio.
 */
export class BrowserAudioRuntime implements AudioEngine {
  private state = initial();
  private readonly listeners = new Set<() => void>();
  private readonly lease: BrowserAudioLease;
  private readonly decoder: BrowserAudioSourcePort;
  private readonly session: BrowserAudioSessionPort | undefined;
  private queue: LocalRecording[] = [];
  private cache = new Map<string, AudioBuffer>();
  private inFlight = new Map<string, Promise<AudioBuffer>>();
  private context: AudioContext | null = null;
  private graphReady: Promise<void> | null = null;
  private mixer: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private decks: [Deck, Deck] | null = null;
  private active: RunningSource | null = null;
  private leaving: RunningSource | null = null;
  private sequence = 0;
  private disposed = false;
  private clock: ReturnType<typeof setInterval> | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    workspaceId: string,
    options: { decoder?: BrowserAudioSourcePort; session?: BrowserAudioSessionPort } = {},
  ) {
    this.decoder = options.decoder ?? nativeDecoder;
    this.session = options.session;
    this.lease = new BrowserAudioLease(workspaceId, () => {
      this.haltSources();
      this.patch({ phase: 'interrupted', ownership: 'none', soundCheck: 'unverified',
        confirmationTime: null, pending: null, error: 'Another tab or window took audio ownership. Tap Play to regain it.' });
    });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      window.addEventListener('blur', this.onBlur);
    }
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener?.('devicechange', this.onDeviceChange);
    }
  }
  private patch(next: Partial<EngineSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
    this.session?.onState?.(this.state);
  }
  snapshot = (): EngineSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private readonly onVisibility = () => {
    // Losing visibility does not mean the browser stopped producing sound. Desktop
    // browsers can continue playing in another tab; mobile browsers may suspend.
    // Preserve playback while the context is running, but never preserve a prior
    // operator sound check across a potentially changed output/audio session.
    if (document.visibilityState === 'hidden' && this.state.phase === 'playing') {
      this.invalidateSound('Browser is in the background. Playback may be interrupted; check the speaker when you return.');
    }
  };
  private readonly onPageHide = () => { void this.stop(); };
  private readonly onBlur = () => {
    // Focus loss does not prove audio stopped. Only the sound-check assertion expires.
    if (this.state.soundCheck === 'user_confirmed') this.invalidateSound('App focus changed; confirm the physical speaker again.');
  };
  private readonly onDeviceChange = () => this.invalidateSound(
    'The system audio devices changed. Verify the physical output; Bluetooth or a DAC may have disconnected.',
  );
  private invalidateSound(message: string) {
    if (this.disposed || this.state.phase === 'idle') return;
    this.patch({ soundCheck: 'unverified', confirmationTime: null, output: DEFAULT_OUTPUT, error: message });
  }
  private async interrupt(reason: string) {
    if (this.state.phase !== 'playing') return;
    this.sequence++;
    const position = this.positionNow();
    this.haltSources();
    this.lease.release();
    try { await this.context?.suspend(); } catch { /* can already be interrupted */ }
    this.patch({ phase: 'interrupted', position, pending: null, context: this.context?.state ?? 'unavailable',
      soundCheck: 'unverified', confirmationTime: null, error: reason });
  }
  private positionNow(): number {
    if (!this.active || !this.context || this.state.phase !== 'playing') return this.state.position;
    return boundedPosition(this.active.offset + Math.max(0, this.context.currentTime - this.active.startTime), this.active.buffer.duration);
  }
  private requireContext(): { context: AudioContext; resumed: Promise<void> } {
    if (this.disposed) throw new Error('The player has been closed.');
    if (typeof window === 'undefined') throw new Error('Playback needs a browser.');
    const legacy = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? legacy.webkitAudioContext;
    if (!Ctor || typeof AudioWorkletNode === 'undefined') {
      throw new Error('AudioWorklet or Web Audio is unavailable in this browser.');
    }
    if (!this.context || this.context.state === 'closed') {
      this.context = new Ctor({ latencyHint: 'playback' });
      this.context.onstatechange = () => {
        if (this.disposed || !this.context) return;
        const current = this.context.state;
        this.patch({ context: current });
        if (this.state.phase === 'playing' && current !== 'running') {
          void this.interrupt('The operating system or browser interrupted audio. Tap Play to reactivate.');
        }
      };
    }
    // Crucially invoked synchronously in the tap/click handler, before any await.
    const resumed = this.context.resume();
    return { context: this.context, resumed };
  }
  private async buildGraph(context: AudioContext): Promise<void> {
    if (this.graphReady) return this.graphReady;
    this.graphReady = (async () => {
      if (!context.audioWorklet?.addModule) throw new Error('This browser does not support AudioWorklet modules.');
      await context.audioWorklet.addModule(new URL('./mixer.worklet.js', import.meta.url).href);
      if (this.disposed || context !== this.context) return;
      const mixer = new AudioWorkletNode(context, 'selecta-browser-mixer-v1', {
        numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2],
      });
      mixer.onprocessorerror = () => {
        void this.interrupt('The audio processor stopped unexpectedly. Tap Play to retry after checking your speaker.');
      };
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 4;
      limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
      const master = context.createGain();
      master.gain.value = this.state.volume;
      mixer.connect(limiter).connect(master).connect(context.destination);
      this.mixer = mixer; this.master = master;
      this.decks = [0, 1].map((channel): Deck => {
        const input = context.createGain();
        input.gain.value = 0;
        const low = context.createBiquadFilter();
        low.type = 'lowshelf'; low.frequency.value = 220; low.gain.value = this.state.lowDb;
        const high = context.createBiquadFilter();
        high.type = 'highshelf'; high.frequency.value = 3600; high.gain.value = this.state.highDb;
        input.connect(low).connect(high).connect(mixer, 0, channel);
        return { input, low, high };
      }) as [Deck, Deck];
    })().catch((error) => {
      this.graphReady = null;
      throw error;
    });
    return this.graphReady;
  }
  private async decode(index: number, context: AudioContext): Promise<AudioBuffer> {
    const recording = this.queue[index];
    if (!recording) throw new Error('The next recording is missing from this browser.');
    const previous = this.cache.get(recording.id);
    if (previous) return previous;
    const inFlight = this.inFlight.get(recording.id);
    if (inFlight) return inFlight;
    if (!recording.file || !recording.file.size) throw new Error('Select a nonempty local music file.');
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const cap = memory && memory <= 4 ? MAX_MOBILE_FILE : MAX_DESKTOP_FILE;
    if (recording.file.size > cap) {
      throw new Error('This recording exceeds the safe in-memory decode limit (' +
        Math.round(cap / 1024 / 1024) + ' MiB). Use a smaller file on this device.');
    }
    const operation = (async () => {
      let decoded: AudioBuffer;
      try { decoded = await this.decoder.decode(recording.file, context); }
      catch { throw new Error('This browser could not decode ' + recording.title + '. Check the format and reconnect the file.'); }
      if (!decoded || decoded.length <= 0 || decoded.duration <= 0 || decoded.numberOfChannels < 1) {
        throw new Error('The decoded audio is empty or invalid.');
      }
      if (decoded.length * decoded.numberOfChannels * 4 > MAX_SAFE_PCM) {
        throw new Error('Decoded audio exceeds the safe memory budget on this browser. Choose a shorter recording.');
      }
      // At most the active track plus the next decoded buffer are retained.
      this.cache.set(recording.id, decoded);
      for (const id of this.cache.keys()) {
        if (id !== recording.id && id !== this.queue[this.state.index]?.id) this.cache.delete(id);
      }
      return decoded;
    })();
    this.inFlight.set(recording.id, operation);
    try { return await operation; }
    finally { if (this.inFlight.get(recording.id) === operation) this.inFlight.delete(recording.id); }
  }
  private beginSource(index: number, buffer: AudioBuffer, deck: number, when: number, offset: number): RunningSource {
    if (!this.context || !this.decks) throw new Error('Audio graph not prepared.');
    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.decks[deck].input);
    const info: RunningSource = { node, buffer, deck, index, startTime: when, offset };
    node.onended = () => {
      try { node.disconnect(); } catch { /* already closed */ }
      if (this.leaving === info) this.leaving = null;
      if (this.active === info && this.state.phase === 'playing') void this.next();
    };
    node.start(when, offset);
    return info;
  }
  private cancelTimer() {
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    this.transitionTimer = null;
  }
  private haltSources() {
    this.cancelTimer();
    for (const source of [this.active, this.leaving]) {
      if (!source) continue;
      source.node.onended = null;
      try { source.node.stop(); } catch { /* source ended */ }
      try { source.node.disconnect(); } catch { /* context closed */ }
    }
    this.active = null; this.leaving = null;
    for (const deck of this.decks ?? []) {
      try {
        deck.input.gain.cancelScheduledValues(this.context?.currentTime ?? 0);
        deck.input.gain.value = 0;
      } catch { /* context closed */ }
    }
  }
  private planAdvance() {
    this.cancelTimer();
    if (!this.active || !this.context || this.state.phase !== 'playing') return;
    if (this.active.index + 1 >= this.queue.length) return; // onended stops at end
    const remaining = this.active.buffer.duration - this.positionNow();
    const ms = remainingMs(remaining, 0, this.state.fadeSeconds);
    this.transitionTimer = setTimeout(() => { void this.next(); }, Math.max(0, ms));
  }
  private updateClock() {
    if (this.clock) clearInterval(this.clock);
    this.clock = setInterval(() => {
      if (this.state.phase === 'playing') this.patch({ position: this.positionNow() });
    }, 250);
  }
  private bindSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const media = navigator.mediaSession;
    const commands: Array<[MediaSessionAction, () => void]> = [
      ['play', () => { void this.play(); }],
      ['pause', () => { void this.pause(); }],
      ['nexttrack', () => { void this.next(); }],
      ['previoustrack', () => { void this.previous(); }],
      ['seekto', (/* browser supplies details through wrapper below */) => {}],
    ];
    for (const [action, handler] of commands) {
      try {
        if (action === 'seekto') media.setActionHandler(action, (details) => { void this.seek(details.seekTime ?? 0); });
        else media.setActionHandler(action, handler);
      } catch { /* unsupported hardware key */ }
    }
    this.syncSession();
  }
  private syncSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = this.state.phase === 'playing' ? 'playing' :
        this.state.phase === 'paused' ? 'paused' : 'none';
      if (typeof MediaMetadata !== 'undefined' && this.state.title) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: this.state.title, artist: 'Local recording', album: 'Selecta' });
      }
      if (this.state.duration) navigator.mediaSession.setPositionState?.({
        duration: this.state.duration, position: Math.min(this.state.position, this.state.duration), playbackRate: 1,
      });
    } catch { /* MediaSession is advisory */ }
  }
  private clearSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    for (const command of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'] as MediaSessionAction[]) {
      try { navigator.mediaSession.setActionHandler(command, null); } catch { /* browser differs */ }
    }
    try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch { /* optional */ }
  }
  async setQueue(files: readonly LocalRecording[]): Promise<void> {
    await this.stop();
    this.queue = [...files];
    this.cache.clear(); this.inFlight.clear();
    this.patch({ tracks: files.length, index: files.length ? 0 : -1,
      title: files[0]?.title ?? null, phase: files.length ? 'ready' : 'idle',
      position: 0, duration: 0, error: null, generation: this.state.generation + 1 });
  }
  async activate(): Promise<void> {
    // Only call directly from user interaction. A passive effect cannot unlock Safari audio.
    const { context, resumed } = this.requireContext();
    this.patch({ pending: 'Activating audio', context: context.state, error: null });
    try {
      await resumed;
      await this.buildGraph(context);
      if (context.state !== 'running') throw new Error('Tap Start again to unlock the audio output.');
      this.patch({ pending: null, context: context.state });
    } catch (error) {
      this.patch({ pending: null, error: (error as Error).message, context: context.state });
      throw error;
    }
  }
  async play(): Promise<void> {
    if (this.state.phase === 'playing' || this.state.phase === 'starting') return;
    const index = this.state.index >= 0 ? this.state.index : 0;
    if (!this.queue[index]) {
      this.patch({ error: 'Choose music stored on this device before pressing Play.' });
      return;
    }
    const mine = ++this.sequence;
    // Capture user activation before await/lock/decode, essential for iOS Safari.
    let activation: Promise<void>;
    try { activation = this.activate(); void activation.catch(() => {}); }
    catch (error) { this.patch({ phase: 'error', pending: null, error: (error as Error).message }); return; }
    this.patch({ phase: 'starting', pending: 'Preparing local recording', error: null });
    try {
      const ownership = await this.lease.acquire();
      if (ownership === 'unsupported') throw new Error('Audio is owned by another tab, or this browser cannot safely coordinate tabs.');
      if (mine !== this.sequence || this.disposed) { this.lease.release(); return; }
      await activation;
      if (!this.context || !this.decks) throw new Error('Audio output is not available.');
      const buffer = await this.decode(index, this.context);
      if (mine !== this.sequence || this.disposed) { this.lease.release(); return; }
      const offset = boundedPosition(this.state.position, buffer.duration);
      const t = this.context.currentTime + 0.02;
      this.haltSources();
      const deck = 0;
      this.decks[deck].input.gain.setValueAtTime(1, t);
      this.active = this.beginSource(index, buffer, deck, t, offset);
      this.patch({ phase: 'playing', index, title: this.queue[index].title, duration: buffer.duration, position: offset,
        pending: null, context: this.context.state, ownership, error: null });
      this.bindSession(); this.updateClock(); this.planAdvance();
      if (index + 1 < this.queue.length) void this.decode(index + 1, this.context).catch(() => {});
    } catch (error) {
      if (mine !== this.sequence || this.disposed) return;
      this.haltSources(); this.lease.release();
      this.patch({ phase: 'error', pending: null, ownership: 'none', error: (error as Error).message });
    }
  }
  async pause(): Promise<void> {
    if (this.state.phase !== 'playing' && this.state.phase !== 'starting') return;
    this.sequence++;
    const position = this.positionNow();
    this.haltSources();
    this.lease.release();
    this.patch({ phase: 'paused', position, ownership: 'none', pending: null });
    this.syncSession();
    try { await this.context?.suspend(); }
    catch { this.patch({ error: 'Browser refused to suspend the audio context; output may be interrupted.' }); }
  }
  async stop(): Promise<void> {
    this.sequence++;
    this.haltSources();
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
    this.lease.release();
    this.clearSession();
    this.patch({ phase: this.queue.length ? 'ready' : 'idle', position: 0, pending: null,
      ownership: 'none', soundCheck: 'unverified', confirmationTime: null, generation: this.state.generation + 1 });
    try { await this.context?.suspend(); } catch { /* context already suspended */ }
  }
  async seek(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds)) return;
    const buffer = this.active?.buffer ?? this.cache.get(this.queue[this.state.index]?.id ?? '');
    if (!buffer) return;
    const target = boundedPosition(seconds, buffer.duration);
    const wasPlaying = this.state.phase === 'playing';
    this.sequence++;
    this.haltSources();
    this.patch({ position: target, pending: null });
    if (!wasPlaying || !this.context || !this.decks) return;
    const t = this.context.currentTime + 0.02;
    this.decks[0].input.gain.setValueAtTime(1, t);
    this.active = this.beginSource(this.state.index, buffer, 0, t, target);
    this.planAdvance();
    this.syncSession();
  }
  async next(): Promise<void> {
    if (this.state.pending === 'Preparing next local track') return;
    const next = this.state.index + 1;
    if (!this.queue[next]) { await this.stop(); return; }
    const mine = ++this.sequence;
    const previous = this.active;
    const running = this.state.phase === 'playing' && previous && this.context && this.decks;
    if (!running) {
      this.haltSources();
      this.patch({ index: next, title: this.queue[next].title, position: 0, duration: 0, pending: null });
      if (this.state.phase === 'paused') return;
      await this.play(); return;
    }
    this.patch({ pending: 'Preparing next local track', error: null });
    try {
      const context = this.context!;
      const buffer = await this.decode(next, context);
      if (mine !== this.sequence || this.disposed || !this.decks || this.active !== previous) return;
      const fade = transitionWindow(
        previous.buffer.duration - this.positionNow(), this.state.fadeSeconds, buffer.duration,
      );
      const t = context.currentTime + 0.035;
      const nextDeck = 1 - previous.deck;
      const incoming = this.decks[nextDeck].input.gain;
      const outgoing = this.decks[previous.deck].input.gain;
      incoming.cancelScheduledValues(t); outgoing.cancelScheduledValues(t);
      incoming.setValueAtTime(0, t);
      outgoing.setValueAtTime(1, t);
      const source = this.beginSource(next, buffer, nextDeck, t, 0);
      if (fade >= 0.04) {
        const curves = equalPowerCurves();
        incoming.setValueCurveAtTime(curves.incoming, t, fade);
        outgoing.setValueCurveAtTime(curves.outgoing, t, fade);
      } else {
        incoming.setValueAtTime(1, t);
        outgoing.setValueAtTime(0, t);
      }
      // Publish ownership before stopping the old source. onended may fire
      // promptly on some engines and must not skip another track or stop the
      // newly active source because it still sees the outgoing deck as active.
      this.leaving = previous;
      this.active = source;
      try { previous.node.stop(t + fade + 0.002); } catch { /* already ended */ }
      this.patch({ index: next, title: this.queue[next].title, duration: buffer.duration, position: 0,
        pending: null, error: null });
      this.syncSession(); this.planAdvance();
      if (next + 1 < this.queue.length) void this.decode(next + 1, context).catch(() => {});
    } catch (error) {
      if (mine !== this.sequence) return;
      this.patch({ pending: null, error: 'Next track unavailable; current playback preserved if still active. ' +
        (error as Error).message });
      const old = this.active;
      if (!old || (this.context &&
        old.offset + Math.max(0, this.context.currentTime - old.startTime) >= old.buffer.duration - 0.01)) {
        await this.stop();
      }
    }
  }
  async previous(): Promise<void> {
    if (this.state.position > 3 || this.state.index === 0) { await this.seek(0); return; }
    const previous = this.state.index - 1;
    if (previous < 0) return;
    const playing = this.state.phase === 'playing';
    this.sequence++;
    this.haltSources();
    // The source has been stopped; do not leave phase='playing' or play()
    // will treat the request as already active and leave the speaker silent.
    this.patch({ index: previous, title: this.queue[previous].title, position: 0, duration: 0,
      phase: playing ? 'ready' : this.state.phase, pending: null });
    if (playing) await this.play();
  }
  setVolume(value: number) {
    const volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : this.state.volume;
    if (this.master && this.context) this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
    this.patch({ volume });
  }
  setFade(seconds: number) {
    this.patch({ fadeSeconds: boundedFade(seconds) });
    this.planAdvance();
  }
  setEq(lowDb: number, highDb: number) {
    const clamp = (v: number) => Number.isFinite(v) ? Math.max(-12, Math.min(12, v)) : 0;
    const low = clamp(lowDb), high = clamp(highDb);
    for (const deck of this.decks ?? []) {
      if (this.context) {
        deck.low.gain.setTargetAtTime(low, this.context.currentTime, 0.03);
        deck.high.gain.setTargetAtTime(high, this.context.currentTime, 0.03);
      }
    }
    this.patch({ lowDb: low, highDb: high });
  }
  confirmSound(heard: boolean) {
    if (this.state.phase !== 'playing') return;
    this.patch({ soundCheck: heard ? 'user_confirmed' : 'unverified',
      confirmationTime: heard ? Date.now() : null,
      error: heard ? null : 'No sound heard. Check device volume, speakers, Bluetooth and system output before continuing.' });
  }
  async dispose() {
    if (this.disposed) return;
    await this.stop();
    this.disposed = true;
    this.lease.dispose();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      window.removeEventListener('blur', this.onBlur);
    }
    if (typeof navigator !== 'undefined') navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    this.listeners.clear();
    this.cache.clear(); this.queue = [];
    await this.context?.close().catch(() => {});
    this.context = null;
  }
}
