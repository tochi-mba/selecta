/**
 * Device-owned venue programme runner. The only media API is a locally granted File.
 *
 * No hosted audio, remote audio proxy or browser/background survival guarantee.
 * A lightweight foreground timer replenishes a small horizon; Agent 01 must replace
 * this timing with qualified AudioWorklet scheduling before production DJ parity.
 */
import type { BrowserVenueIntegrations } from './contracts';
import type { VenuePolicy, RecordingPolicyFacts } from './policy';
import { recordingAllowed, venueOpen } from './policy';

export type VenueScope = {
  workspaceId: string; venueId: string; zoneId: string; deviceId: string;
};
export type CanonicalTrack = { id: string; revision: string };
export type ProgrammeHorizon = {
  committed: readonly CanonicalTrack[];
  prepared: readonly CanonicalTrack[];
  planned: readonly CanonicalTrack[];
  fallback: readonly CanonicalTrack[];
};
export type ProgrammeStatus = {
  state: 'idle' | 'running' | 'paused' | 'interrupted' | 'blocked';
  generation: number;
  current: string | null;
  committed: readonly string[];
  prepared: readonly string[];
  planned: readonly string[];
  offline: boolean;
  issue: string | null;
};

const MAX_HORIZON = 200;
const LEAD_SECONDS = 4;
const PREFLIGHT_SECONDS = 40;
const REPORT_INTERVAL_MS = 15_000;
const errorMessage = (value: unknown) => value instanceof Error ? value.message : 'Local programme unavailable';

export class BrowserVenueProgramme {
  private policy: VenuePolicy | null = null;
  private horizon: ProgrammeHorizon | null = null;
  private facts = new Map<string, RecordingPolicyFacts>();
  private generation = 0;
  private current: CanonicalTrack | null = null;
  private index = -1;
  private state: ProgrammeStatus['state'] = 'idle';
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReportAt = 0;
  private runningTick = false;
  private transitionInFlight = false;
  private startInFlight = false;
  private playbackEpoch = 0;
  private disposed = false;
  private issue: string | null = null;

