/** The transition feel a mix was made with, per pair of songs (T-20261126-6f97).
 *
 * On the Desktop the feel (`steering.mix_language`) is kept for every new mix: the build picks
 * each move from that feel's family, and a mix already made keeps its transitions. Here the mix is
 * ordered by the account's planner and each transition is made on the device later, pair by pair.
 * So when a mix is ordered with a feel, the feel is remembered for each of its pairs, and the
 * device studio asks the account for that pair's options in that feel (`language` on
 * `/planning/candidates`). A pair no mix was made with in a feel (an edit, an older mix) asks with
 * none, as the Desktop's edited seams do. Kept in this browser: song ids and a word, nothing more. */

export const FEELS = new Set(['balanced', 'seamless', 'punchy', 'wordplay']);
/** Pairs remembered per workspace; the oldest go first. */
export const FEEL_PAIRS_KEPT = 2_000;

const keyOf = (workspaceId: string) => `selecta-mix-feel:${workspaceId}`;

function read(workspaceId: string): Record<string, string> {
  try {
    const kept = JSON.parse(window.localStorage.getItem(keyOf(workspaceId)) ?? '{}') as unknown;
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** A mix was ordered with this feel: each of its pairs keeps it. Any other word forgets them,
 * so those pairs ask with no feel, as before. */
export function rememberFeel(workspaceId: string, order: readonly number[], feel: string): void {
  const kept = read(workspaceId);
  for (let at = 1; at < order.length; at += 1) {
    const pair = `${order[at - 1]}>${order[at]}`;
    delete kept[pair];
    if (FEELS.has(feel)) kept[pair] = feel;
  }
  const pairs = Object.keys(kept);
  for (const old of pairs.slice(0, Math.max(0, pairs.length - FEEL_PAIRS_KEPT))) delete kept[old];
  try { window.localStorage.setItem(keyOf(workspaceId), JSON.stringify(kept)); } catch { /* asked with no feel next visit */ }
}

/** The feel to ask a pair's options in, or null for none. */
export function feelFor(workspaceId: string, a: number, b: number): string | null {
  const feel = read(workspaceId)[`${a}>${b}`];
  return feel && FEELS.has(feel) ? feel : null;
}
