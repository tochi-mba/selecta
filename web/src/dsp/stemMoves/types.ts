/** Shared types and beat-grid helpers for the browser's stem moves (ADR-0459 Tier 3).
 *
 * A stem move is a pure recipe: given both songs' beat grids and the separated stem windows, it
 * returns per-stem gain, EQ, filter and echo-send curves on deck A's timeline, or a refusal in
 * plain words. Nothing here touches Web Audio or storage, so the integrator can schedule the
 * curves on whatever per-stem buffers it holds.
 *
 * Times: every `at` is seconds on A's own timeline (deck A's track starts at 0), as in
 * seams.ts. Source times (`sourceFrom`, `bSourceAt`, the second element of `bWarp` pins) are
 * seconds into that side's own song, so `sourceFrom - window.origin` is the offset into the stem
 * buffer.
 */

import { SEAM_FADE_SECONDS, type GainPoint } from '../crossfade';
import { LEAVE_AFTER_SECONDS, type TrackTiming } from '../seams';

export const STEM_MOVES_IMPLEMENTATION = 'browser-stem-moves-v1';

export const STEM_NAMES = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemName = (typeof STEM_NAMES)[number];
export type StemSide = 'a' | 'b';
export type StemMoveName = 'vocal_ride' | 'stem_intertwine' | 'stem_arrange';
export const STEM_MOVE_NAMES: readonly StemMoveName[] = ['vocal_ride', 'stem_intertwine', 'stem_arrange'];
/** `steering.stems` in local mode. */
export type StemsSetting = 'never' | 'sometimes' | 'often';

/** A separated window of one song. Only the voice is needed for sensing; its length (or
 * `seconds`, when given) bounds the window every stem buffer of that side covers. */
export interface StemWindow {
  /** Seconds into the song where the window starts. */
  origin: number;
  sampleRate: number;
  /** The vocal stem, mono. */
  vocals: Float32Array;
  /** The window length when it differs from the vocal buffer's. */
  seconds?: number;
}

export interface StemPair {
  a: TrackTiming;
  b: TrackTiming;
  /** A's stem window (the scheduler separates A's last 60 s). */
  aWindow: StemWindow;
  /** B's stem window (the scheduler separates B's first 45 s). */
  bWindow: StemWindow;
  /** Camelot distance between the songs when a key is known. The browser analysis has no key
   * yet, so this is normally absent and the stricter key-unknown tempo rule applies. */
  keyDistance?: number | null;
  /** Beats per bar on each side; the browser grid assumes 4/4. */
  beatsPerBar?: { a: number; b: number };
  /** The settle rule; never below LEAVE_AFTER_SECONDS. */
  leaveAfterSeconds?: number;
}

export type FilterPoint = readonly [timeSeconds: number, hz: number];

/** One stem of one song, played from `sourceFrom` at output time `from` until `until`.
 * Curves use the SeamEvent semantics of seams.ts: gain and eq ramp linearly to each point,
 * filter cutoffs sweep exponentially, sends ramp linearly. */
export interface StemLayer {
  side: StemSide;
  stem: StemName;
  from: number;
  until: number;
  sourceFrom: number;
  gain: GainPoint[];
  eq?: Array<{ band: 'low' | 'mid' | 'high'; points: GainPoint[] }>;
  filter?: Array<{ filter: 'highpass' | 'lowpass'; points: FilterPoint[] }>;
  sends?: Array<{ effect: 'echo'; points: GainPoint[] }>;
}

/** The echo return a send feeds, same fields as seamEffects.ts EchoSpec. */
export interface StemEcho {
  delaySeconds: number;
  feedback: number;
  wet: number;
  returnHighpassHz: number;
  dampLowpassHz: number;
}

export interface StemSeamPlan {
  implementation: string;
  move: StemMoveName;
  /** A-timeline second where the stems take over from A's full mix. */
  startSeconds: number;
  /** A-timeline second where B's full mix has fully taken over. */
  endSeconds: number;
  /** endSeconds - startSeconds plus the takeover pre-roll. Stem moves run longer than
   * MAX_WINDOW_SECONDS (16 s): that bound is for a prepared mixed window, and stem moves play
   * from per-stem buffers already held in the stem windows, which bound them instead. */
  windowSeconds: number;
  bars: number;
  layers: StemLayer[];
  /** Full-mix gains: A's deck hands to its stems at the start, B's deck takes over at the end. */
  native: { a: GainPoint[]; b: GainPoint[] };
  /** B source second where B's stems enter. */
  bStartSourceAt: number;
  /** B source seconds per output second while B is locked to A's grid (A bpm / B bpm). */
  bSourcePerSecond: number;
  /** Downbeat pins (output second, B source second) B's stems are stretched through. */
  bWarp: Array<readonly [number, number]>;
  /** B's full mix starts at `startAt` from `bSourceAt` and is at full gain by `at`. */
  handoverToNative: { at: number; startAt: number; bSourceAt: number; crossfadeSeconds: number };
  echo?: StemEcho;
  /** False when the browser had no key to check; the why says so. */
  keyChecked: boolean;
  why: string;
}

