/** Prepares stems ahead of the seams that need them (ADR-0459 Tier 3).
 *
 * The scheduler plans a seam about 45 s before a song ends, too late to separate then, so the
 * windows the next transitions need are queued when each song starts: the current song's tail
 * first, then the next song's head. One job runs at a time. Work pauses while the tab is hidden,
 * on low battery, on a thermal slowdown, or when told to; a running job is allowed to finish.
 *
 * The seam path only ever calls `readStems`, which reads the cache and never runs inference.
 */

import type { CacheScope } from '../../media/store';
import type { StemSeparator } from '../workers/stemsSpawn';
import { defaultStemCacheIo, readStemWindow, stemCacheKey, writeStemWindow, type StemCacheIo, type StemSet } from './cache';
import { armCrashGuard, disarmCrashGuard, ThermalWatch } from './gate';
import { observable, type Observable } from './observable';
import { STEM_MODEL } from './model';
import { cutStereoWindow, transitionWindows, type AudioLike, type PlannedWindow, type StemSongRef, type StemWindow } from './windows';

export type StemWindowFailure = 'not_connected' | 'separation_failed' | 'storage_full' | 'cache_unavailable';

export type StemWindowStatus =
  | { state: 'queued' }
  | { state: 'running'; progress: number }
  | { state: 'ready' }
  | { state: 'failed'; why: StemWindowFailure; detail?: string }
  | { state: 'skipped'; why: string };

export type PrefetchPauseReason = 'hidden' | 'battery' | 'thermal' | 'manual';

export interface PrefetchWindowEntry {
  id: string;
  songId: number;
  window: StemWindow;
  status: StemWindowStatus;
}

export interface PrefetchState {
  /** In the order they are needed. */
  windows: PrefetchWindowEntry[];
  paused: { reason: PrefetchPauseReason; message: string }[];
}

export const HIDDEN_MESSAGE = 'Stems are prepared while this tab is open';

export interface StemPrefetcherOptions {
  separate: StemSeparator;
  /** Decoded audio for a song, or null when its file is not connected on this device this visit. */
  getAudio: (songId: number, signal: AbortSignal) => Promise<AudioLike | null>;
  scope: CacheScope | (() => CacheScope);
  /** Device gate (capability, crash guard, model present). Not ok skips the queue with the reason. */
  canRun?: () => { ok: true } | { ok: false; why: string };
  io?: StemCacheIo;
  /** How many upcoming transitions to prepare. */
  transitions?: number;
  /** The device's benchmarked speed, for the thermal watch; null turns the watch off. */
  expectedSecondsPerAudioSecond?: number | null;
  guard?: { arm: () => void; disarm: () => void };
  /** The document whose visibility pauses work; null to ignore visibility. */
  document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
  clock?: () => number;
}

