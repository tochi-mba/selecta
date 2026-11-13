// The kiosk's screen, worked out from the zone view and what this player knows about itself
// (ADR-0453 D11 and its S5 matrix). Pure: the same inputs always give the same screen.
//
// S5 matrix, as mapped here:
//   Empty (no playable songs)          -> Closed, "Closed. Music starts soon"
//   Loading                            -> Starting
//   Offline, saved music left          -> Playing from saved music (a tiny mark, no words)
//   Offline, saved music ran out       -> Problem, "The music will be back shortly"
//   Degraded, over seats, licence,
//   payment grace, pilot               -> no change (those fields never reach the kiosk)
//   Silent zone                        -> Problem with its code, never the word "silent"
//   Stopped at close after grace or a
//   pilot end, or a paused extra zone  -> Closed like any other night

import type { KioskView, ZoneState } from './view';

export type KioskFacts = {
  paired: boolean;
  audioUnlocked: boolean;
  online: boolean;
  /** Hours of music this player holds ahead; above zero means it can keep playing offline. */
  savedHoursAhead: number;
  /** A new version is ready and wants to be applied; when it started, for the 60 s limit. */
  updatingSince?: number | null;
  urgentUpdate?: boolean;
  /** Staff asked to see the pairing code again from the hidden panel. */
  showingCode?: boolean;
  now?: number;
};

export type KioskScreen =
  | { kind: 'unpaired' }
  | { kind: 'needs_tap' }
  | { kind: 'closed'; opensAt: string | null; sleep: boolean }
  | { kind: 'starting' }
  | { kind: 'playing'; saved: boolean }
  | { kind: 'paused' }
  | { kind: 'problem'; code: string }
  | { kind: 'updating' };

export const UPDATE_LIMIT_MS = 60_000;

/** Local diagnostic codes, for staff calls. Server codes win when the server sends one. */
export const LOCAL_CODES = {
  savedRanOut: 'K-110', // no connection and no saved music left
  silent: 'K-204', // the server hears no sound from this player
  problem: 'K-300', // the server says the player needs looking at, with no code
} as const;

const CLOSED_LIKE: ZoneState[] = ['closed', 'empty', 'stopped', 'zone_paused'];
const IN_SERVICE: (ZoneState | undefined)[] = ['open', 'starting', undefined];

export function isClosedLike(state: ZoneState | undefined): boolean {
  return state !== undefined && CLOSED_LIKE.includes(state);
}

function updatingNow(view: KioskView, facts: KioskFacts): boolean {
  const since = facts.updatingSince;
  const inTime = since == null || (facts.now ?? Date.now()) - since < UPDATE_LIMIT_MS;
  if (!inTime) return false; // at most 60 s, then back to the music
  if (view.state === 'updating') return true;
  // a local update waits for closed hours unless it is urgent
  return since != null && (facts.urgentUpdate === true || isClosedLike(view.state));
}

export function kioskScreen(view: KioskView, facts: KioskFacts): KioskScreen {
  if (!facts.paired || view.state === 'unpaired' || facts.showingCode) return { kind: 'unpaired' };
  if (updatingNow(view, facts)) return { kind: 'updating' };
  const state = view.state;
  if (state === 'empty') return { kind: 'closed', opensAt: null, sleep: false };
  if (isClosedLike(state)) return { kind: 'closed', opensAt: view.opens_at ?? null, sleep: view.screen_sleep_when_closed === true };
  if (state === 'paused') return { kind: 'paused' };
  // Offline: the last view said in service, so play on from saved music while it lasts.
  if (!facts.online) {
    if (state === 'silent' || state === 'problem') return { kind: 'problem', code: view.diagnostic_code ?? LOCAL_CODES.problem };
    if (facts.savedHoursAhead <= 0) return { kind: 'problem', code: LOCAL_CODES.savedRanOut };
    return facts.audioUnlocked ? { kind: 'playing', saved: true } : { kind: 'needs_tap' };
  }
  if (state === 'silent') {
    // A player that hasn't been tapped can't make sound; asking for the tap is the fix.
    if (!facts.audioUnlocked) return { kind: 'needs_tap' };
    return { kind: 'problem', code: view.diagnostic_code ?? LOCAL_CODES.silent };
  }
  if (state === 'problem') return { kind: 'problem', code: view.diagnostic_code ?? LOCAL_CODES.problem };
  if (IN_SERVICE.includes(state)) {
    if (!facts.audioUnlocked) return { kind: 'needs_tap' };
    if (state === 'starting' || !view.now) return { kind: 'starting' };
    return { kind: 'playing', saved: false };
  }
  return { kind: 'starting' };
}

/** The word the health report sends for a screen (ADR-0445 health `state`). */
export function healthState(screen: KioskScreen): string {
  return screen.kind === 'playing' && screen.saved ? 'playing_saved' : screen.kind;
}
