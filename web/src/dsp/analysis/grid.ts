/** Beat and bar grids: an exact port of `src/selecta/analysis/beats.py` (from `regularize` to
 * `build_grid`), which turns a beat tracker's beats and downbeats into the grid the planner
 * reads. The tracker itself is not here: beats come in, as they do to `build_grid`.
 *
 * Every decision follows the Python one, including numpy's rounding half to even and its
 * float32 percentiles over the onset envelope. Float64 throughout, as in Python.
 */

import { ONSET_HOP_TIME } from './onsetEnvelope';
import {
  argmax, argmin, diff, linspace, median, medianF32, medianFilterNearest, mean, percentile,
  polyfit, roundHalfEven, savgolInterp, searchSorted, std, uniqueInts,
} from './numeric';

export const STEADY_TOLERANCE = 0.03;
export const STEADY_SHARE = 0.7;
export const STEADY_MAX_RMS_MS = 16.0;
export const SMOOTH_WINDOW_BEATS = 17;

export interface BeatGrid {
  beats: Float64Array;
  barStarts: Int32Array;
  rawBeats: Float64Array;
  rawDownbeats: Float64Array;
  beatsPerBar: number;
  bpm: number;
  constantTempo: boolean;
  gridRmsMs: number;
  onsetAgreement: number;
  downbeatRegularity: number;
  tempoStability: number;
  confidence: number;
}

/** The time each bar starts (`BeatGrid.bar_times`). */
export function barTimes(grid: BeatGrid): Float64Array {
  return Float64Array.from(grid.barStarts, (index) => grid.beats[index]);
}

/** Drop spurious beats and fill gaps, so beat indices count musical beats. */
export function regularize(beats: Float64Array): Float64Array {
  if (beats.length < 4) return beats;
  const period = median(diff(beats));
  const out = [beats[0]];
  for (let index = 1; index < beats.length; index += 1) {
    const beat = beats[index];
    const gap = beat - out[out.length - 1];
    if (gap < 0.55 * period) continue;
    const steps = roundHalfEven(gap / period);
    if (steps >= 2) {
      const last = out[out.length - 1];
      for (let k = 1; k < steps; k += 1) out.push(last + (gap * k) / steps);
    }
    out.push(beat);
  }
  return Float64Array.from(out);
}

function peakOffsets(beats: Float64Array, env: Float32Array, window = 0.04): { offsets: Float64Array; strengths: Float64Array } {
  const reach = roundHalfEven(window / ONSET_HOP_TIME);
  const offsets = new Float64Array(beats.length);
  const strengths = new Float64Array(beats.length);
  for (let index = 0; index < beats.length; index += 1) {
    const centre = roundHalfEven(beats[index] / ONSET_HOP_TIME);
    const lo = Math.max(centre - reach, 0);
    const hi = Math.min(centre + reach + 1, env.length);
    if (hi <= lo) continue;
    const peak = argmax(env, lo, hi);
    offsets[index] = (peak - centre) * ONSET_HOP_TIME;
    strengths[index] = env[peak];
  }
  return { offsets, strengths };
}

function strongThreshold(env: Float32Array): number {
  return Math.max(medianF32(env) * 2, percentile(env, 70, true));
}

function coherence(beats: Float64Array, period: number): number {
  let re = 0;
  let im = 0;
  for (let index = 0; index < beats.length; index += 1) {
    const angle = (2 * Math.PI * beats[index]) / period;
    re += Math.cos(angle);
    im += Math.sin(angle);
  }
  return Math.hypot(re / beats.length, im / beats.length);
}

function bestPeriod(beats: Float64Array, candidates: Float64Array): number {
  const scores = new Float64Array(candidates.length);
  for (let index = 0; index < candidates.length; index += 1) scores[index] = coherence(beats, candidates[index]);
  return candidates[argmax(scores)];
}

