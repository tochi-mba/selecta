/** Stem moves in a browser seam (ADR-0459 Tier 3, flag `cloud.browser_stems`).
 *
 * The seam provider asks this module, after scripting the normal move, whether a stem move
 * should play instead. Stems are only ever read from the cache the prefetcher fills when each
 * song starts; nothing here runs separation. The recipes are the pure ports in stemMoves/, and
 * this module turns a chosen plan into a SeamSchedule the scheduler plays:
 *  - the full mixes' hand-offs (A's mix into its stems, B's stems into B's mix) are ordinary
 *    gain, start and stop events, so the scheduler's checks and cleanup apply unchanged;
 *  - the plan and its per-stem audio ride on `schedule.stems`. A's stems are cut from A's tail
 *    window as they are; B's are cut from B's head window and, when the tempos differ,
 *    stretched onto A's bars with the pitch-preserving stretch (stretch.ts) before playing.
 *
 * Honesty: a stem move that was asked for, or that SelectaDJ would have weighed, but cannot play
 * is recorded on the normal move's `degraded` list in the words of cloud/stems/stemsCopy.ts.
 * When 'auto' weighed stem moves and the normal move won the draw, or every stem recipe refused,
 * nothing is recorded: the member asked SelectaDJ to pick, and it did.
 */

import { stemDegradedReason, stemRefusal } from '../cloud/stems/stemsCopy';
import { SEAM_EFFECTS_IMPLEMENTATION } from './seamEffects';
import { SEAM_MOVES_IMPLEMENTATION } from './seamMoves';
import { gainEvents, SEAMS_IMPLEMENTATION, type SeamEvent, type SeamSchedule, type StemBuffers, type TrackTiming } from './seams';
import type { SeamAbilities } from './seamScript';
import { stemArrange, stemIntertwine, vocalRide } from './stemMoves';
import { chooseStemMove } from './stemMoves/choose';
import { STEM_MOVE_NAMES, warpAt, type StemMoveName, type StemName, type StemPair, type StemRecipe, type StemSeamPlan, type StemsSetting, type StemWindow } from './stemMoves/types';
import type { StemSet } from './stems/cache';
import { stretchRefusal, type StretchRamp } from './stretchLimits';

/** Where stems come from for the seam provider: the prefetcher's cache, read only. */
export type StemReading = {
  /** The cached stems of one song's window, or null when they are not there. Never separates. */
  read(songId: number, window: 'tail' | 'head'): Promise<StemSet | null>;
  /** The song id at a queue index; the index itself when absent. Null when unknown. */
  songId?(index: number): number | null;
  /** The moves this account has on; only the stem moves among them are weighed. */
  allowed(): readonly string[];
  /** Make a Mix's stem preference (local mode's `steering.stems`). */
  preference(): StemsSetting;
  /** The moves already played in this mix, in order. */
  history(): readonly string[];
  /** Seams in the whole mix, for local mode's share caps; history length plus one when absent. */
  totalSeams?(): number;
};

/** Stretches one stem's channels along a ramp (the stretch worker, or stretch.ts in place). */
export type StemStretcher = (channels: Float32Array[], sampleRate: number, ramp: StretchRamp) => Promise<Float32Array[]> | Float32Array[];

export const STEM_SEAM_MOVES: readonly StemMoveName[] = STEM_MOVE_NAMES;
export const isStemMove = (move: string | null | undefined): move is StemMoveName => STEM_SEAM_MOVES.includes(move as StemMoveName);

/** Local weights for the normal move a stem move competes with (src/selecta/planner/vibes.py
 * MOVE_WEIGHTS, balanced vibe). Moves balanced leaves out take their weight from another vibe
 * (cut_on_one: punchy), or a small one (reverb_wash, a plain blend), so they can still win. */
export const NORMAL_MOVE_WEIGHTS: Readonly<Record<string, number>> = {
  bass_swap_blend: 2.5,
  filter_sweep: 2.0,
  echo_out: 0.5,
  cut_on_one: 1.0,
  reverb_wash: 0.3,
  tempo_ramp: 0.25,
  blend: 0.5,
};

