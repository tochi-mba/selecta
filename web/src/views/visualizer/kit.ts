import type { Features, Hit } from './features';

/** Theme colours read from the live tokens (forced colours swap in system colours). */
export type Brush = {
  accent: string;
  soft: string;
  gradient: CanvasGradient | string;
  /** --request, --warn and --ink; optional so older callers still paint. */
  cool?: string;
  warm?: string;
  ink?: string;
};

export type Particle = { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number; colour: 0 | 1 | 2 };

/** Per-style memory between frames. Every entry is built from measured features only. */
export type VisualState = {
  mode: string;
  peaks: Float32Array | null;
  columns: { levels: Float32Array; kick: number; snare: number }[];
  events: Hit[];
  particles: Particle[];
  trail: { x: number; y: number }[];
  streams: Float32Array[];
  prevWave: Float32Array | null;
  sectionColour: { from: number; to: number };
  sectionMarks: number[];
};

export function createVisualState(mode = ''): VisualState {
  return {
    mode, peaks: null, columns: [], events: [], particles: [], trail: [], streams: [],
    prevWave: null, sectionColour: { from: 0, to: 0 }, sectionMarks: [],
  };
}

export function clearVisualState(state: VisualState) {
  Object.assign(state, createVisualState(state.mode));
}

export type Painter = (context: CanvasRenderingContext2D, width: number, height: number, features: Features, brush: Brush, state: VisualState) => void;

/** A stable pseudo-random number for a given seed: layout decoration, never signal. */
export function hash(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** Linear resample of measured levels to `count` points (interpolates between real bins only). */
export function resample(levels: ArrayLike<number>, count: number, from = 0, to = 1): number[] {
  const n = levels.length;
  const out = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    const at = (from + (to - from) * (count === 1 ? 0 : index / (count - 1))) * (n - 1);
    const low = Math.floor(at);
    const high = Math.min(n - 1, low + 1);
    out[index] = levels[low] + (levels[high] - levels[low]) * (at - low);
  }
  return out;
}

export function colour(brush: Brush, which: number): string {
  const all = [brush.accent, brush.soft, brush.cool ?? brush.soft, brush.warm ?? brush.accent];
  return all[((which % all.length) + all.length) % all.length];
}

/** Keep the newest `limit` entries of a list, in place. */
export function cap<T>(list: T[], limit: number) {
  if (list.length > limit) list.splice(0, list.length - limit);
}

export function smoothLine(context: CanvasRenderingContext2D, xs: number[], ys: number[]) {
  context.moveTo(xs[0], ys[0]);
  for (let index = 1; index < xs.length; index += 1) {
    const mx = (xs[index - 1] + xs[index]) / 2;
    const my = (ys[index - 1] + ys[index]) / 2;
    context.quadraticCurveTo(xs[index - 1], ys[index - 1], mx, my);
  }
  context.lineTo(xs[xs.length - 1], ys[ys.length - 1]);
}