export function windowId(songId: number, window: Pick<StemWindow, 'startMs' | 'endMs'>): string {
  return `${songId}:${window.startMs}-${window.endMs}`;
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

export class StemPrefetcher {
  private readonly current = observable<PrefetchState>({ windows: [], paused: [] });
  readonly state: Observable<PrefetchState> = this.current;
  private readonly options: StemPrefetcherOptions;
  private readonly io: StemCacheIo;
  private readonly guard: { arm: () => void; disarm: () => void };
  private readonly thermal: ThermalWatch | null;
  private readonly clock: () => number;
  private planned: PlannedWindow[] = [];
  private readonly songs = new Map<number, StemSongRef>();
  private running: { id: string; controller: AbortController } | null = null;
  private readonly pauses = new Map<PrefetchPauseReason, string>();
  private readonly onVisibility = () => this.syncVisibility();
  private disposed = false;

  constructor(options: StemPrefetcherOptions) {
    this.options = options;
    this.io = options.io ?? defaultStemCacheIo;
    this.guard = options.guard ?? { arm: () => armCrashGuard(), disarm: () => disarmCrashGuard() };
    this.thermal = options.expectedSecondsPerAudioSecond ? new ThermalWatch(options.expectedSecondsPerAudioSecond) : null;
    this.clock = options.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const doc = options.document === undefined ? (typeof document !== 'undefined' ? document : null) : options.document;
    if (doc) {
      doc.addEventListener('visibilitychange', this.onVisibility);
      this.syncVisibility();
    }
  }

  private get doc() {
    return this.options.document === undefined ? (typeof document !== 'undefined' ? document : null) : this.options.document;
  }

  private scope(): CacheScope {
    return typeof this.options.scope === 'function' ? this.options.scope() : this.options.scope;
  }

  private syncVisibility(): void {
    if (this.doc?.hidden) this.pause('hidden', HIDDEN_MESSAGE);
    else this.resume('hidden');
  }

  /** Queue the windows for the next transitions from `currentIndex`. Call when each song starts.
   * Windows no longer needed are dropped (a running one is cancelled); failed ones retry. */
  plan(songs: readonly StemSongRef[], currentIndex: number): void {
    if (this.disposed) return;
    for (const song of songs) this.songs.set(song.songId, song);
    // A song shorter than both windows needs one window for both of its seams.
    const seen = new Set<string>();
    this.planned = transitionWindows(songs, currentIndex, this.options.transitions ?? 2).filter(({ song, window }) => {
      const id = windowId(song.songId, window);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const before = new Map(this.current.get().windows.map((entry) => [entry.id, entry]));
    const windows = this.planned.map(({ song, window }) => {
      const id = windowId(song.songId, window);
      const kept = before.get(id);
      const status: StemWindowStatus = kept && (kept.status.state === 'ready' || kept.status.state === 'running')
        ? kept.status
        : { state: 'queued' };
      return { id, songId: song.songId, window, status };
    });
    if (this.running && !windows.some((entry) => entry.id === this.running?.id)) this.running.controller.abort();
    this.publish({ windows });
    void this.pump();
  }

  pause(reason: PrefetchPauseReason, message = 'Stem splitting is paused'): void {
    this.pauses.set(reason, message);
    this.publishPauses();
  }

  resume(reason: PrefetchPauseReason): void {
    if (!this.pauses.delete(reason)) return;
    if (reason === 'thermal') this.thermal?.reset();
    this.publishPauses();
    void this.pump();
  }

  /** Stop everything: the running job is cancelled and the queue emptied. */
  cancel(): void {
    this.running?.controller.abort();
    this.planned = [];
    this.publish({ windows: [] });
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.doc?.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Cache read only, for the seam provider: a miss is null and never starts a separation. */
  async readStems(song: number | Pick<StemSongRef, 'songId' | 'contentSha256'>, window: Pick<StemWindow, 'startMs' | 'endMs'>): Promise<StemSet | null> {
    const ref = typeof song === 'number' ? this.songs.get(song) ?? { songId: song, contentSha256: null } : song;
    try {
      return await readStemWindow(ref, window, this.scope(), this.io);
    } catch {
      return null;
    }
  }

  private publish(change: Partial<PrefetchState>): void {
    this.current.set({ ...this.current.get(), ...change });
  }

  private publishPauses(): void {
    this.publish({ paused: [...this.pauses].map(([reason, message]) => ({ reason, message })) });
  }

  private setStatus(id: string, status: StemWindowStatus): void {
    const windows = this.current.get().windows;
    if (!windows.some((entry) => entry.id === id)) return;
    this.publish({ windows: windows.map((entry) => (entry.id === id ? { ...entry, status } : entry)) });
  }

  private async pump(): Promise<void> {
    if (this.running || this.pauses.size > 0 || this.disposed) return;
    const next = this.current.get().windows.find((entry) => entry.status.state === 'queued');
    if (!next) return;
    const gate = this.options.canRun?.() ?? { ok: true as const };
    if (!gate.ok) {
      this.publish({
        windows: this.current.get().windows.map((entry) => (entry.status.state === 'queued' ? { ...entry, status: { state: 'skipped', why: gate.why } } : entry)),
      });
      return;
    }
    const song = this.songs.get(next.songId);
    if (!song) return;
    const controller = new AbortController();
    this.running = { id: next.id, controller };
    try {
      await this.runJob(next.id, song, next.window, controller.signal);
    } finally {
      this.running = null;
    }
    void this.pump();
  }

  private async runJob(id: string, song: StemSongRef, window: StemWindow, signal: AbortSignal): Promise<void> {
    const scope = this.scope();
    try {
      if (await this.io.read(stemCacheKey(song, window, scope))) {
        this.setStatus(id, { state: 'ready' });
        return;
      }
    } catch {
      // A cache that cannot be read is a miss.
    }
    this.setStatus(id, { state: 'running', progress: 0 });
    let audio: AudioLike | null = null;
    try {
      audio = await this.options.getAudio(song.songId, signal);
    } catch (error) {
      if (isAbort(error) || signal.aborted) return;
      audio = null;
    }
    if (signal.aborted) return;
    if (!audio) {
      this.setStatus(id, { state: 'failed', why: 'not_connected', detail: "the song isn't connected on this device this visit" });
      return;
    }
    const channels = cutStereoWindow(audio, window, STEM_MODEL.sampleRate);
    const audioSeconds = channels[0].length / STEM_MODEL.sampleRate;
    const started = this.clock();
    this.guard.arm();
    let planes: Float32Array[];
    try {
      const result = await this.options.separate(channels, {
        signal,
        owned: true,
        onProgress: (progress) => this.setStatus(id, { state: 'running', progress: Math.max(0, Math.min(1, progress)) }),
      });
      planes = result.stems;
    } catch (error) {
      if (isAbort(error) || signal.aborted) {
        // A cancelled job that is still planned (paused or replanned) goes back in the queue.
        this.setStatus(id, { state: 'queued' });
        return;
      }
      this.setStatus(id, { state: 'failed', why: 'separation_failed', detail: error instanceof Error ? error.message : String(error) });
      return;
    } finally {
      this.guard.disarm();
    }
    const tookSeconds = Math.max(0, this.clock() - started) / 1000;
    const written = await writeStemWindow(song, window, scope, planes, this.io).catch(() => ({ ok: false as const, why: 'unavailable' as const }));
    if (!written.ok) {
      this.setStatus(id, written.why === 'storage_full'
        ? { state: 'failed', why: 'storage_full', detail: 'this browser has no room left for stems' }
        : { state: 'failed', why: 'cache_unavailable', detail: 'this browser would not keep the stems' });
    } else {
      this.setStatus(id, { state: 'ready' });
    }
    const thermal = this.thermal?.record(audioSeconds, tookSeconds) ?? null;
    if (thermal) this.pause('thermal', thermal);
  }
}