/** A stem buffer's edge reaches this far past the last layer, and B's stretch reads this much
 * either side of what plays, so no layer starts or stops on the stretch's edge frames. */
const STEM_MARGIN_SECONDS = 0.1;
/** B's beat grid may stray this far from one straight stretch before a plan is refused. */
const WARP_TOLERANCE_SECONDS = 0.005;

const RECIPES: Record<StemMoveName, (pair: StemPair) => StemRecipe> = {
  vocal_ride: vocalRide,
  stem_intertwine: stemIntertwine,
  stem_arrange: stemArrange,
};

/** A refusal while building the stem audio, in the member's words. */
class StemRefused extends Error {}

/** The refusal code stemsCopy.ts words a recipe's own refusal under. */
export function refusalCode(refused: string): 'tempo' | 'grid' | 'voice' | 'room' {
  if (/tempo/i.test(refused)) return 'tempo';
  if (/sing|voice/i.test(refused)) return 'voice';
  if (/room|split|30 seconds/i.test(refused)) return 'room';
  if (/beat|grid|bars|steady/i.test(refused)) return 'grid';
  return 'room';
}

function validSet(set: StemSet | null): set is StemSet {
  if (!set || !(set.sampleRate > 0) || !set.stems) return false;
  const length = set.stems.vocals?.[0]?.length ?? 0;
  return length > 0 && (['vocals', 'drums', 'bass', 'other'] as const).every((stem) => {
    const pair = set.stems[stem];
    return Array.isArray(pair) && pair.length === 2 && pair.every((channel) => channel instanceof Float32Array && channel.length === length);
  });
}

/** A stem window for sensing: the vocal stem mono, placed at its song second. */
export function sensingWindow(set: StemSet): StemWindow {
  const [left, right] = set.stems.vocals;
  const vocals = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) vocals[index] = (left[index] + right[index]) / 2;
  return { origin: set.startMs / 1000, sampleRate: set.sampleRate, vocals };
}

/** The schedule a plan plays: the full mixes' hand-offs as events, the plan and its audio on
 * `stems`. B's 'start' is B's full mix at the handover, so a seam record still names where B's
 * own audio enters. */
export function stemSchedule(plan: StemSeamPlan, buffers?: StemBuffers): SeamSchedule {
  const handover = plan.handoverToNative;
  const aLast = plan.native.a[plan.native.a.length - 1][0];
  const events: SeamEvent[] = [
    { deck: 'b', kind: 'start', at: handover.startAt, sourceAt: handover.bSourceAt },
    ...gainEvents('a', plan.native.a),
    { deck: 'a', kind: 'stop', at: aLast + 1e-6 },
    ...gainEvents('b', plan.native.b),
  ];
  events.sort((left, right) => left.at - right.at);
  const echoes = plan.layers.some((layer) => layer.sends?.length);
  return {
    implementation: `${SEAMS_IMPLEMENTATION}+${plan.implementation}+${SEAM_MOVES_IMPLEMENTATION}${echoes ? `+${SEAM_EFFECTS_IMPLEMENTATION}` : ''}`,
    kind: 'beatmatch',
    startSeconds: plan.startSeconds,
    windowSeconds: plan.windowSeconds,
    events,
    style: plan.move,
    bars: plan.bars,
    why: plan.why,
    stems: buffers ? { plan, buffers } : { plan },
  };
}

/** The earliest A-timeline second any part of a stem schedule sounds. */
export function stemsFirstAt(plan: StemSeamPlan): number {
  return Math.min(plan.startSeconds, ...plan.layers.map((layer) => layer.from), ...plan.native.a.map(([at]) => at));
}

/** B's stems from its first layer to its last, as one straight stretch onto A's bars. */
function bSpan(plan: StemSeamPlan): { outFrom: number; outTo: number; ratio: number } {
  const layers = plan.layers.filter((layer) => layer.side === 'b');
  const outFrom = Math.min(...layers.map((layer) => layer.from));
  const outTo = Math.max(...layers.map((layer) => layer.until)) + STEM_MARGIN_SECONDS;
  const from = warpAt(plan.bWarp, outFrom);
  const ratio = (warpAt(plan.bWarp, outTo) - from) / (outTo - outFrom);
  for (const [output, source] of plan.bWarp) {
    if (Math.abs(from + (output - outFrom) * ratio - source) > WARP_TOLERANCE_SECONDS) {
      throw new StemRefused('a steady tempo through the whole move in the next song');
    }
  }
  return { outFrom, outTo, ratio };
}