  constructor(
    readonly scope: VenueScope,
    readonly adapters: BrowserVenueIntegrations,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private check(): void {
    if (this.disposed) throw new Error('Venue browser session has been closed');
  }

  async load(): Promise<void> {
    this.check();
    const [policy, horizon] = await Promise.all([
      this.adapters.programme.policy(this.scope.zoneId),
      this.adapters.programme.horizon(this.scope.zoneId),
    ]);
    if (!policy.revision || !policy.rightsAttested)
      throw new Error('A current approved venue policy is required');
    const sections = [horizon.committed, horizon.prepared, horizon.planned, horizon.fallback];
    if (!horizon.committed.length || sections.some((part) => !Array.isArray(part)
      || part.length > MAX_HORIZON) ||
      sections.flat().some((ref) => !ref || !ref.id || !ref.revision))
      throw new Error('Programme has missing or unversioned local music');
    // Committed order is immutable on this browser until a fenced plan revision arrives.
    this.policy = policy;
    this.horizon = horizon;
  }

  private async bind(ref: CanonicalTrack, requireOpen = true): Promise<void> {
    const policy = this.policy;
    if (!policy) throw new Error('No verified venue policy');
    const facts = await this.adapters.media.eligible(this.scope.zoneId, ref.id, ref.revision);
    if (facts.id !== ref.id || !recordingAllowed(policy, facts, this.clock(), { requireOpen }))
      throw new Error('Recording missing, unverified or blocked by venue policy');
    const file = await this.adapters.media.resolveFile(this.scope.zoneId, ref.id, ref.revision);
    if (!(file instanceof File)) throw new Error('Exact recording requires permission on this tablet');
    this.adapters.audio.bindLocal({
      id: ref.id, title: ref.id, artist: facts.artist, file,
      revision: ref.revision, permitted: true,
    });
    this.facts.set(ref.id, facts);
    await this.adapters.audio.prepare(ref.id);
  }

  /** Must be invoked from an on-device user tap, never remote automatic autoplay. */
  async start(): Promise<void> {
    this.check();
    if (this.startInFlight) throw new Error('Venue start is already preparing');
    if (this.state === 'running') throw new Error('This speaker already owns a programme');
    const revision = ++this.playbackEpoch;
    this.startInFlight = true;
    try {
      // This must be initiated within the actual on-device tap gesture.
      const activation = this.adapters.audio.unlock();
      if (!await activation)
        throw new Error('The browser requires a tap and a permitted audio output');
      if (!this.adapters.audio.snapshot().foreground)
        throw new Error('The venue browser must remain visible to start playback');
      await this.load();
      const policy = this.policy!;
      if (!venueOpen(policy, this.clock())) throw new Error('The venue is currently closed');
      if (await this.adapters.media.sourceState(this.scope.zoneId) !== 'connected')
        throw new Error('Authorised local music source is not accessible on this device');
      if (revision !== this.playbackEpoch || this.disposed)
        throw new Error('Venue start cancelled by Stop or device shutdown');
      const lease = await this.adapters.cloud.acquire(this.scope);
      if (!Number.isSafeInteger(lease.generation) || lease.generation <= this.generation
        || lease.expiresAt <= this.clock())
        throw new Error('Unverified, expired or stale Cloud speaker ownership');
      const selected = this.horizon!.committed[0];
      await this.bind(selected);
      if (revision !== this.playbackEpoch || this.disposed)
        throw new Error('Venue start cancelled during local music preparation');
      await this.adapters.audio.start(selected.id, lease.generation);
      if (revision !== this.playbackEpoch || this.disposed) {
        await this.adapters.audio.stop();
        throw new Error('Venue start cancelled during audio activation');
      }
      this.generation = lease.generation;
      this.current = selected;
      this.index = 0;
      this.state = 'running';
      this.issue = null;
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => void this.tick(), 1000);
    } finally {
      this.startInFlight = false;
    }
  }
  private nextCandidate(): CanonicalTrack | null {
    if (!this.horizon) return null;
    const committedNext = this.horizon.committed[this.index + 1];
    if (committedNext) return committedNext;
    const additional = this.horizon.prepared.find((entry) => entry.id !== this.current?.id);
    if (additional) return additional;
    return this.horizon.fallback.find((entry) => entry.id !== this.current?.id) ?? null;
  }

  /** A requested skip may only be invoked by a separately authorised command adapter. */
  async skip(): Promise<void> {
    this.check();
    if (this.state !== 'running') throw new Error('No active speaker session');
    const next = this.nextCandidate();
    if (!next) throw new Error('No locally eligible prepared or fallback music');
    await this.transitionTo(next);
  }

  private async transitionTo(next: CanonicalTrack): Promise<void> {
    if (this.transitionInFlight) throw new Error('Another venue transition is already preparing');
    const previous = this.current;
    const revision = this.playbackEpoch;
    this.transitionInFlight = true;
    try {
      await this.bind(next);
      if (this.disposed || this.playbackEpoch !== revision || this.state !== 'running'
        || this.current !== previous)
        throw new Error('Venue transition cancelled because playback state changed');
      await this.adapters.audio.transition(next.id, 2);
      if (this.disposed || this.playbackEpoch !== revision || this.state !== 'running')
        throw new Error('Venue transition superseded during audio output');
      this.current = next;
      if (this.horizon?.committed[this.index + 1]?.id === next.id) this.index++;
      this.issue = null;
    } finally {
      this.transitionInFlight = false;
    }
  }

