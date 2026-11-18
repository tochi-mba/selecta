/** Sound-check truth (ADR-0460, BF-0460-03).
 *
 * Output becomes verified only because a person said they heard the check tone, and that answer
 * goes stale the moment anything that could have silenced the sound happens: the output route
 * changed, the tab went to the back, the wake lock went, the device sat idle, or the page was
 * opened again later. A stale check is kept only as "last confirmed at", never as a standing
 * guarantee, and a re-check is offered at the next natural boundary.
 *
 * There is deliberately no function here that takes signal levels, analyser data or a running
 * graph. `heardByPerson` is the only way to fresh, and the venue flow calls it from the "I heard
 * it" button and nowhere else.
 */

/** Why a confirmed check no longer counts. */
export type StaleReason =
  | 'route_changed'
  | 'hidden'
  | 'wake_released'
  | 'interrupted'
  | 'idle'
  | 'new_visit'
  | 'set_start';

/** The moments a re-check is offered. */
export type Boundary = 'set_start' | 'after_idle' | 'route_changed' | 'returned' | 'new_visit';

export type SoundCheckTruth = {
  /** When a person last said they heard it (seconds since epoch), fresh or not. */
  lastHeardAt: number | null;
  /** Whether that answer still stands right now. */
  fresh: boolean;
  staleBecause: StaleReason | null;
  /** The boundary at which a re-check is being offered, or null. */
  offer: Boundary | null;
};

export const NEVER_CHECKED: SoundCheckTruth = { lastHeardAt: null, fresh: false, staleBecause: null, offer: null };

/** No interaction for this long counts as idle: the room may have changed while nobody looked. */
export const IDLE_RECHECK_S = 15 * 60;

/** A check remembered from an earlier visit: shown as history, never trusted. */
export function fromEarlierVisit(lastHeardAt: number | null): SoundCheckTruth {
  if (lastHeardAt === null) return NEVER_CHECKED;
  return { lastHeardAt, fresh: false, staleBecause: 'new_visit', offer: 'new_visit' };
}

/** The one way to fresh: a person pressed "I heard it". */
export function heardByPerson(truth: SoundCheckTruth, at: number): SoundCheckTruth {
  return { ...truth, lastHeardAt: at, fresh: true, staleBecause: null, offer: null };
}

/** A person said they heard nothing: whatever was confirmed before no longer stands. */
export function heardNothing(truth: SoundCheckTruth): SoundCheckTruth {
  return { ...truth, fresh: false, staleBecause: truth.staleBecause, offer: null };
}

const OFFER_FOR: Record<StaleReason, Boundary> = {
  route_changed: 'route_changed',
  hidden: 'returned',
  wake_released: 'returned',
  interrupted: 'returned',
  idle: 'after_idle',
  new_visit: 'new_visit',
  set_start: 'set_start',
};

/** Something happened that could have silenced the sound: the check is stale, a re-check is offered. */
export function invalidate(truth: SoundCheckTruth, reason: StaleReason): SoundCheckTruth {
  if (truth.lastHeardAt === null) return { ...truth, fresh: false, staleBecause: reason, offer: null };
  return { ...truth, fresh: false, staleBecause: reason, offer: OFFER_FOR[reason] };
}

/** A natural boundary arrived. At set start a check confirmed before this session's Start is not
 * enough: the night begins with a fresh one. After idle, the same. Otherwise nothing changes. */
export function atBoundary(truth: SoundCheckTruth, boundary: 'set_start' | 'after_idle', checkedSince: boolean): SoundCheckTruth {
  if (checkedSince && truth.fresh) return truth;
  return invalidate(truth, boundary === 'set_start' ? 'set_start' : 'idle');
}

/** Whether the time since the last interaction makes this an after-idle boundary. */
export function idleLongEnough(lastActivityAt: number, now: number, threshold = IDLE_RECHECK_S): boolean {
  return now - lastActivityAt >= threshold;
}

/** The plain sentence offering a re-check, for each boundary. */
export const OFFER_WORDS: Record<Boundary, string> = {
  set_start: 'The night is starting. Play the check tone once more so someone confirms the sound in the room now.',
  after_idle: 'This tablet sat untouched for a while. Play the check tone to confirm the speaker is still on.',
  route_changed: 'The audio output changed. Play the check tone to confirm sound reaches the right speaker.',
  returned: 'Something interrupted this tablet. Once it is back as it was, play the check tone again.',
  new_visit: 'SelectaDJ was opened again. A check from before does not count; play the check tone to confirm sound now.',
};