export type StemRefusal = { refused: string };
export type StemRecipe = StemSeamPlan | StemRefusal;

export function isRefusal(recipe: StemRecipe): recipe is StemRefusal {
  return 'refused' in recipe;
}

/** The takeover and handover crossfade between a full mix and its stems. */
export const HANDOVER_SECONDS = SEAM_FADE_SECONDS;
/** `_CONTEXT` in wordplay.py: a stretched stem reads this far either side of a warp. */
export const STRETCH_CONTEXT_SECONDS = 0.5;
/** When no key is known, a move's tempo limit is scaled by this. */
export const KEY_UNKNOWN_TEMPO_SCALE = 0.5;

export function windowRange(window: StemWindow): [number, number] {
  const seconds = window.seconds ?? window.vocals.length / window.sampleRate;
  return [window.origin, window.origin + seconds];
}

export function leaveAfter(pair: StemPair): number {
  return Math.max(pair.leaveAfterSeconds ?? LEAVE_AFTER_SECONDS, LEAVE_AFTER_SECONDS);
}

export function medianPeriod(beats: readonly number[]): number {
  const gaps: number[] = [];
  for (let index = 1; index < beats.length; index += 1) gaps.push(beats[index] - beats[index - 1]);
  if (!gaps.length) return NaN;
  gaps.sort((x, y) => x - y);
  const middle = gaps.length >> 1;
  return gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
}

/** The fractional beat index at `time`, extrapolated past either end at the median period. */
export function beatIndexAt(beats: readonly number[], time: number): number {
  const count = beats.length;
  if (count < 2) return NaN;
  const period = medianPeriod(beats);
  if (time <= beats[0]) return (time - beats[0]) / period;
  if (time >= beats[count - 1]) return count - 1 + (time - beats[count - 1]) / period;
  let low = 0;
  let high = count - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (beats[middle] <= time) low = middle;
    else high = middle;
  }
  return low + (time - beats[low]) / (beats[high] - beats[low]);
}

/** The time of a fractional beat index, extrapolated past either end at the median period. */
export function timeAtBeat(beats: readonly number[], index: number): number {
  const count = beats.length;
  if (count < 2) return NaN;
  const period = medianPeriod(beats);
  if (index <= 0) return beats[0] + index * period;
  if (index >= count - 1) return beats[count - 1] + (index - (count - 1)) * period;
  const low = Math.floor(index);
  return beats[low] + (index - low) * (beats[low + 1] - beats[low]);
}

/** Piecewise-linear map through (output, source) pins, extrapolated from the end segments. */
export function warpAt(pins: ReadonlyArray<readonly [number, number]>, output: number): number {
  if (pins.length === 1) return pins[0][1] + (output - pins[0][0]);
  let index = 0;
  while (index < pins.length - 2 && output > pins[index + 1][0]) index += 1;
  const [x0, y0] = pins[index];
  const [x1, y1] = pins[index + 1];
  return y0 + ((output - x0) * (y1 - y0)) / (x1 - x0);
}

export interface MoveRule {
  label: string;
  maxTempoGap: number;
  minGrid: number;
  maxKeyDistance: number;
}

const percent = (gap: number) => `${(gap * 100).toFixed(1)} percent`;

/** The musical gates a move shares with local mode, in plain words. Grid confidence is the
 * browser tempo confidence, and a half/double-time ambiguous tempo never passes. */
export function gate(pair: StemPair, rule: MoveRule): { refused: string } | { keyChecked: boolean; gap: number } {
  const bars = pair.beatsPerBar ?? { a: 4, b: 4 };
  if (bars.a !== bars.b) return { refused: `The two songs count a different number of beats to the bar, so ${rule.label} can't line their bars up.` };
  for (const [song, name] of [[pair.a, 'first'], [pair.b, 'next']] as const) {
    if (song.tempo.ambiguous) return { refused: `The ${name} song's tempo could be half or double what was measured, so ${rule.label} can't lock its bars.` };
    if (song.tempo.confidence < rule.minGrid) {
      return { refused: `The ${name} song's beat isn't steady enough for ${rule.label} (confidence ${song.tempo.confidence.toFixed(2)}, needs ${rule.minGrid}).` };
    }
  }
  const gap = Math.abs(pair.a.tempo.bpm / pair.b.tempo.bpm - 1);
  const keyChecked = pair.keyDistance !== undefined && pair.keyDistance !== null;
  if (keyChecked && (pair.keyDistance as number) > rule.maxKeyDistance) {
    return { refused: `These two are too far apart in key for ${rule.label}.` };
  }
  const limit = keyChecked ? rule.maxTempoGap : rule.maxTempoGap * KEY_UNKNOWN_TEMPO_SCALE;
  if (gap > limit) {
    const unknown = keyChecked ? '' : ', the stricter limit used while the browser can\'t check key';
    return { refused: `The songs are ${percent(gap)} apart in tempo; ${rule.label} needs them within ${percent(limit)}${unknown}.` };
  }
  return { keyChecked, gap };
}

