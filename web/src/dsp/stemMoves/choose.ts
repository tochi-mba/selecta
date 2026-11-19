/** Choosing a stem move: src/selecta/planner/vibes.py `_moves_that_fit` and `_choose_move`.
 *
 * Each stem move that fits gets local mode's weight for the steering setting, then the mix's
 * history scales it: a move over its MAX_SHARE of the mix's seams drops to OVER_SHARE, each use
 * among the last three costs RECENT_PENALTY, a third seam running in one family costs
 * SAME_FAMILY_PENALTY, and the last move is skipped when anything else fits. Local mode samples
 * with numpy's generator; here the sample is seeded, so one seed always picks the same move.
 * Non-stem moves the integrator could also play can be passed in `others`, so a stem move wins
 * as often as it would against them in local mode.
 */

import { stemArrange } from './arrange';
import { stemIntertwine } from './intertwine';
import { vocalRide } from './ride';
import { STEM_MOVE_NAMES, type StemMoveName, type StemPair, type StemRecipe, type StemSeamPlan, type StemsSetting } from './types';
import type { Span } from './voice';

export const RIDE_WEIGHT = { balanced: 3.0, seamless: 3.0, wordplay: 1.5, punchy: 1.5 } as const;
export type Vibe = keyof typeof RIDE_WEIGHT;
export const ARRANGE_WEIGHT = 1.5;
export const INTERTWINE_WEIGHT = { sometimes: 0.35, often: 1.3 } as const;
export const OFTEN_FACTOR = 1.5;
export const MAX_SHARE: Readonly<Record<string, number>> = {
  vocal_ride: 0.35,
  stem_intertwine: 0.3,
  stem_arrange: 0.2,
  bass_swap_blend: 0.4,
  filter_sweep: 0.3,
  tempo_ramp: 0.25,
  cut_on_one: 0.3,
  echo_out: 0.25,
  delay_throw: 0.25,
};
export const DEFAULT_MAX_SHARE = 0.25;
export const FAMILIES: Readonly<Record<string, string>> = {
  bass_swap_blend: 'blend',
  filter_sweep: 'blend',
  tempo_ramp: 'blend',
  delay_throw: 'effect',
  echo_out: 'effect',
  cut_on_one: 'effect',
  vocal_ride: 'voice',
  stem_intertwine: 'blend',
};
export const OVER_SHARE = 0.05;
export const RECENT_PENALTY = 0.45;
export const SAME_FAMILY_PENALTY = 0.35;

export interface StemChoiceRequest extends StemPair {
  /** `steering.stems`. */
  stems: StemsSetting;
  /** Moves already chosen for this mix's earlier seams, in order. */
  history?: readonly string[];
  /** Counts of moves already used in the mix, when history isn't kept; history wins per move. */
  used?: Readonly<Record<string, number>>;
  /** Seams in the whole mix (local's `total`), for MAX_SHARE. */
  totalSeams: number;
  /** Stem moves this account has on (flags); all when absent. */
  allowed?: readonly StemMoveName[];
  vibe?: Vibe;
  seed: number;
  /** Rating factors per move (local's SeamMemory.move_factor); 1 when absent, 0 rules a move out. */
  factors?: Readonly<Partial<Record<StemMoveName, number>>>;
  /** Other moves the integrator could play instead, with their local weights. */
  others?: ReadonlyArray<{ move: string; weight: number }>;
  /** Singing spans already sensed, to skip sensing again. */
  sensed?: { a: Span[]; b: Span[] };
}

export interface StemChoice {
  /** The chosen stem move's plan, or null when no stem move fits or another move won. */
  plan: StemSeamPlan | null;
  /** The move that won the draw, stem or not; null when nothing fit. */
  picked: string | null;
  /** Every option that entered the draw, with its final weight. */
  weights: Array<{ move: string; weight: number }>;
  /** Why each stem move was left out. */
  refusals: Array<{ move: StemMoveName; reason: string }>;
}

