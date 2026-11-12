import type { NowState } from '../player';

/** r8c: the music clock moves App 20 times a second on Listen and once a second everywhere else, and
 * every page is handed `now`. A page that only cares about some of `now` (or none of it) compares
 * just that part, and every other prop by identity, so a tick of the clock doesn't redraw it.
 * `clock` picks out the part of `now` the page actually shows; leave it out to ignore `now`. */
export function sameApartFromClock<P extends { now?: NowState }>(clock: (now: NowState) => unknown = () => null) {
  return (before: Readonly<P>, after: Readonly<P>): boolean => {
    const keys = Object.keys(after) as (keyof P)[];
    if (Object.keys(before).length !== keys.length) return false;
    for (const key of keys) {
      if (key === 'now') continue;
      if (!Object.is(before[key], after[key])) return false;
    }
    if (!before.now || !after.now) return before.now === after.now;
    return Object.is(clock(before.now), clock(after.now));
  };
}
