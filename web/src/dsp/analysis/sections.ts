/** Sections: an exact port of `features.py::find_sections` and what it calls (`_similarity`,
 * `segment`, `_group_repeats`). Bars are split into blocks that are alike inside by dynamic
 * programming over a bar-by-bar similarity of timbre and harmony, repeated blocks are grouped,
 * and each block is labelled loosely from its energy. Float64 throughout, as in Python.
 *
 * Work: the similarity is bars squared; the segmentation looks back at most 48 bars per bar.
 */

import { mean, percentile, pyRound } from './numeric';

export const MAX_SECTION_BARS = 48;

export interface Section {
  start_bar: number;
  end_bar: number;
  label: 'intro' | 'verse' | 'chorus' | 'break' | 'outro';
  energy: number;
  group: number;
  chorus_prob: number;
}

export interface SectionInput {
  bars: number;
  /** bars x 20 and bars x 12, row-major. */
  mfccBars: Float64Array;
  chromaBars: Float64Array;
  energyBars: Float64Array;
}

/** Rows centred by the column means, then each scaled to unit length. */
function unitRows(values: Float64Array, bars: number, width: number, from: number, to: number): Float64Array {
  const columns = to - from;
  const out = new Float64Array(bars * columns);
  for (let column = 0; column < columns; column += 1) {
    let total = 0;
    for (let bar = 0; bar < bars; bar += 1) total += values[bar * width + from + column];
    const centre = total / bars;
    for (let bar = 0; bar < bars; bar += 1) out[bar * columns + column] = values[bar * width + from + column] - centre;
  }
  for (let bar = 0; bar < bars; bar += 1) {
    let squares = 0;
    for (let column = 0; column < columns; column += 1) squares += out[bar * columns + column] ** 2;
    const length = Math.max(Math.sqrt(squares), 1e-6);
    for (let column = 0; column < columns; column += 1) out[bar * columns + column] /= length;
  }
  return out;
}

/** Half timbre (MFCC 1..13), half harmony (chroma): cosine similarity of centred bars. */
export function similarity(input: SectionInput): Float64Array {
  const { bars } = input;
  const timbre = unitRows(input.mfccBars, bars, 20, 1, 14);
  const harmony = unitRows(input.chromaBars, bars, 12, 0, 12);
  const out = new Float64Array(bars * bars);
  for (let i = 0; i < bars; i += 1) {
    for (let j = 0; j < bars; j += 1) {
      let t = 0;
      for (let k = 0; k < 13; k += 1) t += timbre[i * 13 + k] * timbre[j * 13 + k];
      let h = 0;
      for (let k = 0; k < 12; k += 1) h += harmony[i * 12 + k] * harmony[j * 12 + k];
      out[i * bars + j] = 0.5 * t + 0.5 * h;
    }
  }
  return out;
}

function lengthPenalty(length: number): number {
  if (length % 8 === 0) return 0;
  if (length % 4 === 0) return 0.08;
  if (length % 2 === 0) return 0.2;
  return 0.32;
}

/** Block matching: the cut points that make blocks alike inside. */
export function segment(sim: Float64Array, bars: number): Array<[number, number]> {
  if (bars < 4) return [[0, bars]];
  const average = mean(sim);
  const size = bars + 1;
  const integral = new Float64Array(size * size);
  // cumsum over rows, then over columns, as numpy takes them
  const rowsDone = new Float64Array(bars * bars);
  for (let j = 0; j < bars; j += 1) {
    let running = 0;
    for (let i = 0; i < bars; i += 1) {
      running += sim[i * bars + j] - average;
      rowsDone[i * bars + j] = running;
    }
  }
  for (let i = 0; i < bars; i += 1) {
    let running = 0;
    for (let j = 0; j < bars; j += 1) {
      running += rowsDone[i * bars + j];
      integral[(i + 1) * size + (j + 1)] = running;
    }
  }
  const at = (i: number, j: number) => integral[i * size + j];
  const best = new Float64Array(size).fill(-Infinity);
  best[0] = 0;
  const previous = new Int32Array(size);
  for (let end = 2; end <= bars; end += 1) {
    let choice = -1;
    let top = -Infinity;
    for (let start = Math.max(0, end - MAX_SECTION_BARS); start < end - 1; start += 1) {
      const block = (at(end, end) - at(start, end) - at(end, start) + at(start, start)) / (end - start);
      const score = best[start] + block - lengthPenalty(end - start) * 4.0 - 0.6;
      if (choice < 0 || score > top) {
        top = score;
        choice = start;
      }
    }
    best[end] = top;
    previous[end] = choice;
  }
  const cuts = [bars];
  while (cuts[cuts.length - 1] > 0) cuts.push(previous[cuts[cuts.length - 1]]);
  cuts.reverse();
  const blocks: Array<[number, number]> = [];
  for (let k = 0; k + 1 < cuts.length; k += 1) blocks.push([cuts[k], cuts[k + 1]]);
  return blocks;
}

/** A group per block: a block joins an earlier one it resembles bar for bar, if any does. */
export function groupRepeats(blocks: Array<[number, number]>, sim: Float64Array, bars: number): number[] {
  const groups: number[] = [];
  let nextGroup = 0;
  blocks.forEach(([start, end], i) => {
    let chosen: number | null = null;
    let best = 0.45;
    for (let j = 0; j < i; j += 1) {
      const [otherStart, otherEnd] = blocks[j];
      const length = Math.min(end - start, otherEnd - otherStart);
      if (length < 2) continue;
      let total = 0;
      for (let k = 0; k < length; k += 1) total += sim[(start + k) * bars + otherStart + k];
      const score = total / length;
      if (score > best) {
        best = score;
        chosen = groups[j];
      }
    }
    if (chosen === null) {
      chosen = nextGroup;
      nextGroup += 1;
    }
    groups.push(chosen);
  });
  return groups;
}

/** Label blocks loosely: probabilities to be snapped to bars, not facts. */
export function findSections(input: SectionInput): Section[] {
  const { bars } = input;
  const sim = similarity(input);
  const blocks = segment(sim, bars);
  const groups = groupRepeats(blocks, sim, bars);
  const energy = input.energyBars;
  const overall = mean(energy);
  const peak = percentile(energy, 90);
  const counts = new Map<number, number>();
  for (const group of groups) counts.set(group, (counts.get(group) ?? 0) + 1);
  return blocks.map(([start, end], i) => {
    const level = mean(energy.subarray(start, end));
    const repeats = (counts.get(groups[i]) ?? 1) - 1;
    const loud = Math.min(Math.max((level - overall) / Math.max(peak - overall, 1e-3), 0), 1);
    let chorus = Math.min(Math.max(0.55 * loud + (0.45 * Math.min(repeats, 2)) / 2, 0), 1);
    let label: Section['label'];
    if (i === 0 && level < overall) {
      label = 'intro';
      chorus = 0;
    } else if (i === blocks.length - 1 && level < overall) {
      label = 'outro';
      chorus = 0;
    } else if (chorus >= 0.6) label = 'chorus';
    else if (level < overall - 0.08) label = 'break';
    else label = 'verse';
    return {
      start_bar: start,
      end_bar: end,
      label,
      energy: pyRound(level, 3),
      group: groups[i],
      chorus_prob: pyRound(chorus, 3),
    };
  });
}