export const KEY_NOT_CHECKED = 'Key wasn\'t checked, since the browser doesn\'t read key yet, so the tempos had to sit closer than local mode asks.';

/** Where the overlap of `bars` bars can sit: the latest start on A's grid that respects the
 * settle rule and A's window, and the earliest bar line of B whose stretch fits B's window.
 * Phrase lines (8 bars) are preferred to plain bar lines, as local mode leaves on a cue. */
export function placeOverlap(pair: StemPair, bars: number): { aIndex: number; bIndex: number } | null {
  const perBar = pair.beatsPerBar?.a ?? 4;
  const beats = bars * perBar;
  const [aFrom, aTo] = windowRange(pair.aWindow);
  const [bFrom, bTo] = windowRange(pair.bWindow);
  const settle = leaveAfter(pair);
  const a = pair.a.beats;
  const b = pair.b.beats;
  const speed = pair.a.tempo.bpm / pair.b.tempo.bpm;
  let bIndex: number | null = null;
  for (let j = 0; j + beats < b.length; j += perBar) {
    if (b[j] >= bFrom && b[j + beats] + HANDOVER_SECONDS * speed <= bTo) {
      bIndex = j;
      break;
    }
  }
  if (bIndex === null) return null;
  for (const step of [8 * perBar, perBar]) {
    for (let i = Math.floor((a.length - 1 - beats) / step) * step; i >= 0; i -= step) {
      if (i + beats >= a.length) continue;
      const start = a[i];
      if (start < settle || start - HANDOVER_SECONDS < aFrom) break;
      if (a[i + beats] + HANDOVER_SECONDS <= aTo) return { aIndex: i, bIndex };
    }
  }
  return null;
}

/** Wrap a stem's curve with the takeover from A's full mix (A side only) and the handover to
 * B's full mix at `end`. `points` start at `start` and end at `end`. */
export function withEdges(points: GainPoint[], side: StemSide, start: number, end: number): GainPoint[] {
  const body = points.filter(([at]) => at > start + HANDOVER_SECONDS && at < end - HANDOVER_SECONDS);
  const first = valueAt(points, start + HANDOVER_SECONDS);
  const last = valueAt(points, end - HANDOVER_SECONDS);
  const head: GainPoint[] = side === 'a'
    ? [[start - HANDOVER_SECONDS, 0], [start + HANDOVER_SECONDS, first]]
    : [[start, valueAt(points, start)], [start + HANDOVER_SECONDS, first]];
  return [...head, ...body, [end - HANDOVER_SECONDS, last], [end + HANDOVER_SECONDS, 0]];
}

/** Linear interpolation through gain points, held flat outside them. */
export function valueAt(points: ReadonlyArray<GainPoint>, time: number): number {
  if (!points.length) return 0;
  if (time <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [t1, v1] = points[index];
    if (time <= t1) {
      const [t0, v0] = points[index - 1];
      return t1 === t0 ? v1 : v0 + ((time - t0) * (v1 - v0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

export function nativeGains(start: number, end: number): StemSeamPlan['native'] {
  return {
    a: [[start - HANDOVER_SECONDS, 1], [start + HANDOVER_SECONDS, 0]],
    b: [[end - HANDOVER_SECONDS, 0], [end + HANDOVER_SECONDS, 1]],
  };
}

/** Per-bar pins from A's grid onto B's, B beat `j` sitting on A beat `j - shift`. */
export function barPins(pair: StemPair, fromABeat: number, toABeat: number, shift: number): Array<readonly [number, number]> {
  const perBar = pair.beatsPerBar?.a ?? 4;
  const pins: Array<readonly [number, number]> = [];
  for (let beat = fromABeat; beat <= toABeat; beat += perBar) {
    pins.push([timeAtBeat(pair.a.beats, beat), timeAtBeat(pair.b.beats, beat + shift)]);
  }
  return pins;
}

/** A refusal when a layer reads outside its side's stem window, else null. */
export function outsideWindows(pair: StemPair, layers: StemLayer[], bWarp: ReadonlyArray<readonly [number, number]>): string | null {
  for (const layer of layers) {
    const [from, to] = windowRange(layer.side === 'a' ? pair.aWindow : pair.bWindow);
    const last = layer.side === 'a' ? layer.until : warpAt(bWarp, layer.until);
    if (layer.sourceFrom < from - 1e-9 || last > to + 1e-9) {
      const song = layer.side === 'a' ? 'the first song\'s last' : 'the next song\'s first';
      return `This move would need ${song} stems beyond the stretch that was split (${from.toFixed(1)} to ${to.toFixed(1)} s).`;
    }
  }
  return null;
}
