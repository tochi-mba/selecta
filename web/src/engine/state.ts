/** The truthful state vocabulary for the browser audio runtime (ADR-0457, ADR-0460).
 *
 * The phase says what the engine is doing. The output status says what is known about whether a
 * person can actually hear it. They are kept apart on purpose: 'playing' never implies audible.
 * Output status only ever moves down on evidence (an interruption, a route change, a hidden tab);
 * the single way up is a person confirming the sound check (ADR-0460), through `confirmHeard`.
 * Analyser data, probe passes and running graphs never upgrade it.
 */

export type EnginePhase = 'idle' | 'loading' | 'playing' | 'paused';

/** What is known about the physical output right now.
 *
 * - 'output_unverified': nothing has shown that sound reaches a speaker, or the route changed.
 * - 'verified_at': a person confirmed they heard the check tone at this time (seconds since epoch).
 *   It records when, never a standing guarantee.
 * - 'uncertain': the tab is hidden, the wake lock went, or the lease lapsed; nobody can tell.
 * - 'interrupted': the system took the sound (a call, another app, an OS interruption).
 */
export type OutputStatus =
  | { status: 'output_unverified' }
  | { status: 'verified_at'; at: number }
  | { status: 'uncertain' }
  | { status: 'interrupted' };

/** A capability this device honestly does not have: a first-class answer with a reason, never a
 * silent fallback and never an exception thrown into the audio graph (ADR-0459). */
export type UnsupportedHere = { state: 'unsupported_here'; reason: string };

export type EngineState = {
  phase: EnginePhase;
  output: OutputStatus;
  /** A plain sentence for the member, or ''. */
  notice: string;
};

/** Evidence can only move the status down this ladder; see downgradeOutput. */
const RANK: Record<OutputStatus['status'], number> = {
  verified_at: 3,
  output_unverified: 2,
  uncertain: 1,
  interrupted: 0,
};

/** Every output downgrade a listener may report. 'verified_at' is deliberately absent: no event
 * handler can claim audibility. */
export type OutputDowngrade = Exclude<OutputStatus, { status: 'verified_at' }>;

export type EngineStore = {
  get(): EngineState;
  /** Change the phase or the notice. The output status has its own guarded paths below. */
  set(changes: Partial<Omit<EngineState, 'output'>>): void;
  /** Move the output status down on evidence. A move up the ladder is ignored, so a late event
   * can never make the display more confident than the newest evidence allows. A move to the
   * same rank is applied, so a fresh reason replaces a stale one. */
  downgradeOutput(next: OutputDowngrade, notice?: string): void;
  /** The one way up: a person confirmed they heard the check tone (ADR-0460). */
  confirmHeard(at: number): void;
  subscribe(watch: (state: EngineState) => void): () => void;
};

// A sound check can use a short-lived engine, while playback uses a separate engine. They still
// feed the same physical output in this tab, so a person's answer and any device-wide output loss
// (a hidden tab, a route change, a released wake lock) must reach every live engine. An
// 'interrupted' context is not device-wide: it belongs to the one engine whose AudioContext the
// system suspended, so it never travels. This is page memory only: a reload starts unverified.
const outputStores = new Set<EngineStore>();
let deviceOutputConfirmedAt: number | null = null;
let detachDeviceOutputWatchers: (() => void) | null = null;

/** The sentence for a downgrade: the same words for every engine, or worked out per engine. */
export type DowngradeNotice = string | ((store: EngineStore) => string | undefined);

export const BACKGROUND_TAB_NOTICE = 'This tab went to the background, so SelectaDJ cannot promise the sound still reaches your speakers.';
export const OUTPUT_CHANGED_NOTICE = 'Audio output changed. Check your speakers or headphones before playing on.';

/** A notice only engines that are playing should show: an idle engine has no sound to promise.
 * `always` names one engine that gets it regardless (its own event, its own wording). */