/** One steady tempo explaining the beats: the grid, the share agreeing, the fit error in ms. */
export function constantGrid(beats: Float64Array): { grid: Float64Array; share: number; rmsMs: number } | null {
  const typical = median(diff(beats));
  let period = bestPeriod(beats, linspace(0.97, 1.03, 1201).map((v) => typical * v));
  period = bestPeriod(beats, linspace(0.9995, 1.0005, 201).map((v) => period * v));

  let re = 0;
  let im = 0;
  for (let index = 0; index < beats.length; index += 1) {
    const angle = (2 * Math.PI * beats[index]) / period;
    re += Math.cos(angle);
    im += Math.sin(angle);
  }
  const angle = Math.atan2(im / beats.length, re / beats.length);
  const offset = (angle / (2 * Math.PI)) * period;
  const index = beats.map((beat) => roundHalfEven((beat - offset) / period));
  const inX: number[] = [];
  const inY: number[] = [];
  for (let k = 0; k < beats.length; k += 1) {
    const residual = beats[k] - (offset + index[k] * period);
    if (Math.abs(residual) <= STEADY_TOLERANCE) {
      inX.push(index[k]);
      inY.push(beats[k]);
    }
  }
  const share = inX.length / beats.length;
  if (share < STEADY_SHARE || inX.length < 16) return null;
  const [slope, intercept] = polyfit(inX, inY, 1);
  let squares = 0;
  for (let k = 0; k < inX.length; k += 1) {
    const fitted = inY[k] - (slope * inX[k] + intercept);
    squares += fitted * fitted;
  }
  const rmsMs = Math.sqrt(squares / inX.length) * 1000;
  if (rmsMs > STEADY_MAX_RMS_MS) return null;
  let first = Infinity;
  let last = -Infinity;
  for (const value of index) {
    if (value < first) first = value;
    if (value > last) last = value;
  }
  const grid = new Float64Array(last - first + 1);
  for (let k = 0; k < grid.length; k += 1) grid[k] = slope * (first + k) + intercept;
  return { grid, share, rmsMs };
}

/** For music that really moves: follow the tempo, not the tracker's beat-to-beat noise. */
export function smoothGrid(beats: Float64Array): Float64Array {
  const intervals = diff(beats);
  const typical = medianFilterNearest(intervals, 9);
  const clean = intervals.map((interval, k) => (Math.abs(interval / typical[k] - 1) > 0.12 ? typical[k] : interval));
  const rebuilt = new Float64Array(beats.length);
  let running = 0;
  rebuilt[0] = beats[0] + 0;
  for (let k = 0; k < clean.length; k += 1) {
    running += clean[k];
    rebuilt[k + 1] = beats[0] + running;
  }
  const window = Math.min(SMOOTH_WINDOW_BEATS, rebuilt.length % 2 ? rebuilt.length : rebuilt.length - 1);
  const smooth = window >= 5 ? savgolInterp(rebuilt, window, 2) : rebuilt;
  const drift = medianFilterNearest(beats.map((beat, k) => beat - smooth[k]), window);
  const trend = savgolInterp(drift, window, 1);
  const out = new Float64Array(beats.length);
  let highest = -Infinity;
  for (let k = 0; k < out.length; k += 1) {
    highest = Math.max(highest, smooth[k] + trend[k]);
    out[k] = highest;
  }
  return out;
}

/** Refined beats, whether tempo is constant, fit error in ms, and onset agreement. */
export function fitGrid(rawBeats: Float64Array, beats: Float64Array, env: Float32Array): { grid: Float64Array; constant: boolean; rmsMs: number; agreement: number } {
  const steady = constantGrid(rawBeats);
  let grid: Float64Array;
  let rmsMs: number;
  let constant: boolean;
  if (steady) {
    grid = steady.grid;
    rmsMs = steady.rmsMs;
    constant = true;
  } else {
    grid = smoothGrid(beats);
    let squares = 0;
    for (let k = 0; k < grid.length; k += 1) squares += (grid[k] - beats[k]) ** 2;
    rmsMs = Math.sqrt(squares / grid.length) * 1000;
    constant = false;
  }
  const threshold = strongThreshold(env);
  const first = peakOffsets(grid, env);
  const strongOffsets: number[] = [];
  for (let k = 0; k < grid.length; k += 1) if (first.strengths[k] >= threshold) strongOffsets.push(first.offsets[k]);
  if (strongOffsets.length >= 8) {
    const shift = median(strongOffsets);
    grid = grid.map((beat) => beat + shift);
  }
  const last = peakOffsets(grid, env, 0.03);
  let hits = 0;
  for (let k = 0; k < grid.length; k += 1) {
    if (last.strengths[k] >= threshold && Math.abs(last.offsets[k]) <= 0.03) hits += 1;
  }
  return { grid, constant, rmsMs, agreement: hits / grid.length };
}

