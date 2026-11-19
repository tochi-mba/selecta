import type { CrashGuardState, Observable, PrefetchState, StemModelState } from '../../dsp/stems';
import { playedKey } from '../../views/liveTransitions';
import type { PauseReason, SplitterState, StemsActions, StemsRole, StemsSnapshot, StemsStore, WindowStatus } from './types';

/** What the engine knows, gathered for one snapshot (dsp/stems: model manager, prefetcher, gate). */
export type EngineFacts = {
  /** The capability's reason when the stem model may not run anywhere yet (its licence review). */
  licenceHold: string | null;
  /** Any other reason this device can't split stems (no WebGPU and WASM too slow, budget floor). */
  deviceCannot: string | null;
  crash: CrashGuardState;
  model: StemModelState;
  /** The published model's size, or null when no model has been published. */
  artefactBytes: number | null;
  /** A download the member paused (the manager aborts it; this remembers it was a pause). */
  downloadPaused: boolean;
  prefetch: PrefetchState | null;
  /** The mix's song ids in order, to name each transition by its two songs. */
  programme: readonly number[];
  role: StemsRole;
  metered: boolean | null;
};

/** Unpacked, the model needs roughly its own size again beside the download while it loads. */
const NEED_FACTOR = 2;

/** The splitter as the stems surfaces show it. The licence hold comes first: until it lifts there
 * is nothing to offer or explain (ADR-0459). */
export function splitterFrom(facts: EngineFacts): SplitterState {
  if (facts.licenceHold) return { state: 'unsupported', code: 'licence', reason: facts.licenceHold };
  if (!facts.crash.clear) return { state: 'unsupported', code: 'crash_guard', reason: facts.crash.reason };
  if (facts.deviceCannot) return { state: 'unsupported', code: 'no_webgpu_wasm_slow', reason: facts.deviceCannot };
  if (facts.artefactBytes === null) return { state: 'unsupported', code: 'other', reason: 'the stem splitter isn’t published yet' };
  const bytes = facts.artefactBytes;
  const paused = facts.prefetch?.paused.find((entry) => entry.reason !== 'manual');
  switch (facts.model.kind) {
    case 'ready':
      return paused ? { state: 'paused', why: paused.reason as PauseReason } : { state: 'ready', bytes, implementation: 'htdemucs-onnx-v1' };
    case 'downloading':
      return { state: 'downloading', received: facts.model.received, total: facts.model.total, paused: false };
    case 'failed':
      if (facts.model.why === 'not_published') return { state: 'unsupported', code: 'other', reason: 'the stem splitter isn’t published yet' };
      if (facts.model.why === 'unavailable') return { state: 'unsupported', code: 'other', reason: 'this browser can’t keep files for SelectaDJ' };
      return { state: 'failed', why: facts.model.why === 'storage_full' ? 'storage_full' : facts.model.why === 'checksum' ? 'checksum' : 'network', detail: facts.model.detail };
    default:
      if (facts.downloadPaused && facts.model.partialBytes) {
        return { state: 'downloading', received: facts.model.partialBytes, total: bytes, paused: true };
      }
      return { state: 'absent', bytes, needBytes: bytes * NEED_FACTOR };
  }
}

/** Each transition's readiness from its two windows: the outgoing song's tail and the incoming
 * song's head. Ready only when both are; the first failure or skip says why. */
export function windowsFrom(prefetch: PrefetchState | null, programme: readonly number[]): Record<string, WindowStatus> {
  const windows: Record<string, WindowStatus> = {};
  if (!prefetch) return windows;
  const find = (songId: number, part: 'tail' | 'head') => prefetch.windows.find((entry) => entry.songId === songId && entry.window.role === part)?.status;
  for (let at = 0; at + 1 < programme.length; at += 1) {
    const from = programme[at];
    const into = programme[at + 1];
    const both = [find(from, 'tail'), find(into, 'head')];
    if (both.some((status) => !status)) continue;
    const [tail, head] = both as NonNullable<(typeof both)[number]>[];
    const failed = [tail, head].find((status) => status.state === 'failed' || status.state === 'skipped');
    let status: WindowStatus;
    if (failed && failed.state === 'failed') status = { state: 'failed', why: failed.detail ?? failed.why };
    else if (failed && failed.state === 'skipped') status = { state: 'skipped', why: failed.why };
    else if (tail.state === 'ready' && head.state === 'ready') status = { state: 'ready' };
    else if (tail.state === 'running' || head.state === 'running') {
      const progress = (s: typeof tail) => (s.state === 'ready' ? 1 : s.state === 'running' ? s.progress : 0);
      status = { state: 'running', progress: (progress(tail) + progress(head)) / 2 };
    } else status = { state: 'queued' };
    windows[playedKey(from, into)] = status;
  }
  return windows;
}

export function snapshotFrom(facts: EngineFacts): StemsSnapshot {
  return { splitter: splitterFrom(facts), windows: windowsFrom(facts.prefetch, facts.programme), metered: facts.metered, role: facts.role };
}

/** A StemsStore over the engine's observables. `facts` reads them fresh; `sources` are what to
 * subscribe to so a change anywhere redraws. The snapshot object only changes when its content
 * does, as `useSyncExternalStore` needs. */
export function engineStemsStore(facts: () => EngineFacts, sources: readonly Observable<unknown>[], actions: StemsActions): StemsStore & { refresh(): void } {
  let last: StemsSnapshot | null = null;
  let lastText = '';
  const listeners = new Set<() => void>();
  const get = () => {
    const next = snapshotFrom(facts());
    const text = JSON.stringify(next);
    if (text !== lastText || !last) {
      last = next;
      lastText = text;
    }
    return last;
  };
  const notify = () => {
    const before = last;
    if (get() !== before) for (const listener of listeners) listener();
  };
  const unsubscribes: (() => void)[] = [];
  return {
    get,
    subscribe(listener) {
      if (!listeners.size) for (const source of sources) unsubscribes.push(source.subscribe(notify));
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) while (unsubscribes.length) unsubscribes.pop()!();
      };
    },
    actions,
    refresh: notify,
  };
}