  /** UI ticks are best-effort. The browser must remain foreground/awake. */
  async tick(): Promise<void> {
    if (this.runningTick || this.disposed || this.state !== 'running') return;
    this.runningTick = true;
    try {
      const now = this.clock();
      const snapshot = this.adapters.audio.snapshot();
      if (snapshot.phase === 'stopped' || snapshot.phase === 'failed' || snapshot.phase === 'locked') {
        this.state = 'blocked';
        this.issue = 'This browser stopped producing local audio. Recover on the venue device.';
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        return;
      }
      if (!snapshot.foreground || snapshot.phase === 'interrupted') {
        this.state = 'interrupted';
        this.issue = 'This venue browser was interrupted. Recover with an on-device tap.';
        return;
      }
      const currentFacts = this.current && this.facts.get(this.current.id);
      if (!this.policy || !this.current || !currentFacts ||
        !venueOpen(this.policy, now) ||
        !recordingAllowed(this.policy, currentFacts, now)) {
        await this.stop();
        this.state = 'blocked';
        this.issue = 'Venue hours, rights or music policy do not allow playback';
        return;
      }
      const remaining = snapshot.remainingSeconds;
      if (remaining !== undefined && remaining !== null) {
        if (remaining <= LEAD_SECONDS) {
          const next = this.nextCandidate();
          if (next) {
            try { await this.transitionTo(next); }
            catch (error) { this.issue = errorMessage(error); }
          } else {
            this.issue = 'Committed programme ended: no permitted next or fallback recording';
          }
        } else if (remaining <= PREFLIGHT_SECONDS) {
          const next = this.nextCandidate();
          // Decoder work is asynchronous and capped; Agent 01 worker preflight will
          // replace this simple lookahead for production continuous DJ playback.
          if (next && !this.facts.has(next.id)) {
            try { await this.bind(next); }
            catch (error) { this.issue = errorMessage(error); }
          }
        }
      }
      if (snapshot.online && now - this.lastReportAt >= REPORT_INTERVAL_MS) {
        this.lastReportAt = now;
        // Cloud receives only metadata: no File, local path, PCM or source handle.
        try {
          await this.adapters.cloud.report({
            ...this.scope, generation: this.generation, phase: snapshot.phase,
            foreground: snapshot.foreground, sourceReady: true,
            outputOperatorCheckedAt: snapshot.operatorCheckedAt,
            lastSeenEpochMs: now,
            // The port only knows canonical IDs; never report song counts as minutes.
            committedMinutes: 0, preparedMinutes: snapshot.preparedMinutes, plannedMinutes: 0,
          });
        } catch { /* music is locally owned; network loss must not stop a live browser */ }
      }
    } catch (error) { this.issue = errorMessage(error); }
    finally { this.runningTick = false; }
  }

  async pause(): Promise<void> {
    if (this.state !== 'running') throw new Error('No playing venue to pause');
    await this.adapters.audio.pause();
    this.state = 'paused';
  }

  /** On-device interaction required. Never resumes automatically after OS suspension. */
  async resume(): Promise<void> {
    if (this.state === 'interrupted')
      throw new Error('This browser lost its playback session. Use Start on the venue device to recheck sources and speaker ownership.');
    if (this.state !== 'paused')
      throw new Error('No paused browser session to resume');
    const facts = this.current && this.facts.get(this.current.id);
    if (!this.policy || !this.current || !facts ||
      !recordingAllowed(this.policy, facts, this.clock()))
      throw new Error('Cannot resume outside approved venue hours or music policy');
    await this.adapters.audio.resume();
    this.state = 'running';
  }

  async stop(): Promise<void> {
    ++this.playbackEpoch;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.adapters.audio.stop();
    this.state = 'idle';
    this.current = null;
    this.index = -1;
  }

  status(): ProgrammeStatus {
    return {
      state: this.state, generation: this.generation, current: this.current?.id ?? null,
      committed: this.horizon?.committed.map((entry) => entry.id) ?? [],
      prepared: this.horizon?.prepared.map((entry) => entry.id) ?? [],
      planned: this.horizon?.planned.map((entry) => entry.id) ?? [],
      offline: typeof navigator !== 'undefined' && navigator.onLine === false,
      issue: this.issue,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.stop();
    await this.adapters.audio.dispose();
    this.disposed = true;
  }
}