/** mulberry32: a small seeded generator, uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local weights for each stem move under this steering, before the mix's history. */
export function stemWeight(move: StemMoveName, stems: StemsSetting, vibe: Vibe = 'balanced'): number {
  if (stems === 'never') return 0;
  const often = stems === 'often';
  if (move === 'vocal_ride') return RIDE_WEIGHT[vibe] * (often ? OFTEN_FACTOR : 1);
  if (move === 'stem_intertwine') return INTERTWINE_WEIGHT[stems];
  return ARRANGE_WEIGHT * (often ? OFTEN_FACTOR : 1);
}

/** `_choose_move`'s weights: the options left after skipping a repeat, scaled by the mix so far. */
export function historyWeights(
  options: ReadonlyArray<{ move: string; weight: number }>,
  history: readonly string[],
  total: number,
  used: Readonly<Record<string, number>> = {},
): Array<{ move: string; weight: number }> {
  const last = history[history.length - 1];
  const fresh = options.filter((option) => !history.length || option.move !== last);
  const pool = fresh.length ? fresh : options;
  const count = (move: string) => (history.length ? history.filter((name) => name === move).length : used[move] ?? 0);
  return pool.map(({ move, weight }) => {
    let scaled = weight;
    const shareLeft = (MAX_SHARE[move] ?? DEFAULT_MAX_SHARE) * total - count(move);
    if (shareLeft < 1) scaled *= OVER_SHARE;
    scaled *= RECENT_PENALTY ** history.slice(-3).filter((name) => name === move).length;
    const family = FAMILIES[move];
    if (family && history.length >= 2 && history.slice(-2).every((name) => FAMILIES[name] === family)) scaled *= SAME_FAMILY_PENALTY;
    return { move, weight: scaled };
  });
}

const RECIPES: Record<StemMoveName, (pair: StemPair, sensed?: { a: Span[]; b: Span[] }) => StemRecipe> = {
  vocal_ride: vocalRide,
  stem_intertwine: stemIntertwine,
  stem_arrange: stemArrange,
};

const LABELS: Record<StemMoveName, string> = { vocal_ride: 'Vocal ride', stem_intertwine: 'Intertwined stems', stem_arrange: 'Strip and land' };

/** Pick a stem move for the seam from A into B, as local mode would, or say why none fit. */
export function chooseStemMove(request: StemChoiceRequest): StemChoice {
  const refusals: StemChoice['refusals'] = [];
  if (request.stems === 'never') {
    return { plan: null, picked: null, weights: [], refusals: STEM_MOVE_NAMES.map((move) => ({ move, reason: 'Stem moves are set to never.' })) };
  }
  const plans = new Map<StemMoveName, StemSeamPlan>();
  const options: Array<{ move: string; weight: number }> = [];
  for (const move of STEM_MOVE_NAMES) {
    if (request.allowed && !request.allowed.includes(move)) {
      refusals.push({ move, reason: `${LABELS[move]} isn't turned on.` });
      continue;
    }
    const factor = request.factors?.[move] ?? 1;
    if (factor <= 0) {
      refusals.push({ move, reason: `${LABELS[move]} has been rated down for these songs.` });
      continue;
    }
    const recipe = RECIPES[move](request, request.sensed);
    if ('refused' in recipe) {
      refusals.push({ move, reason: recipe.refused });
      continue;
    }
    plans.set(move, recipe);
    options.push({ move, weight: stemWeight(move, request.stems, request.vibe) * factor });
  }
  for (const other of request.others ?? []) if (other.weight > 0) options.push({ ...other });
  if (!options.length) return { plan: null, picked: null, weights: [], refusals };
  const weights = historyWeights(options, request.history ?? [], Math.max(request.totalSeams, 1), request.used);
  const sum = weights.reduce((total, option) => total + option.weight, 0);
  let draw = seededRandom(request.seed)() * sum;
  let picked = weights[weights.length - 1].move;
  for (const option of weights) {
    draw -= option.weight;
    if (draw < 0) {
      picked = option.move;
      break;
    }
  }
  return { plan: plans.get(picked as StemMoveName) ?? null, picked, weights, refusals };
}
