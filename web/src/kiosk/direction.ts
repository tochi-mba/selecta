// Which way a new kiosk screen arrives (ADR-0477 "arrive from where you were"). The screens follow
// the player's day in one order, from pairing through getting ready to the music, so a step along
// that order comes in from ahead and a step back (paused, closed, a problem) comes in from behind.
// A redraw of the same screen (a new song, a code that renewed) is not a screen change and moves
// nothing.

import type { KioskScreen } from './state';

type Kind = KioskScreen['kind'];

const ORDER: Record<Kind, number> = {
  unpaired: 0,
  updating: 1,
  closed: 2,
  needs_tap: 3,
  starting: 4,
  problem: 5,
  paused: 5,
  playing: 6,
};

export type Direction = 'forward' | 'back';

/** The way the screen `to` arrives after `from`; null for the first screen or the same one. */
export function screenDirection(from: Kind | null, to: Kind): Direction | null {
  if (from === null || from === to) return null;
  return ORDER[to] >= ORDER[from] ? 'forward' : 'back';
}