/** Choose a bar grid, allowing the phase to shift where a song really changes. */
export function fitBars(beats: Float64Array, downbeats: Float64Array): { bars: Int32Array; meter: number; regularity: number } {
  const everyFour = () => {
    const bars = new Int32Array(Math.ceil(beats.length / 4));
    for (let k = 0; k < bars.length; k += 1) bars[k] = 4 * k;
    return { bars, meter: 4, regularity: 0 };
  };
  if (downbeats.length < 2 || beats.length < 4) return everyFour();

  const chosen: number[] = [];
  for (const downbeat of downbeats) {
    const nearest = Math.min(Math.max(searchSorted(beats, downbeat), 1), beats.length - 1);
    const left = beats[nearest - 1];
    const right = beats[nearest];
    const index = downbeat - left < right - downbeat ? nearest - 1 : nearest;
    if (Math.abs(beats[index] - downbeat) <= 0.09) chosen.push(index);
  }
  const index = uniqueInts(chosen);
  if (index.length < 2) return everyFour();

  let threes = 0;
  let fours = 0;
  for (let k = 1; k < index.length; k += 1) {
    const gap = index[k] - index[k - 1];
    if (gap === 3) threes += 1;
    if (gap === 4) fours += 1;
  }
  const meter = threes > fours ? 3 : 4;

  const phases = index.map((value) => value % meter);
  const costs = index.map(() => new Float64Array(meter).fill(Infinity));
  const back = index.map(() => new Int32Array(meter));
  const switchCost = 6.0;
  for (let state = 0; state < meter; state += 1) costs[0][state] = phases[0] !== state ? 1 : 0;
  for (let i = 1; i < index.length; i += 1) {
    for (let state = 0; state < meter; state += 1) {
      const mismatch = phases[i] !== state ? 1 : 0;
      const stay = costs[i - 1][state];
      const move = Float64Array.from(costs[i - 1], (cost) => cost + switchCost);
      move[state] = Infinity;
      const bestMove = argmin(move);
      if (stay <= move[bestMove]) {
        costs[i][state] = stay + mismatch;
        back[i][state] = state;
      } else {
        costs[i][state] = move[bestMove] + mismatch;
        back[i][state] = bestMove;
      }
    }
  }
  const states = new Int32Array(index.length);
  states[index.length - 1] = argmin(costs[index.length - 1]);
  for (let i = index.length - 1; i > 0; i -= 1) states[i - 1] = back[i][states[i]];

  let agree = 0;
  for (let i = 0; i < index.length; i += 1) if (phases[i] === states[i]) agree += 1;
  const regularity = agree / index.length;

  const starts: number[] = [];
  for (let i = 0; i < states.length; i += 1) {
    const state = states[i];
    const start = i === 0 ? 0 : index[i - 1] + 1;
    const end = i === index.length - 1 ? beats.length : index[i] + 1;
    const first = start + (((state - start) % meter) + meter) % meter;
    for (let bar = first; bar < end; bar += meter) starts.push(bar);
  }
  let bars = uniqueInts(starts);
  if (bars.length > 1) bars = bars.filter((bar, k) => k === 0 || bar - bars[k - 1] >= meter - 1);
  return { bars: Int32Array.from(bars), meter, regularity };
}

/** 1.0 for a click track, falling as local tempo wanders. */
export function tempoStability(beats: Float64Array): number {
  if (beats.length < 12) return 0;
  const local = new Float64Array(beats.length - 8);
  for (let k = 0; k < local.length; k += 1) local[k] = (beats[k + 8] - beats[k]) / 8;
  return Math.min(Math.max(1 - std(local) / mean(local) / 0.05, 0), 1);
}

/** The grid from a tracker's beats and downbeats and the onset envelope, or null when there
 * is no steady beat (fewer than 16 beats once regularised). */
export function buildGrid(rawBeats: Float64Array, rawDownbeats: Float64Array, env: Float32Array): BeatGrid | null {
  const beats = regularize(rawBeats);
  if (beats.length < 16) return null;
  const fit = fitGrid(rawBeats, beats, env);
  const bars = fitBars(fit.grid, rawDownbeats);
  const stability = fit.constant ? 1 : tempoStability(fit.grid);
  const bpm = 60 / median(diff(fit.grid));
  const confidence = Math.min(Math.max((0.5 * fit.agreement + 0.5 * bars.regularity) * (0.35 + 0.65 * stability), 0), 1);
  return {
    beats: fit.grid,
    barStarts: bars.bars,
    rawBeats,
    rawDownbeats,
    beatsPerBar: bars.meter,
    bpm,
    constantTempo: fit.constant,
    gridRmsMs: fit.rmsMs,
    onsetAgreement: fit.agreement,
    downbeatRegularity: bars.regularity,
    tempoStability: stability,
    confidence,
  };
}
