/** The local-first onboarding spine's state (ADR-0463 BF-0463-02).
 *
 * Connect music, check it on this device, check the device can play, choose where the sound
 * goes, start sound, hear the check tone, keep the screen awake, then optionally pair a remote.
 * Each step's outcome is recorded truthfully: 'done' means the member really did it, 'skipped'
 * means they chose not to (where skipping is honest), and 'unverified' and 'not_here' say why a
 * step could not finish. The record is kept per account in localStorage, inside try/catch, so a
 * member who closes the tab picks up where they were; a browser that refuses storage just starts
 * again, which costs a minute and never a claim.
 */

export const STEPS = ['connect', 'verify', 'capability', 'output', 'start', 'soundcheck', 'keepawake', 'remote'] as const;
export type StepId = (typeof STEPS)[number];

/** done: really done. skipped: the member chose not to, where that is honest. unverified: the sound
 * check was not confirmed by a person. not_here: this device cannot do it (the controller fork). */
export type StepOutcome = 'done' | 'skipped' | 'unverified' | 'not_here';

export type OutputRoute = 'built_in' | 'headphones' | 'bluetooth' | 'hdmi_dock' | 'system';

export type ImportTally = { imported: number; duplicates: number; failed: number; skipped: number; cancelled: boolean; paused: boolean };

export type SpineState = {
  version: 1;
  step: StepId;
  outcomes: Partial<Record<StepId, StepOutcome>>;
  /** The last import's honest summary, so a resumed verify step can still say what landed. */
  imported?: ImportTally;
  /** The probe's answer; a failing probe carries its reason into the controller fork. */
  capability?: { ok: boolean; reason?: string };
  output?: OutputRoute;
  /** Seconds since epoch when a person said they heard the check tone; absent until then. */
  heardAt?: number;
  wakeLock?: 'held' | 'unsupported' | 'refused';
  finished?: boolean;
  /** The member pressed Finish later: this browser stops opening the spine by itself, and it stays
   * reachable from Make a Mix until it is finished. */
  later?: boolean;
};

export const FRESH: SpineState = { version: 1, step: 'connect', outcomes: {} };

export const STORAGE_PREFIX = 'selecta.onboarding.';
export const storageKey = (workspaceId: string) => `${STORAGE_PREFIX}${workspaceId}`;

export type KeyValue = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** The browser's localStorage, or null where reaching it throws (private modes, blocked data). */
export function browserStorage(): KeyValue | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isStep(value: unknown): value is StepId {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value);
}

/** The saved state for this account, or a fresh one. Anything unreadable starts fresh. */
export function loadState(storage: KeyValue | null, workspaceId: string): SpineState {
  try {
    const raw = storage?.getItem(storageKey(workspaceId));
    if (!raw) return FRESH;
    const saved = JSON.parse(raw) as Partial<SpineState>;
    if (saved.version !== 1 || !isStep(saved.step)) return FRESH;
    const state: SpineState = { ...FRESH, ...saved, outcomes: { ...(saved.outcomes ?? {}) } } as SpineState;
    // A sound check is only ever done because a person said so; a saved 'done' without the time
    // they said it is not trusted.
    if (state.outcomes.soundcheck === 'done' && typeof state.heardAt !== 'number') {
      state.outcomes = { ...state.outcomes, soundcheck: 'unverified' };
    }
    return state;
  } catch {
    return FRESH;
  }
}

export function saveState(storage: KeyValue | null, workspaceId: string, state: SpineState): void {
  try {
    storage?.setItem(storageKey(workspaceId), JSON.stringify(state));
  } catch {
    // Storage full or refused: the flow still works for this visit.
  }
}

/** Whether this account already went through the spine on this browser. */
export function onboardingFinished(workspaceId: string, storage: KeyValue | null = browserStorage()): boolean {
  return loadState(storage, workspaceId).finished === true;
}

/** Whether the member put the spine off on this browser (Finish later). A put-off spine keeps its
 * step and outcomes, so opening it again carries on where they were. */
