import { createContext } from 'react';

/** True where every transition is worked out live as the mix plays (the browser runtime, ADR-0459):
 * there is nothing to render ahead, so no render control and no render count, and each transition
 * says how it is made instead. Read by the editor's views only; the shared ui modules take it as a
 * prop, since they keep no state of their own. */
export const TransitionsWorkedOutLive = createContext(false);
export const LIVE_SEAM_WORDS = 'Worked out in your browser as the mix plays.';

/** What a transition really played on this device this visit, in words (cloud.browser_moves):
 * the move and its length, or the fade it fell back to and why. Never stored: a reload starts
 * with nothing played. */
export type PlayedSeam = { label: string; detail: string | null; fellBack: boolean };
/** Played transitions by the two songs they joined, `${fromSongId}>${intoSongId}`. */
export const PlayedTransitions = createContext<Record<string, PlayedSeam>>({});
export const playedKey = (from: number, into: number) => `${from}>${into}`;
