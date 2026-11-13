/** S4-0111-05: the status the page read to learn whether it is local or Cloud is the same answer the
 * app reads first, so the app takes that one rather than asking the server for it again while the
 * Library's first rows are on their way. Used once, and only while fresh. */
const FRESH_FOR_MS = 5_000;
let early: { at: number; status: unknown } | null = null;

export function handOnStartupStatus(status: unknown) {
  early = { at: performance.now(), status };
}

export function takeStartupStatus<T>(): T | null {
  const fresh = early && performance.now() - early.at <= FRESH_FOR_MS ? early.status as T : null;
  early = null;
  return fresh;
}