export function noticeWhilePlaying(text: string, always?: EngineStore): DowngradeNotice {
  return (store) => (store === always || store.get().phase === 'playing' ? text : undefined);
}

function watchDeviceOutput(): void {
  if (detachDeviceOutputWatchers) return;
  const watchedDocument = typeof document === 'undefined' ? null : document;
  const watchedDevices = typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null;
  const onVisibility = () => {
    if (watchedDocument?.visibilityState !== 'hidden') return;
    downgradeDeviceOutput({ status: 'uncertain' }, noticeWhilePlaying(BACKGROUND_TAB_NOTICE));
  };
  const onDeviceChange = () => downgradeDeviceOutput({ status: 'output_unverified' }, OUTPUT_CHANGED_NOTICE);
  watchedDocument?.addEventListener('visibilitychange', onVisibility);
  watchedDevices?.addEventListener('devicechange', onDeviceChange);
  detachDeviceOutputWatchers = () => {
    watchedDocument?.removeEventListener('visibilitychange', onVisibility);
    watchedDevices?.removeEventListener('devicechange', onDeviceChange);
  };
}

/** Join an engine to this tab's shared output; it starts confirmed if a person already confirmed. */
export function registerDeviceOutputStore(store: EngineStore): () => void {
  outputStores.add(store);
  if (deviceOutputConfirmedAt !== null) store.confirmHeard(deviceOutputConfirmedAt);
  return () => outputStores.delete(store);
}

/** A person heard the check tone (ADR-0460): every live engine on this tab, and any made later
 * until the next device-wide downgrade, shares that answer. */
export function confirmDeviceOutput(at: number): void {
  watchDeviceOutput();
  deviceOutputConfirmedAt = at;
  for (const store of outputStores) store.confirmHeard(at);
}

/** Move the output status down on evidence. Device-wide evidence reaches every live engine and
 * forgets the shared confirmation; 'interrupted' stays with `source`, the engine it happened to.
 * `source` also gets the downgrade when it is a standalone store (embedders and tests). */
export function downgradeDeviceOutput(next: OutputDowngrade, notice?: DowngradeNotice, source?: EngineStore): void {
  const noticeFor = (store: EngineStore) => (typeof notice === 'function' ? notice(store) : notice);
  if (next.status === 'interrupted') {
    source?.downgradeOutput(next, noticeFor(source));
    return;
  }
  deviceOutputConfirmedAt = null;
  let includedSource = false;
  for (const store of outputStores) {
    if (store === source) includedSource = true;
    store.downgradeOutput(next, noticeFor(store));
  }
  if (source && !includedSource) source.downgradeOutput(next, noticeFor(source));
}

/** TEST ONLY: forget every registered engine, the shared confirmation and the page watchers, so
 * one test's confirmation never leaks into the next. Product code never calls this. */
export function resetDeviceOutputForTests(): void {
  outputStores.clear();
  deviceOutputConfirmedAt = null;
  detachDeviceOutputWatchers?.();
  detachDeviceOutputWatchers = null;
}

export function createEngineStore(initial?: Partial<EngineState>): EngineStore {
  let state: EngineState = {
    phase: 'idle',
    output: { status: 'output_unverified' },
    notice: '',
    ...initial,
  };
  const watchers = new Set<(state: EngineState) => void>();
  const emit = () => {
    for (const watch of [...watchers]) watch(state);
  };
  return {
    get: () => state,
    set(changes) {
      state = { ...state, ...changes };
      emit();
    },
    downgradeOutput(next, notice) {
      if (RANK[next.status] > RANK[state.output.status]) return;
      state = { ...state, output: next, ...(notice === undefined ? {} : { notice }) };
      emit();
    },
    confirmHeard(at) {
      state = { ...state, output: { status: 'verified_at', at } };
      emit();
    },
    subscribe(watch) {
      watchers.add(watch);
      return () => watchers.delete(watch);
    },
  };
}
