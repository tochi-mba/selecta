// "A hand-over was heard here" (T-20261125-ebda): told once for each hand-over that really finished
// playing in this tab while the tab was on screen, so the moments that celebrate or follow the first
// one (the first hand-off note, the install offer) wait for the real thing instead of guessing from
// how long something has played.
//
// The players only report here. Nothing in this module touches audio, scheduling, gains, the order
// of hand-overs, who owns the sound or Pause: it is told after the fact and passes it on.

/** One hand-over heard to its end: the place in the mix it came out of and the one it went into,
 * the song ids where the player knows them, and the rendered seam's key in local mode. */
export type HandoffHeard = {
  fromIndex: number;
  intoIndex: number;
  fromSongId?: number;
  intoSongId?: number;
  seamKey?: string | null;
  /** Date.now() when it finished. */
  at: number;
};

const listeners = new Set<(heard: HandoffHeard) => void>();
let last: HandoffHeard | null = null;
let count = 0;

/** Whether the page is on screen now. A tab nobody can see did not let anyone hear the hand-over. */
export function pageOnScreen(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** Said by a player once per hand-over, when it has finished playing here and the page was on screen
 * from its start to its end. */
export function noteHandoffHeard(heard: Omit<HandoffHeard, 'at'>): void {
  last = { ...heard, at: Date.now() };
  count += 1;
  for (const listener of Array.from(listeners)) {
    try {
      listener(last);
    } catch {
      // one listener failing must not stop the others hearing it
    }
  }
}

/** Be told about each hand-over heard from now on. Returns a way to stop being told. */
export function onHandoffHeard(listener: (heard: HandoffHeard) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The latest hand-over heard in this visit, or null before the first one. */
export function lastHandoffHeard(): HandoffHeard | null {
  return last;
}

/** How many hand-overs were heard in this visit. */
export function handoffsHeard(): number {
  return count;
}

/** For tests. */
export function resetHandoffHeard(): void {
  last = null;
  count = 0;
  lastHidden = -Infinity;
  listeners.clear();
}

/** When the page last went off screen (Date.now()), watched once for the whole visit. */
let lastHidden = -Infinity;
let hidingWatched = false;
function watchHiding() {
  if (hidingWatched || typeof document === 'undefined') return;
  hidingWatched = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lastHidden = Date.now();
  });
}

/** Watches a player's published states for one hand-over at a time: it starts when a state is in
 * the hand-over and ends when a later state, still playing, is out of it with the next song current.
 * The page has to be on screen at every state seen in between; a pause, a stop or a jump elsewhere
 * forgets it. Local mode makes the next song current at the switch point while the hand-over's tail
 * still plays, so the song after the one it started from still belongs to the same hand-over. Pure,
 * so both players share it and tests drive it. */
export function handoffWatcher(report: (heard: Omit<HandoffHeard, 'at'>) => void) {
  watchHiding();
  let open: { fromIndex: number; fromSongId?: number; onScreen: boolean; since: number } | null = null;
  return (state: { phase: string; position: number; inSeam: boolean; songId?: number; seamKey?: string | null }, onScreen: boolean, now = Date.now()) => {
    if (state.phase !== 'playing') {
      open = null;
      return;
    }
    if (state.inSeam) {
      if (!open || (state.position !== open.fromIndex && state.position !== open.fromIndex + 1)) {
        open = { fromIndex: state.position, fromSongId: state.songId, onScreen, since: now };
      } else if (!onScreen) {
        open.onScreen = false;
      }
      return;
    }
    const was = open;
    open = null;
    // a player may not publish while the tab is hidden, so a hiding in between counts too
    if (!was || !was.onScreen || !onScreen || lastHidden >= was.since || state.position !== was.fromIndex + 1) return;
    report({ fromIndex: was.fromIndex, intoIndex: state.position, fromSongId: was.fromSongId, intoSongId: state.songId, seamKey: state.seamKey ?? null });
  };
}
