/** Strip and land, reduced: local mode's starting arrangement from src/selecta/arrange.py.
 *
 * Eight squares over 16 (or 12) bars. A's bass goes first, then its drums, then its voice, and
 * its melody carries on alone. B's melody is teased and pulled away, then B's bass arrives and
 * B's drums land last. Local mode then measures all eight stems and hill-climbs the shape
 * (`tune`); the browser plays the starting shape as it is, only moving A's voice stop to the
 * quietest nearby square boundary as `_voice_moved_to_a_gap` does, and says so in the why.
 */

import type { GainPoint } from '../crossfade';
import {
  barPins,
  gate,
  HANDOVER_SECONDS,
  KEY_NOT_CHECKED,
  nativeGains,
  outsideWindows,
  placeOverlap,
  STEM_MOVES_IMPLEMENTATION,
  warpAt,
  withEdges,
  type MoveRule,
  type StemLayer,
  type StemName,
  type StemPair,
  type StemRecipe,
  type StemSide,
} from './types';
import { voiceLoudnessAround } from './voice';

export const CELLS = 8;
/** `CLOSE_TEMPO`, `MIN_GRID` and word_blend's key reach in arrange.py `why_it_cant`. */
export const ARRANGE_RULE: MoveRule = { label: 'strip and land', maxTempoGap: 0.045, minGrid: 0.8, maxKeyDistance: 2 };
/** studio.py `OVERLAP_BARS`, at least arrange.py `SHORTEST_OVERLAP`. */
export const ARRANGE_BARS = [16, 12] as const;
/** studio.py `EDGE_SECONDS`: each square change ramps this far either side of its boundary. */
export const CELL_EDGE_SECONDS = 0.012;
export const VOICE_STOPS = [3, 4, 5, 6] as const;
export const FAR_FROM_MIDDLE_COST = 0.15;

export type Shape = Record<StemSide, Record<StemName, readonly number[]>>;

export const STRIP_AND_LAND: Shape = {
  a: {
    vocals: [1, 1, 1, 1, 0, 0, 0, 0],
    drums: [1, 1, 0, 0, 0, 0, 0, 0],
    bass: [1, 0, 0, 0, 0, 0, 0, 0],
    other: [1, 1, 1, 1, 1, 1, 1, 1],
  },
  b: {
    vocals: [0, 0, 0, 0, 0, 0, 0, 0],
    drums: [0, 0, 0, 0, 0, 0, 0, 1],
    bass: [0, 0, 0, 0, 0, 0, 1, 1],
    other: [0, 0, 0, 1, 1, 0, 1, 1],
  },
};

/** studio.py `_lane_gain`: a lane's level over the overlap, with short edges at each change. */
export function cellPoints(cells: readonly number[], start: number, seconds: number): GainPoint[] {
  const step = seconds / CELLS;
  const points: GainPoint[] = [[start, cells[0]]];
  for (let index = 1; index < CELLS; index += 1) {
    if (cells[index] !== cells[index - 1]) {
      const boundary = start + index * step;
      points.push([boundary - CELL_EDGE_SECONDS, cells[index - 1]], [boundary + CELL_EDGE_SECONDS, cells[index]]);
    }
  }
  points.push([start + seconds, cells[CELLS - 1]]);
  return points;
}

/** Where A's voice stops: the quietest square boundary among VOICE_STOPS, leaning to the middle. */
export function voiceStop(edgeLoudness: (boundary: number) => number): number {
  let best: number = VOICE_STOPS[0];
  let bestCost = Infinity;
  for (const stop of VOICE_STOPS) {
    const cost = edgeLoudness(stop) * (1 + FAR_FROM_MIDDLE_COST * Math.abs(stop - 4));
    if (cost < bestCost) {
      best = stop;
      bestCost = cost;
    }
  }
  return best;
}

export function stemArrange(pair: StemPair): StemRecipe {
  const checked = gate(pair, ARRANGE_RULE);
  if ('refused' in checked) return checked;
  let bars = 0;
  let place: ReturnType<typeof placeOverlap> = null;
  for (const wanted of ARRANGE_BARS) {
    place = placeOverlap(pair, wanted);
    if (place) {
      bars = wanted;
      break;
    }
  }
  if (!place) return { refused: 'These two don\'t have enough clear bars inside the split stretches to line their stems up.' };
  const perBar = pair.beatsPerBar?.a ?? 4;
  const beats = bars * perBar;
  const start = pair.a.beats[place.aIndex];
  const end = pair.a.beats[place.aIndex + beats];
  const seconds = end - start;
  const step = seconds / CELLS;
  const stop = voiceStop((boundary) => voiceLoudnessAround(pair.aWindow, start + boundary * step));
  const shape: Shape = {
    a: { ...STRIP_AND_LAND.a, vocals: STRIP_AND_LAND.a.vocals.map((_, cell) => (cell < stop ? 1 : 0)) },
    b: STRIP_AND_LAND.b,
  };
  const bWarp = barPins(pair, place.aIndex, place.aIndex + beats, place.bIndex - place.aIndex);
  const layers: StemLayer[] = [];
  for (const side of ['a', 'b'] as const) {
    for (const stem of ['vocals', 'drums', 'bass', 'other'] as const) {
      const cells = shape[side][stem];
      if (!cells.some(Boolean)) continue;
      const from = side === 'a' ? start - HANDOVER_SECONDS : start;
      layers.push({
        side,
        stem,
        from,
        until: end + HANDOVER_SECONDS,
        sourceFrom: side === 'a' ? from : warpAt(bWarp, from),
        gain: withEdges(cellPoints(cells, start, seconds), side, start, end),
      });
    }
  }
  const outside = outsideWindows(pair, layers, bWarp);
  if (outside) return { refused: outside };
  const moved = stop === 4 ? '' : ` The first song's voice stops at square ${stop + 1}, where it was quietest.`;
  return {
    implementation: STEM_MOVES_IMPLEMENTATION,
    move: 'stem_arrange',
    startSeconds: start,
    endSeconds: end + HANDOVER_SECONDS,
    windowSeconds: seconds + 2 * HANDOVER_SECONDS,
    bars,
    layers,
    native: nativeGains(start, end),
    bStartSourceAt: warpAt(bWarp, start),
    bSourcePerSecond: pair.a.tempo.bpm / pair.b.tempo.bpm,
    bWarp,
    handoverToNative: { at: end + HANDOVER_SECONDS, startAt: end - HANDOVER_SECONDS, bSourceAt: warpAt(bWarp, end - HANDOVER_SECONDS), crossfadeSeconds: 2 * HANDOVER_SECONDS },
    keyChecked: checked.keyChecked,
    why: `Over ${bars} bars the first song drops its bass, then its drums, then its voice while its melody carries on; the next song's melody is teased, then its bass and drums land. This is a reduced strip and land: the Desktop app's starting shape, without the fine tuning the Desktop app does after measuring every stem.${moved}${checked.keyChecked ? '' : ` ${KEY_NOT_CHECKED}`}`,
  };
}
