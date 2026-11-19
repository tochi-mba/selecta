/** Intertwined stems: a port of src/selecta/render/intertwine.py.
 *
 * Sixteen bars from eight bars before the exit, with fixed per-stem curves drawn on one nominal
 * 28-unit timeline and scaled to the real bars: B's drums come in under A's, one bass at a time,
 * the melodies cross slowly, and the voices take turns. Every B downbeat is pinned to A's grid.
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

export const INTERTWINE_BARS = 16;
/** `TRANSITION_SECONDS`: the nominal timeline the curves are drawn on. */
export const NOMINAL_LENGTH = 28;
export const INTERTWINE_RULE: MoveRule = { label: 'intertwined stems', maxTempoGap: 0.03, minGrid: 0.55, maxKeyDistance: 1 };

type Nominal = ReadonlyArray<readonly [number, number]>;

/** The curves of `render_intertwined`, on the nominal timeline. */
export const INTERTWINE_CURVES: Record<StemSide, Record<StemName, Nominal>> = {
  a: {
    drums: [[0, 1], [12, 1], [16, 0]],
    bass: [[0, 1], [12, 1], [14, 0]],
    other: [[0, 1], [8, 1], [20, 0]],
    vocals: [[0, 1], [14, 1], [16, 0]],
  },
  b: {
    drums: [[0, 0], [4, 0], [12, 1]],
    bass: [[0, 0], [12, 0], [14, 1]],
    other: [[0, 0], [8, 0], [20, 1]],
    vocals: [[0, 0], [16, 0], [18, 1]],
  },
};

/** Nominal points scaled onto the real overlap, held at their last value until `end`. */
export function scaleNominal(points: Nominal, start: number, duration: number): GainPoint[] {
  const scaled: GainPoint[] = points.map(([at, value]) => [start + (at * duration) / NOMINAL_LENGTH, value]);
  scaled.push([start + duration, points[points.length - 1][1]]);
  return scaled;
}

export function stemIntertwine(pair: StemPair): StemRecipe {
  const checked = gate(pair, INTERTWINE_RULE);
  if ('refused' in checked) return checked;
  const place = placeOverlap(pair, INTERTWINE_BARS);
  if (!place) {
    return { refused: 'There isn\'t room for 16 bars of both songs inside the split stretches after the first 30 seconds.' };
  }
  const perBar = pair.beatsPerBar?.a ?? 4;
  const beats = INTERTWINE_BARS * perBar;
  const start = pair.a.beats[place.aIndex];
  const end = pair.a.beats[place.aIndex + beats];
  const duration = end - start;
  const shift = place.bIndex - place.aIndex;
  const bWarp = barPins(pair, place.aIndex, place.aIndex + beats, shift);
  const layers: StemLayer[] = [];
  for (const side of ['a', 'b'] as const) {
    for (const stem of ['vocals', 'drums', 'bass', 'other'] as const) {
      const from = side === 'a' ? start - HANDOVER_SECONDS : start;
      layers.push({
        side,
        stem,
        from,
        until: end + HANDOVER_SECONDS,
        sourceFrom: side === 'a' ? from : warpAt(bWarp, from),
        gain: withEdges(scaleNominal(INTERTWINE_CURVES[side][stem], start, duration), side, start, end),
      });
    }
  }
  const outside = outsideWindows(pair, layers, bWarp);
  if (outside) return { refused: outside };
  const gapWords = checked.gap < 0.0005 ? 'The tempos match' : `The tempos are ${(checked.gap * 100).toFixed(1)} percent apart`;
  return {
    implementation: STEM_MOVES_IMPLEMENTATION,
    move: 'stem_intertwine',
    startSeconds: start,
    endSeconds: end + HANDOVER_SECONDS,
    windowSeconds: duration + 2 * HANDOVER_SECONDS,
    bars: INTERTWINE_BARS,
    layers,
    native: nativeGains(start, end),
    bStartSourceAt: warpAt(bWarp, start),
    bSourcePerSecond: pair.a.tempo.bpm / pair.b.tempo.bpm,
    bWarp,
    handoverToNative: { at: end + HANDOVER_SECONDS, startAt: end - HANDOVER_SECONDS, bSourceAt: warpAt(bWarp, end - HANDOVER_SECONDS), crossfadeSeconds: 2 * HANDOVER_SECONDS },
    keyChecked: checked.keyChecked,
    why: `${gapWords} and both beats are steady, so the songs trade stems over 16 bars: the next song's drums come in first, one bass hands to the other, the melodies cross, and the voices take turns.${checked.keyChecked ? '' : ` ${KEY_NOT_CHECKED}`}`,
  };
}
