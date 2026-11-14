/**
 * Browser-only, device-local Web Audio executor for a one-output venue.
 *
 * This deliberately does not speak to Cloud and cannot open another device's files.
 * Agent 01 can replace its decoder/transition implementation behind VenueAudioPort.
 * Browser resume, an AudioContext meter and a cloud heartbeat are NOT physical proof.
 */
import { BrowserAudioLease } from '../engine/ownership';

export type LocalRecording = {
  id: string;
  title: string;
  artist: string;
  file: File;
  /** Affirmative on-device content/rights review, never inferred from a file name. */
  permitted: boolean;
  revision: string;
};

export type PlayerPhase = 'locked' | 'ready' | 'preparing' | 'playing' | 'paused' | 'interrupted' | 'stopped' | 'failed';
export type PlayerSnapshot = {
  phase: PlayerPhase;
  currentId: string | null;
  generation: number;
  output: 'unverified' | 'operator_checked';
  operatorCheckedAt: number | null;
  contextRunning: boolean;
  wakeLockHeld: boolean;
  foreground: boolean;
  online: boolean;
  preparedMinutes: number;
  /** AudioContext media clock, not a background timer guarantee. */
  remainingSeconds?: number | null;
  lastError: string | null;
};

export interface VenueAudioPort {
  unlock(): Promise<boolean>;
  importLocal(records: readonly LocalRecording[]): void;
  bindLocal(record: LocalRecording): void;
  prepare(trackId: string): Promise<void>;
  start(trackId: string, generation: number): Promise<void>;
  transition(trackId: string, fadeSeconds?: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  soundCheck(): Promise<void>;
  confirmHeard(): boolean;
  setVolume(value: number): void;
  snapshot(): PlayerSnapshot;
  playing(): boolean;
  savedHoursAhead(): number;
  dispose(): Promise<void>;
}

type WakeSentinel = { released: boolean; release(): Promise<void>; addEventListener?(event: 'release', cb: () => void): void };
type WakeNavigator = Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> } };
type Deck = { node: AudioBufferSourceNode; gain: GainNode; id: string; endsAt: number };

const MAX_FILE_BYTES = 150 * 1024 * 1024; // bounded decode; long files require Agent 01 streaming
const MAX_PREPARED = 3;
const MAX_GAIN = 0.75;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Local audio unavailable';

export class BrowserVenueAudio implements VenueAudioPort {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private files = new Map<string, LocalRecording>();
  private buffers = new Map<string, AudioBuffer>();
  private deck: Deck | null = null;
  private phase: PlayerPhase = 'locked';
  private generation = 0;
  private checkedAt: number | null = null;
  private testAt: number | null = null;
  private wake: WakeSentinel | null = null;
  private disposed = false;
  private error: string | null = null;
  private volume = 0.45;
  private readonly lease: BrowserAudioLease;