/** Cut and, where needed, stretch the stems a plan plays. */
export async function stemBuffers(plan: StemSeamPlan, aSet: StemSet, bSet: StemSet, stretch: StemStretcher | null, stretchAbility: SeamAbilities['stretch']): Promise<StemBuffers> {
  if (aSet.sampleRate !== bSet.sampleRate) throw new StemRefused('both songs split at the same sample rate');
  const used = (side: 'a' | 'b') => [...new Set(plan.layers.filter((layer) => layer.side === side).map((layer) => layer.stem))];
  const cut = (set: StemSet, stem: StemName, fromSecond: number, toSecond: number) => {
    const origin = set.startMs / 1000;
    const total = set.stems[stem][0].length;
    const from = Math.max(0, Math.round((fromSecond - origin) * set.sampleRate));
    const to = Math.min(total, Math.round((toSecond - origin) * set.sampleRate));
    return { channels: set.stems[stem].map((channel) => channel.slice(from, Math.max(from, to))), start: origin + from / set.sampleRate };
  };

  const aLayers = plan.layers.filter((layer) => layer.side === 'a');
  const aFrom = Math.min(...aLayers.map((layer) => layer.sourceFrom));
  const aTo = Math.max(...aLayers.map((layer) => layer.sourceFrom + (layer.until - layer.from))) + STEM_MARGIN_SECONDS;
  const a: StemBuffers['a'] = { origin: aFrom, stems: {} };
  for (const stem of used('a')) {
    const piece = cut(aSet, stem, aFrom, aTo);
    a.origin = piece.start;
    a.stems[stem] = piece.channels;
  }

  const { outFrom, outTo, ratio } = bSpan(plan);
  const straight = Math.abs(ratio - 1) < 1e-4;
  if (!straight) {
    if (!stretchAbility.ok || !stretch) throw new StemRefused(`a time-stretch to follow the first song’s bars, which this device can’t run: ${stretchAbility.ok ? 'the stretch is not loaded' : stretchAbility.reason}`);
    const refused = stretchRefusal(ratio, (outTo - outFrom) * ratio);
    if (refused) throw new StemRefused(`a smaller tempo change: ${refused}`);
  }
  const sourceFrom = warpAt(plan.bWarp, outFrom);
  const bOrigin = bSet.startMs / 1000;
  const lead = Math.max(0, Math.min(STEM_MARGIN_SECONDS, sourceFrom - bOrigin));
  const sourceTo = warpAt(plan.bWarp, outTo) + STEM_MARGIN_SECONDS;
  const b: StemBuffers['b'] = { at: outFrom - lead / (straight ? 1 : ratio), stems: {} };
  for (const stem of used('b')) {
    const piece = cut(bSet, stem, sourceFrom - lead, sourceTo);
    if (straight) {
      b.at = outFrom - (sourceFrom - piece.start);
      b.stems[stem] = piece.channels;
      continue;
    }
    const skipped = (sourceFrom - piece.start) / ratio;
    b.at = outFrom - skipped;
    const out = await stretch!(piece.channels, bSet.sampleRate, { ratio, holdSeconds: 1e6, rampSeconds: 0 });
    if (!Array.isArray(out) || out.length !== piece.channels.length || (out[0]?.length ?? 0) / bSet.sampleRate < outTo - STEM_MARGIN_SECONDS - b.at) {
      throw new Error('the stretched stems came back too short');
    }
    b.stems[stem] = out;
  }
  return { sampleRate: aSet.sampleRate, a, b };
}

export type StemSeamInput = {
  fromIndex: number;
  toIndex: number;
  a: TrackTiming;
  b: TrackTiming;
  /** The move the seam settings name. */
  move: string | null | undefined;
  /** The schedule of the normal move, already scripted. */
  normal: SeamSchedule;
  abilities: SeamAbilities;
  stems: StemReading;
  stretch: StemStretcher | null;
};

