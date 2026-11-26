/** `dsp.stretch_to_warp`: a part's source played so each matched source point lands on its output
 * time, then the stretcher's slow drift measured and removed.
 *
 * Everything around the stretch is ported as Python has it. The stretch itself is injected: the
 * Desktop uses Rubber Band (pedalboard `time_stretch`, high quality, crisp transients), which the
 * browser does not have, so a `Stretcher` stands in and its id travels with every result. The
 * one implementation today is the browser's WSOLA (../stretch.ts). Its output is not Rubber
 * Band's and is never presented as the Python engine's (docs/engineering/device-render.md).
 */

import { timeStretch, type StretchUnsupported } from '../stretch';
import { correctDrift, ENV_HOP, ENV_HOP_TIME, monoOf, transientEnvelope } from './envelope';
import type { Channels } from './filters';
import { roundHalfEven } from './npy';
import { SAMPLE_RATE } from './script';

/** How fast each stretch of the input plays: input sample `starts[k]` onwards at `ratios[k]`
 * (source seconds per output second; above 1 is faster), as pedalboard reads an array
 * `stretch_factor` with one value per input sample. */
export interface StretchPieces {
  starts: number[];
  ratios: number[];
}

export interface Stretcher {
  /** Names the implementation; a render records it. */
  id: string;
  stretch(channels: Channels, sampleRate: number, pieces: StretchPieces): Channels | StretchUnsupported;
}

/** The browser's WSOLA, driven by the pieces as a tempo curve over output time. */
export const wsolaStretcher: Stretcher = {
  id: 'wsola-stretch-v1',
  stretch(channels, sampleRate, pieces) {
    const total = channels[0].length;
    const ends: number[] = [];
    let elapsed = 0;
    pieces.starts.forEach((start, k) => {
      const stop = k + 1 < pieces.starts.length ? pieces.starts[k + 1] : total;
      elapsed += (stop - start) / pieces.ratios[k] / sampleRate;
      ends.push(elapsed);
    });
    let piece = 0;
    const curve = (seconds: number): number => {
      if (piece > 0 && seconds < ends[piece - 1]) piece = 0;
      while (piece < ends.length - 1 && seconds >= ends[piece]) piece += 1;
      return pieces.ratios[piece];
    };
    const result = timeStretch(channels, sampleRate, curve);
    return result.status === 'ready' ? result.channels : result;
  },
};

export type StretchedPart = { status: 'ready'; audio: Channels; drift: number } | StretchUnsupported;

/** A Python `int(round(x))`. */
const intRound = roundHalfEven;

/** `stretch_to_warp(source, warp_output, warp_source, source_start)`. `source` holds the song from
 * sample `sourceOffset` onwards (its window), and `sourceStart` is where sample 0 of the whole
 * source sits in the song (the part's `window_origin`). */
export function stretchToWarp(
  source: Channels,
  sourceOffset: number,
  warpOutput: Float64Array,
  warpSource: Float64Array,
  sourceStart: number,
  stretcher: Stretcher,
): StretchedPart {
  const context = 0.5;
  const firstSource = warpSource[0] - context;
  const lastSource = warpSource[warpSource.length - 1] + context;
  const begin = intRound((firstSource - sourceStart) * SAMPLE_RATE);
  const end = intRound((lastSource - sourceStart) * SAMPLE_RATE);
  const from = Math.max(begin, 0);
  const available = sourceOffset + source[0].length;
  const to = Math.min(end, available);
  if (from < sourceOffset && to > from) throw new Error('the source window starts after the audio this part needs');
  const segment = source.map((channel) => channel.slice(Math.max(0, from - sourceOffset), Math.max(0, to - sourceOffset)));
  const length = segment[0].length;
  if (length === 0) return { status: 'ready', audio: source.map(() => new Float32Array(0)), drift: 0 };

  // each input sample takes the slope of the warp piece its song time falls in
  const slopes: number[] = [];
  for (let k = 0; k + 1 < warpSource.length; k += 1) slopes.push((warpSource[k + 1] - warpSource[k]) / (warpOutput[k + 1] - warpOutput[k]));
  const pieceOf = (time: number): number => {
    // searchsorted(side="right") - 1, clipped to the pieces
    let low = 0;
    let high = warpSource.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (warpSource[mid] <= time) low = mid + 1;
      else high = mid;
    }
    return Math.min(Math.max(low - 1, 0), slopes.length - 1);
  };
  const timeOf = (index: number): number => sourceStart + (from + index) / SAMPLE_RATE;
  const pieces: StretchPieces = { starts: [], ratios: [] };
  const perSample = new Float64Array(slopes.length);
  slopes.forEach((slope, k) => {
    perSample[k] = 1.0 / slope / SAMPLE_RATE;
  });
  const sampleSlope = new Int32Array(length);
  for (let index = 0; index < length; index += 1) {
    const k = pieceOf(timeOf(index));
    sampleSlope[index] = k;
    if (index === 0 || sampleSlope[index - 1] !== k) {
      pieces.starts.push(index);
      pieces.ratios.push(slopes[k]);
    }
  }
  const stretched = stretcher.stretch(segment, SAMPLE_RATE, pieces);
  if (!Array.isArray(stretched)) return stretched;

  // output_position = [0, cumsum(1 / ratio / rate)], read where Python reads it
  const headIndex = intRound((warpSource[0] - timeOf(0)) * SAMPLE_RATE);
  const count = intRound((warpOutput[warpOutput.length - 1] - warpOutput[0]) * SAMPLE_RATE);
  const sourceEnvelope = transientEnvelope(monoOf(segment));
  const expected = new Float64Array(Math.trunc(stretched[0].length / ENV_HOP) + 2);
  let position = 0;
  let walked = 0;
  const positionAt = (index: number): number => {
    if (index < walked) {
      // the cumulative sum again from the start, so every value is the one cumsum gives
      position = 0;
      walked = 0;
    }
    while (walked < index) {
      position += perSample[sampleSlope[walked]];
      walked += 1;
    }
    return position;
  };
  const lastIndex = length;
  // the head comes first: the running sum only walks forwards
  if (headIndex < 0 || headIndex > lastIndex) throw new Error('the warp starts outside the audio read for it');
  const head = positionAt(headIndex);
  const targets = new Float64Array(sourceEnvelope.length);
  for (let frame = 0; frame < sourceEnvelope.length; frame += 1) {
    const x = frame * ENV_HOP_TIME * SAMPLE_RATE;
    if (x >= lastIndex) {
      targets[frame] = positionAt(lastIndex);
      continue;
    }
    const j = Math.floor(x);
    const left = positionAt(j);
    if (x === j) {
      targets[frame] = left;
      continue;
    }
    const right = left + perSample[sampleSlope[j]];
    targets[frame] = (right - left) * (x - j) + left;
  }
  for (let frame = 0; frame < sourceEnvelope.length; frame += 1) {
    const slot = Math.min(Math.max(Math.trunc(targets[frame] / ENV_HOP_TIME), 0), expected.length - 1);
    if (sourceEnvelope[frame] > expected[slot]) expected[slot] = sourceEnvelope[frame];
  }

  const headSamples = intRound(head * SAMPLE_RATE);
  const corrected = correctDrift(stretched, expected, headSamples + count);
  return {
    status: 'ready',
    audio: corrected.audio.map((channel) => channel.slice(headSamples, headSamples + count)),
    drift: corrected.drift,
  };
}
