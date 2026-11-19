/** Hearing a voice in the separated vocal stem, with no lyrics.
 *
 * Ports of src/selecta/analysis/vocal_sense.py `singing_spans` (where someone is singing) and
 * src/selecta/planner/wordreel.py `voice_edge` (exactly where a line stops or starts), so a ride
 * can be timed on any song in any language.
 */

import type { StemWindow } from './types';

export const FRAME_SECONDS = 0.05;
/** A voice stem louder than this is someone singing. */
export const PRESENT_DB = -35;
export const MIN_SING_SECONDS = 0.3;
/** A breath inside a line, not a gap between lines. */
export const JOIN_GAP_SECONDS = 0.35;

export const EDGE_FRAME_SECONDS = 0.02;
export const MIN_VOICE_DB = -38;
/** This far below a line's loud parts, the voice counts as having stopped. */
export const VOICE_REST_DB = 24;
export const MIN_REST_SECONDS = 0.12;

export type Span = readonly [start: number, end: number];

function frameRms(samples: Float32Array, from: number, to: number, frame: number): Float64Array {
  const count = Math.floor((to - from) / frame);
  const levels = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    let sum = 0;
    const base = from + index * frame;
    for (let offset = 0; offset < frame; offset += 1) {
      const value = samples[base + offset];
      sum += value * value;
    }
    levels[index] = Math.sqrt(sum / frame);
  }
  return levels;
}

/** Stretches of audible singing in the window, in song seconds, as vocal_sense.py finds them. */
export function singingSpans(window: StemWindow): Span[] {
  const frame = Math.max(Math.trunc(FRAME_SECONDS * window.sampleRate), 1);
  const levels = frameRms(window.vocals, 0, window.vocals.length, frame);
  const spans: Array<[number, number]> = [];
  let opened: number | null = null;
  for (let index = 0; index <= levels.length; index += 1) {
    const present = index < levels.length && 20 * Math.log10(Math.max(levels[index], 1e-9)) >= PRESENT_DB;
    const time = window.origin + index * FRAME_SECONDS;
    if (present && opened === null) {
      opened = time;
    } else if (!present && opened !== null) {
      const last = spans[spans.length - 1];
      if (last && opened - last[1] <= JOIN_GAP_SECONDS) last[1] = time;
      else if (time - opened >= MIN_SING_SECONDS) spans.push([opened, time]);
      opened = null;
    }
  }
  return spans.filter(([start, end]) => end - start >= MIN_SING_SECONDS);
}

/** Seconds of singing between `from` and `to`. */
export function singingSeconds(spans: readonly Span[], from: number, to: number): number {
  let total = 0;
  for (const [start, end] of spans) total += Math.max(0, Math.min(end, to) - Math.max(start, from));
  return total;
}

/** numpy's default (linear) percentile. */
export function percentile(values: ArrayLike<number>, share: number): number {
  const sorted = Array.from(values).sort((x, y) => x - y);
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * share;
  const low = Math.floor(position);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low] + (position - low) * (sorted[high] - sorted[low]);
}

/** Where the singing itself stops (`atEnd`) or starts near a line, or null when there's no clear
 * voice there. `line` is a sung span; `nextStart` is where the following one begins. */
export function voiceEdge(window: StemWindow, line: Span, nextStart: number, atEnd: boolean): number | null {
  const rate = window.sampleRate;
  const mono = window.vocals;
  const hop = Math.trunc(EDGE_FRAME_SECONDS * rate);
  const [lineStart, lineEnd] = line;
  const lo = Math.max(lineStart - 1, window.origin);
  const hi = Math.min(Math.max(lineEnd, nextStart) + 1, window.origin + mono.length / rate);
  const from = Math.max(Math.trunc((lo - window.origin) * rate), 0);
  const to = Math.min(Math.trunc((hi - window.origin) * rate), mono.length);
  if (to - from < hop * 10) return null;
  const level = frameRms(mono, from, to, hop);
  const loud = percentile(level, 0.9);
  if (20 * Math.log10(Math.max(loud, 1e-7)) < MIN_VOICE_DB) return null;
  const floor = loud * 10 ** (-VOICE_REST_DB / 20);
  const voiced = Array.from(level, (value) => value > floor);
  const times = Array.from(level, (_, index) => lo + (index + 0.5) * EDGE_FRAME_SECONDS);
  const rest = Math.trunc(MIN_REST_SECONDS / EDGE_FRAME_SECONDS);
  const anyVoiced = (start: number, end: number) => voiced.slice(Math.max(start, 0), end).some(Boolean);
  let target: number;
  let reach: [number, number];
  const edges: number[] = [];
  if (atEnd) {
    target = lineEnd;
    reach = [lineStart + 0.3 * (lineEnd - lineStart), lineEnd + 0.8];
    for (let index = 0; index < level.length - 1; index += 1) {
      if (voiced[index] && !anyVoiced(index + 1, index + 1 + rest)) edges.push(index);
    }
  } else {
    target = lineStart;
    reach = [lineStart - 1, lineStart + 1];
    for (let index = 1; index < level.length; index += 1) {
      if (voiced[index] && !anyVoiced(index - rest, index)) edges.push(index);
    }
  }
  const inside = edges.filter((index) => reach[0] <= times[index] && times[index] <= reach[1]);
  if (inside.length) {
    let best = inside[0];
    for (const index of inside) if (Math.abs(times[index] - target) < Math.abs(times[best] - target)) best = index;
    return times[best];
  }
  // no clean rest, as in rap with no gap between lines: the quietest moment nearby
  let quietest: number | null = null;
  for (let index = 0; index < level.length; index += 1) {
    if (Math.abs(times[index] - target) <= 0.4 && (quietest === null || level[index] < level[quietest])) quietest = index;
  }
  return quietest === null ? null : times[quietest];
}

/** How loud the voice is around `time` (plus or minus `reach` seconds), as plain amplitude,
 * as arrange.py `listen` measures A's voice at each square boundary. */
export function voiceLoudnessAround(window: StemWindow, time: number, reach = 0.25): number {
  const rate = window.sampleRate;
  const at = Math.trunc((time - window.origin) * rate);
  const span = Math.trunc(reach * rate);
  const from = Math.max(at - span, 0);
  const to = Math.min(at + span, window.vocals.length);
  if (to <= from) return 10 ** (-120 / 20);
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += window.vocals[index] * window.vocals[index];
  const decibels = 20 * Math.log10(Math.sqrt(sum / (to - from)) + 1e-6);
  return 10 ** (decibels / 20);
}