  private readonly interrupted = () => {
    // We cannot rely on iPad Safari, Android Doze or a PWA running when hidden.
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
      this.checkedAt = null;
      this.phase = 'interrupted';
      this.lease.release();
      // A hidden mobile browser cannot promise to keep the source executing.
      void this.stop().then(() => { if (!this.disposed) this.phase = 'interrupted'; })
        .catch(() => { this.phase = 'interrupted'; });
      void this.context?.suspend().catch(() => {});
    }
  };

  constructor() {
    this.lease = new BrowserAudioLease('all-browser-outputs', () => {
      this.checkedAt = null;
      void this.stop().then(() => { if (!this.disposed) this.phase = 'interrupted'; })
        .catch(() => { this.phase = 'interrupted'; });
      this.error = 'Another Selecta tab took this speaker. Recheck the physical output before resuming.';
    });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.interrupted);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.interrupted);
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('This browser player has closed; open a new player');
  }

  private contextReady(): AudioContext {
    if (!this.context || this.context.state !== 'running') throw new Error('Tap Start on this device to unlock its audio');
    return this.context;
  }

  async unlock(): Promise<boolean> {
    this.assertOpen();
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
    try {
      if (!this.context) {
        const Ctor = (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).AudioContext
          ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error('Web Audio is not available in this browser');
        this.context = new Ctor();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.context.destination); // actual OS-selected local output
      }
      await this.context.resume();
      if (this.context.state !== 'running') throw new Error('Audio remains blocked; tap Start again');
      this.error = null;
      this.phase = this.deck ? 'playing' : 'ready';
      await this.requestWake();
      return true;
    } catch (error) {
      this.phase = 'failed';
      this.error = errorText(error);
      return false;
    }
  }

  importLocal(records: readonly LocalRecording[]): void {
    this.assertOpen();
    const next = new Map<string, LocalRecording>();
    for (const rec of records) {
      if (!rec.id || !rec.revision || !rec.permitted || !(rec.file instanceof File))
        throw new Error('Music must have a verified local file, revision and permissions');
      if (rec.file.size <= 0 || rec.file.size > MAX_FILE_BYTES)
        throw new Error('File too large or empty for this browser decoder');
      if (next.has(rec.id)) throw new Error('Duplicate recording identity');
      next.set(rec.id, rec);
    }
    // Any new user grant invalidates cached buffers/output evidence.
    this.files = next;
    this.buffers.clear();
    this.checkedAt = null;
    if (this.deck && !next.has(this.deck.id)) void this.stop();
  }

  /** Incrementally bind the next exact recording without interrupting the live deck. */
  bindLocal(record: LocalRecording): void {
    this.assertOpen();
    if (!record.id || !record.revision || !record.permitted || !(record.file instanceof File)
      || record.file.size <= 0 || record.file.size > MAX_FILE_BYTES)
      throw new Error('Next song needs an authorised local file, revision and valid size');
    const previous = this.files.get(record.id);
    if (previous && previous.revision !== record.revision && this.deck?.id === record.id)
      throw new Error('Cannot silently replace the currently audible recording');
    if (previous?.revision !== record.revision) this.buffers.delete(record.id);
    this.files.set(record.id, record);
  }

  async prepare(trackId: string): Promise<void> {
    this.assertOpen();
    if (this.buffers.has(trackId)) return;
    const rec = this.files.get(trackId);
    if (!rec?.permitted) throw new Error('This exact authorised recording is unavailable here');
    const ctx = this.contextReady();
    if (this.buffers.size >= MAX_PREPARED) throw new Error('Prepared track memory limit reached');
    this.phase = this.deck ? 'playing' : 'preparing';
    try {
      // Browser-granted File is never uploaded or serialized to Cloud.
      const bytes = await rec.file.arrayBuffer();
      if (this.files.get(trackId) !== rec) throw new Error('Local music permission changed during preparation');
      const buffer = await ctx.decodeAudioData(bytes);
      if (this.files.get(trackId) !== rec) throw new Error('Local music source changed');
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0)
        throw new Error('Recording could not be decoded');
      this.buffers.set(trackId, buffer);
      if (!this.deck) this.phase = 'ready';
    } catch (error) {
      this.error = errorText(error);
      if (!this.deck) this.phase = 'failed';
      throw error;
    }
  }

  private launch(trackId: string, startAt: number, fadeIn: number): Deck {
    const ctx = this.contextReady();
    const buffer = this.buffers.get(trackId);
    if (!buffer || !this.files.has(trackId)) throw new Error('Recording is not locally prepared');
    const node = ctx.createBufferSource();
    const gain = ctx.createGain();
    node.buffer = buffer;
    node.connect(gain);
    gain.connect(this.master!);
    gain.gain.setValueAtTime(fadeIn ? 0 : 1, startAt);
    if (fadeIn) gain.gain.linearRampToValueAtTime(1, startAt + fadeIn);
    node.start(startAt);
    const deck = { id: trackId, node, gain, endsAt: startAt + buffer.duration };
    node.onended = () => {
      gain.disconnect();
      if (this.deck === deck) {
        this.deck = null;
        this.phase = 'stopped';
        this.checkedAt = null;
        this.lease.release();
        void this.releaseWake();
      }
    };
    return deck;
  }

  async start(trackId: string, generation: number): Promise<void> {
    this.assertOpen();
    if (!Number.isSafeInteger(generation) || generation < this.generation)
      throw new Error('Stale or unsafe speaker generation');
    this.contextReady();
    await this.prepare(trackId);
    if (this.deck) {
      // Never silence a running venue before the replacement is ready. A
      // transition within this browser retains the existing exclusive lease.
      if (this.phase !== 'playing') {
        throw new Error('Resume or stop the paused venue output before starting another recording');
      }
      await this.transition(trackId, 0.05);
      this.generation = generation;
      return;
    }
    const ownership = await this.lease.acquire();
    if (ownership === 'unsupported') {
      this.error = 'Another Selecta browser player owns this output; stop it before starting the venue.';
      throw new Error(this.error);
    }
    try {
      this.generation = generation;
      this.checkedAt = null;
      this.deck = this.launch(trackId, this.contextReady().currentTime + 0.03, 0.04);
      this.phase = 'playing';
      await this.requestWake();
    } catch (error) {
      this.lease.release();
      throw error;
    }
  }

  async transition(trackId: string, fadeSeconds = 2): Promise<void> {
    this.assertOpen();
    const ctx = this.contextReady();
    if (!this.deck) throw new Error('No active browser output to transition');
    if (!Number.isFinite(fadeSeconds) || fadeSeconds < 0 || fadeSeconds > 10)
      throw new Error('Unsupported transition duration');
    await this.prepare(trackId);
    const now = ctx.currentTime + 0.03;
    const fade = Math.min(fadeSeconds, this.buffers.get(this.deck.id)?.duration ?? fadeSeconds);
    const old = this.deck;
    const next = this.launch(trackId, now, fade);
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(1, now);
    old.gain.gain.linearRampToValueAtTime(0, now + fade);
    // Publish the new deck *before* requesting the old source stop: an
    // immediately dispatched onended callback must never release the new
    // owner's lease or mark the fresh track stopped.
    this.deck = next;
    old.node.stop(now + Math.max(0.02, fade));
    this.buffers.delete(old.id); // retain only bounded locally decoded horizon
    this.checkedAt = null; // changing song doesn't certify the physical output
    this.phase = 'playing';
  }

  async pause(): Promise<void> {
    if (this.context && this.deck) {
      await this.context.suspend();
      this.lease.release();
      this.phase = 'paused';
      this.checkedAt = null;
    }
  }

  async resume(): Promise<void> {
    if (!this.deck) throw new Error('No local song is ready to resume');
    // Invoke AudioContext.resume directly in the user gesture, but keep gain muted
    // until an exclusive browser-wide owner is confirmed.
    if (this.master) this.master.gain.value = 0;
    const activation = this.unlock();
    const ownership = await this.lease.acquire();
    if (ownership === 'unsupported') {
      await this.context?.suspend().catch(() => {});
      throw new Error('Another browser window owns audio; stop it before resuming this venue.');
    }
    if (!await activation) {
      this.lease.release();
      throw new Error(this.error ?? 'Tap to resume audio');
    }
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
    this.phase = 'playing';
    this.checkedAt = null;
  }

  async stop(): Promise<void> {
    const old = this.deck;
    this.deck = null;
    if (old) {
      try { old.node.stop(); } catch { /* node already ended */ }
      old.gain.disconnect();
    }
    this.checkedAt = null;
    this.phase = 'stopped';
    this.lease.release();
    await this.releaseWake();
  }

  /** Real locally routed test signal; a person MUST confirm they heard the speaker. */
  async soundCheck(): Promise<void> {
    const ctx = this.contextReady();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.04);
    gain.gain.linearRampToValueAtTime(0, now + 0.5);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.onended = () => gain.disconnect();
    osc.start(now);
    osc.stop(now + 0.52);
    this.testAt = Date.now();
    this.checkedAt = null;
  }

  confirmHeard(): boolean {
    // Explicit on-site human acknowledgement, not machine-observed output telemetry.
    if (!this.testAt || Date.now() - this.testAt > 120_000 || this.context?.state !== 'running'
      || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return false;
    this.checkedAt = Date.now();
    this.testAt = null;
    return true;
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value)) throw new Error('Volume must be finite');
    this.volume = Math.max(0, Math.min(MAX_GAIN, value));
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
  }

  private async requestWake(): Promise<void> {
    if (typeof navigator === 'undefined' || this.wake || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return;
    try {
      this.wake = await (navigator as WakeNavigator).wakeLock?.request('screen') ?? null;
      this.wake?.addEventListener?.('release', () => { this.wake = null; });
    } catch { this.wake = null; } // iOS Safari may not support it
  }

  private async releaseWake(): Promise<void> {
    const current = this.wake;
    this.wake = null;
    if (current && !current.released) await current.release().catch(() => undefined);
  }

  snapshot(): PlayerSnapshot {
    const foreground = typeof document === 'undefined' || document.visibilityState === 'visible';
    const running = this.context?.state === 'running' && foreground && this.phase !== 'interrupted';
    return {
      phase: this.phase,
      currentId: this.deck?.id ?? null,
      generation: this.generation,
      output: this.checkedAt !== null && running ? 'operator_checked' : 'unverified',
      operatorCheckedAt: this.checkedAt,
      contextRunning: Boolean(running),
      wakeLockHeld: Boolean(this.wake && !this.wake.released),
      foreground,
      online: typeof navigator === 'undefined' || navigator.onLine !== false,
      preparedMinutes: [...this.buffers.values()].reduce((sum, buffer) => sum + buffer.duration / 60, 0),
      remainingSeconds: this.deck && this.context ? Math.max(0, this.deck.endsAt - this.context.currentTime) : null,
      lastError: this.error,
    };
  }

  playing(): boolean {
    const s = this.snapshot();
    return s.phase === 'playing' && Boolean(s.currentId) && s.contextRunning && s.output === 'operator_checked';
  }

  savedHoursAhead(): number { return this.snapshot().preparedMinutes / 60; }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.stop();
    this.disposed = true;
    this.lease.dispose();
    this.buffers.clear();
    this.files.clear();
    await this.context?.close();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.interrupted);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.interrupted);
  }
}
