/** A transition described as data: the browser's twin of src/selecta/render/script.py.
 *
 * A script arrives as JSON (scriptJson.ts) from the account's planner. Each part names its audio
 * by a source reference, never a file, and carries only the song facts the renderer reads. The
 * shapes and the arithmetic follow script.py exactly (docs/engineering/device-render.md).
 */

import { f32, Interpolator, interp } from './npy';

export const SAMPLE_RATE = 44_100;

export const STEM_NAMES = ['vocals', 'drums', 'bass', 'other', 'band'] as const;
export type StemName = (typeof STEM_NAMES)[number];

/** A value that changes over output time: points interpolated linearly (`script.Curve`). */
export class Curve {
  readonly times: Float64Array;
  readonly values: Float64Array;

  constructor(points: ReadonlyArray<readonly [number, number]>) {
    // Python's sorted() is stable, and so is Array.prototype.sort
    const ordered = points.map((point, index) => ({ point, index })).sort((x, y) => x.point[0] - y.point[0] || x.index - y.index);
    this.times = Float64Array.from(ordered, (entry) => entry.point[0]);
    this.values = Float64Array.from(ordered, (entry) => entry.point[1]);
  }

  static constant(value: number): Curve {
    return new Curve([[0, value]]);
  }

  /** `sample(count, rate)`: np.interp at every sample time, rounded to float32. */
  sample(count: number, sampleRate = SAMPLE_RATE, out = new Float32Array(count)): Float32Array {
    const walk = new Interpolator(this.times, this.values);
    for (let index = 0; index < count; index += 1) out[index] = walk.at(index / sampleRate);
    return out;
  }

  at(time: number): number {
    return interp(time, this.times, this.values);
  }

  isConstant(value: number): boolean {
    for (const entry of this.values) if (!(Math.abs(entry - value) < 1e-9)) return false;
    return true;
  }

  points(): [number, number][] {
    return Array.from(this.times, (time, index) => [time, this.values[index]]);
  }
}

/** Output time to source time, piecewise linear between matched points (`script.Warp`). */
export class Warp {
  constructor(readonly output: Float64Array, readonly source: Float64Array) {
    if (output.length !== source.length || output.length < 2) throw new Error('A warp needs two equal lists of at least two times.');
  }

  static identity(outputStart: number, sourceStart: number, duration: number): Warp {
    return new Warp(Float64Array.of(outputStart, outputStart + duration), Float64Array.of(sourceStart, sourceStart + duration));
  }

  private slope(index: number): number {
    return (this.source[index + 1] - this.source[index]) / (this.output[index + 1] - this.output[index]);
  }

  /** Every piece within 2e-4 of real time. */
  get isIdentity(): boolean {
    for (let index = 0; index + 1 < this.output.length; index += 1) if (!(Math.abs(this.slope(index) - 1) < 2e-4)) return false;
    return true;
  }

  /** The largest tempo change this warp asks for, as a fraction (np.max propagates NaN). */
  get maxStretch(): number {
    let largest = -Infinity;
    for (let index = 0; index + 1 < this.output.length; index += 1) {
      const change = Math.abs(this.slope(index) - 1);
      if (Number.isNaN(change)) return NaN;
      if (change > largest) largest = change;
    }
    return largest;
  }

  /** The same mapping over only this stretch of output time. */
  trimmed(start: number, end: number): Warp {
    const output = [start];
    for (const time of this.output) if (time > start && time < end) output.push(time);
    output.push(end);
    const source = output.map((time) => interp(time, this.output, this.source));
    return new Warp(Float64Array.from(output), Float64Array.from(source));
  }

  sourceAt(time: number): number {
    return interp(time, this.output, this.source);
  }
}

export interface Echo {
  delaySeconds: number;
  feedback: number;
  wet: number;
  returnHighpassHz: number;
  dampLowpassHz: number;
}

export interface Wash {
  wet: number;
  decaySeconds: number;
  damping: number;
  returnHighpassHz: number;
}

/** A song's full mix, or one stem of a window of it (`sources.SourceRef`). */
export interface SourceRef {
  song: number | string;
  role: 'mix' | 'stem';
  stem: StemName | null;
  start: number;
  duration: number;
}

/** What the renderer and the audit read about a part's song. A script from JSON carries only the
 * loudness gain: no lyrics, so `vocalsKnown` is false (`sources.SongFacts`). */
export interface SongFacts {
  id: number | string;
  gainDb: number;
  version: number;
  vocalsKnown: boolean;
  lines: ReadonlyArray<readonly [number, number]>;
}

export interface Part {
  source: SourceRef;
  facts: SongFacts;
  warp: Warp;
  gain: Curve;
  low: Curve;
  mid: Curve;
  high: Curve;
  highpass: Curve | null;
  lowpass: Curve | null;
  echo: Echo | null;
  echoSend: Curve | null;
  wash: Wash | null;
  washSend: Curve | null;
  /** Where the part's source begins in the song, for a stem window. */
  windowOrigin: number;
  renderFrom: number | null;
  renderUntil: number | null;
  /** An extra layer of song B, which takes the same nudge as B. */
  followsB: boolean;
}

export type MetaValue = null | boolean | number | string | Curve | MetaValue[] | { [key: string]: MetaValue };

export interface TransitionScript {
  style: string;
  duration: number;
  a: Part;
  b: Part;
  /** Output seconds when both songs sound; equal values mean a cut. */
  overlap: [number, number];
  expectsBeatsAligned: boolean;
  /** Output seconds of intended silence. */
  quietAllowed: number;
  extras: Part[];
  meta: { [key: string]: MetaValue };
  factsVersion: number;
}

/** The warp the part is heard through: trimmed to `renderFrom` / `renderUntil` when set. */
export function heardWarp(part: Part): Warp {
  if (part.renderFrom === null && part.renderUntil === null) return part.warp;
  const first = part.renderFrom === null ? part.warp.output[0] : part.renderFrom;
  const last = part.renderUntil === null ? part.warp.output[part.warp.output.length - 1] : part.renderUntil;
  return part.warp.trimmed(first, last);
}

/** Where native playback of A hands over to the clip, in song seconds. */
export function aSourceStart(script: TransitionScript): number {
  return script.a.warp.sourceAt(0);
}

/** Where native playback of B takes over after the clip, in song seconds. */
export function bSourceEnd(script: TransitionScript): number {
  return script.b.warp.sourceAt(script.duration);
}

/** `float(10 ** (gain_db / 20))` as numpy applies it to a float32 array: rounded to float32. */
export function linearGain(gainDb: number): number {
  return f32(10 ** (gainDb / 20));
}

/** A number of samples, as Python's `int(round(seconds * rate))`. */
export function samplesOf(seconds: number, sampleRate = SAMPLE_RATE): number {
  const value = seconds * sampleRate;
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