export function onboardingPutOff(workspaceId: string, storage: KeyValue | null = browserStorage()): boolean {
  const state = loadState(storage, workspaceId);
  return state.later === true && state.finished !== true;
}

export function nextStep(step: StepId): StepId | null {
  const at = STEPS.indexOf(step);
  return at >= 0 && at < STEPS.length - 1 ? STEPS[at + 1] : null;
}

/** The step Back returns to, or null on the first. A device that forked to the controller skips
 * back over the playing steps it cannot do; verify is skipped while nothing was connected. Pure. */
export function previousStep(state: SpineState): StepId | null {
  let at = STEPS.indexOf(state.step) - 1;
  while (at >= 0) {
    const step = STEPS[at];
    const outcome = state.outcomes[step];
    const pointless = outcome === 'not_here' || (step === 'verify' && state.outcomes.connect === 'skipped');
    if (!pointless) return step;
    at -= 1;
  }
  return null;
}

/** Record a step's outcome and move on to the next step (or finish after the last). */
export function settle(state: SpineState, step: StepId, outcome: StepOutcome, changes: Partial<SpineState> = {}): SpineState {
  const next = nextStep(step);
  return {
    ...state,
    ...changes,
    outcomes: { ...state.outcomes, ...(changes.outcomes ?? {}), [step]: outcome },
    step: next ?? step,
    finished: next === null ? true : state.finished,
  };
}

/** An import finished after the member may have moved on ("Continue while it finishes").
 * Past verify with no outcome yet: verify is 'done' only if something really landed (new or
 * already there), else 'skipped'. Still on verify: only the tally is kept, because the live step
 * settles itself when the member presses Continue. The tally is always kept and the step never
 * moves. Pure. */
export function settleVerifyLater(state: SpineState, tally: ImportTally): SpineState {
  const { imported, duplicates, failed, skipped, cancelled, paused } = tally;
  const next: SpineState = { ...state, imported: { imported, duplicates, failed, skipped, cancelled, paused } };
  const past = state.finished === true || STEPS.indexOf(state.step) > STEPS.indexOf('verify');
  if (past && state.outcomes.verify === undefined) {
    next.outcomes = { ...state.outcomes, verify: imported + duplicates > 0 ? 'done' : 'skipped' };
  }
  return next;
}

/** Fold a finished import into this account's saved spine state, even with the spine unmounted.
 * Idempotent: saving the same summary twice writes nothing the second time. */
export function recordImportOutcome(storage: KeyValue | null, workspaceId: string, summary: ImportTally): void {
  const before = loadState(storage, workspaceId);
  const after = settleVerifyLater(before, summary);
  if (JSON.stringify(after) !== JSON.stringify(before)) saveState(storage, workspaceId, after);
}

/** The capability check failed: every playing step becomes not_here, with the reason kept, and the
 * flow goes straight to the remote step. It never loops back to a check this device cannot pass. */
export function forkToController(state: SpineState, reason: string): SpineState {
  return {
    ...state,
    capability: { ok: false, reason },
    outcomes: { ...state.outcomes, capability: 'not_here', output: 'not_here', start: 'not_here', soundcheck: 'not_here', keepawake: 'not_here' },
    step: 'remote',
  };
}

/** The member skipped the device check: the playing steps are skipped too, honestly marked. */
export function skipPlayback(state: SpineState): SpineState {
  return {
    ...state,
    outcomes: { ...state.outcomes, capability: 'skipped', output: 'skipped', start: 'skipped', soundcheck: 'skipped', keepawake: 'skipped' },
    step: 'remote',
  };
}

export const STEP_TITLES: Record<StepId, string> = {
  connect: 'Connect your music',
  verify: 'Check your music',
  capability: 'Check this device',
  output: 'Check the sound output',
  start: 'Start sound',
  soundcheck: 'Sound check',
  keepawake: 'Keep the screen awake',
  remote: 'Control from your phone',
};
