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