/** The normal schedule, with a record of the stem move that could not play in its place. */
function degrade(normal: SeamSchedule, wanted: string, reason: string): SeamSchedule {
  const instead = normal.kind === 'fade' ? 'fade' : normal.style ?? 'blend';
  return { ...normal, degraded: [...(normal.degraded ?? []), { wanted, instead, reason }] };
}

/** A small stable seed per transition, so one seam always draws the same move. */
const seedOf = (fromIndex: number, toIndex: number) => (Math.imul(fromIndex + 1, 2654435761) ^ Math.imul(toIndex + 1, 40503)) >>> 0;

/** A stem move in place of the normal one when one is asked for (or SelectaDJ picks one) and can
 * play here; otherwise the normal schedule, with the reason when a stem move was wanted. */
export async function withStemMove(input: StemSeamInput): Promise<SeamSchedule> {
  const { normal, abilities, stems } = input;
  const explicit = isStemMove(input.move) ? input.move : null;
  if (!explicit && input.move !== 'auto') return normal;
  const preference = stems.preference();
  const allowed = stems.allowed().filter(isStemMove);
  if (explicit) {
    if (!abilities.stems.ok) return degrade(normal, explicit, abilities.stems.reason);
  } else if (!abilities.stems.ok || preference === 'never' || !allowed.length) {
    return normal;
  }
  const wanted = explicit ?? 'stems';
  const idOf = (index: number) => (stems.songId ? stems.songId(index) : index);
  const aId = idOf(input.fromIndex);
  const bId = idOf(input.toIndex);
  if (aId === null || bId === null) return degrade(normal, wanted, stemDegradedReason('not_connected'));
  let sets: [StemSet | null, StemSet | null];
  try {
    sets = await Promise.all([stems.read(aId, 'tail'), stems.read(bId, 'head')]);
  } catch {
    sets = [null, null];
  }
  const [aSet, bSet] = sets;
  if (!aSet || !bSet) return degrade(normal, wanted, stemDegradedReason('not_ready'));
  if (!validSet(aSet) || !validSet(bSet)) return degrade(normal, wanted, stemDegradedReason('split_failed', 'the stored stems were incomplete'));
  const pair: StemPair = { a: input.a, b: input.b, aWindow: sensingWindow(aSet), bWindow: sensingWindow(bSet) };

  let plan: StemSeamPlan;
  if (explicit) {
    const recipe = RECIPES[explicit](pair);
    if ('refused' in recipe) return degrade(normal, explicit, `${stemRefusal(explicit, refusalCode(recipe.refused))} ${recipe.refused}`);
    plan = recipe;
  } else {
    const history = stems.history();
    const others = normal.kind === 'fade' ? [] : [{ move: normal.style ?? 'blend', weight: NORMAL_MOVE_WEIGHTS[normal.style ?? 'blend'] ?? 0.5 }];
    const choice = chooseStemMove({
      ...pair,
      stems: preference,
      history,
      totalSeams: stems.totalSeams?.() ?? history.length + 1,
      allowed,
      seed: seedOf(input.fromIndex, input.toIndex),
      others,
    });
    if (!choice.plan) return normal;
    plan = choice.plan;
  }

  const needsMoves = plan.layers.some((layer) => layer.eq?.length || layer.filter?.length);
  if (needsMoves && !abilities.eqFilters.ok) return degrade(normal, plan.move, stemRefusal(plan.move, `EQ and filters, which this device lacks: ${abilities.eqFilters.reason}`));
  const needsEcho = plan.layers.some((layer) => layer.sends?.length);
  if (needsEcho && !abilities.echo.ok) return degrade(normal, plan.move, stemRefusal(plan.move, `an echo return, which this device lacks: ${abilities.echo.reason}`));
  try {
    return stemSchedule(plan, await stemBuffers(plan, aSet, bSet, input.stretch, abilities.stretch));
  } catch (problem) {
    if (problem instanceof StemRefused) return degrade(normal, plan.move, stemRefusal(plan.move, problem.message));
    return degrade(normal, plan.move, `The next song’s stems couldn’t be stretched to match: ${problem instanceof Error ? problem.message : String(problem)}.`);
  }
}
