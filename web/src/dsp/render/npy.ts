/** numpy rules the renderer and the audit depend on, reproduced exactly.
 *
 * The Desktop renderer (src/selecta/render/) works in float32 numpy arrays. Where numpy's answer
 * depends on how it rounds or sums (pairwise float32 sums, a Python float meeting a float32
 * array, `np.interp`'s edge rules, `np.arange`'s fill), the rule is written here once so every
 * stage takes the decision Python takes. docs/engineering/device-render.md is the contract.
 */

export const f32 = Math.fround;

/** numpy's float32 pairwise sum (`pairwise_sum_FLOAT`): under 8 values one by one, up to 128 with
 * eight running sums, above that the two halves (cut on a multiple of 8) summed apart. Every
 * step is float32. With `square`, each value is squared in float32 first (`x**2` then sum). */
export function pairwiseSum(values: ArrayLike<number>, offset: number, count: number, square = false): number {
  if (count < 8) {
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      const value = values[offset + index];
      total = f32(total + (square ? f32(value * value) : value));
    }
    return total;
  }
  if (count <= 128) {
    const r = accumulators;
    for (let lane = 0; lane < 8; lane += 1) {
      const value = values[offset + lane];
      r[lane] = square ? f32(value * value) : value;
    }
    let index = 8;
    const whole = count - (count % 8);
    for (; index < whole; index += 8) {
      for (let lane = 0; lane < 8; lane += 1) {
        const value = values[offset + index + lane];
        r[lane] = f32(r[lane] + (square ? f32(value * value) : value));
      }
    }
    let total = f32(f32(f32(r[0] + r[1]) + f32(r[2] + r[3])) + f32(f32(r[4] + r[5]) + f32(r[6] + r[7])));
    for (; index < count; index += 1) {
      const value = values[offset + index];
      total = f32(total + (square ? f32(value * value) : value));
    }
    return total;
  }
  let half = Math.floor(count / 2);
  half -= half % 8;
  const left = pairwiseSum(values, offset, half, square);
  return f32(left + pairwiseSum(values, offset + half, count - half, square));
}

const accumulators = new Float64Array(8);

/** numpy's float64 pairwise sum (the same blocks as the float32 one, in double). */
export function pairwiseSum64(values: ArrayLike<number>, offset: number, count: number): number {
  if (count < 8) {
    let total = 0;
    for (let index = 0; index < count; index += 1) total += values[offset + index];
    return total;
  }
  if (count <= 128) {
    const r = accumulators;
    for (let lane = 0; lane < 8; lane += 1) r[lane] = values[offset + lane];
    let index = 8;
    const whole = count - (count % 8);
    for (; index < whole; index += 8) for (let lane = 0; lane < 8; lane += 1) r[lane] += values[offset + index + lane];
    let total = r[0] + r[1] + (r[2] + r[3]) + (r[4] + r[5] + (r[6] + r[7]));
    for (; index < count; index += 1) total += values[offset + index];
    return total;
  }
  let half = Math.floor(count / 2);
  half -= half % 8;
  return pairwiseSum64(values, offset, half) + pairwiseSum64(values, offset + half, count - half);
}

/** `np.mean` of a float32 range: the pairwise sum over the count, in float32. */
export function meanF32(values: ArrayLike<number>, offset = 0, count = values.length - offset, square = false): number {
  return f32(pairwiseSum(values, offset, count, square) / count);
}

/** `np.interp(x, xp, fp)` for one value, by numpy's rules: the first value before the first
 * point, the last after the last, a point hit exactly gives its own value. */
export function interp(x: number, xp: ArrayLike<number>, fp: ArrayLike<number>): number {
  const n = xp.length;
  if (Number.isNaN(x)) return x;
  if (x > xp[n - 1]) return fp[n - 1];
  if (x < xp[0]) return fp[0];
  let low = 0;
  let high = n;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (x >= xp[mid]) low = mid + 1;
    else high = mid;
  }
  const j = low - 1;
  if (j === n - 1 || xp[j] === x) return fp[j];
  const slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
  let value = slope * (x - xp[j]) + fp[j];
  if (Number.isNaN(value)) {
    value = slope * (x - xp[j + 1]) + fp[j + 1];
    if (Number.isNaN(value) && fp[j] === fp[j + 1]) value = fp[j];
  }
  return value;
}

/** Walks increasing x values through `np.interp` without a search per value. */
export class Interpolator {
  private j = 0;
  constructor(private readonly xp: ArrayLike<number>, private readonly fp: ArrayLike<number>) {}

  at(x: number): number {
    const { xp, fp } = this;
    const n = xp.length;
    if (Number.isNaN(x)) return x;
    if (x > xp[n - 1]) return fp[n - 1];
    if (x < xp[0]) return fp[0];
    let j = this.j;
    if (j >= n || xp[j] > x) j = 0;
    while (j + 1 < n && xp[j + 1] <= x) j += 1;
    this.j = j;
    if (j === n - 1 || xp[j] === x) return fp[j];
    const slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
    let value = slope * (x - xp[j]) + fp[j];
    if (Number.isNaN(value)) {
      value = slope * (x - xp[j + 1]) + fp[j + 1];
      if (Number.isNaN(value) && fp[j] === fp[j + 1]) value = fp[j];
    }
    return value;
  }
}

/** `np.arange(start, stop, step)` for floats: `ceil((stop - start) / step)` values, the second
 * `start + step`, the rest `start + i * ((start + step) - start)`. */
export function arange(start: number, stop: number, step: number): Float64Array {
  const length = Math.max(0, Math.ceil((stop - start) / step));
  const out = new Float64Array(length);
  if (length === 0) return out;
  out[0] = start;
  if (length === 1) return out;
  out[1] = start + step;
  const delta = out[1] - start;
  for (let index = 2; index < length; index += 1) out[index] = start + index * delta;
  return out;
}

/** Python's `round(x)` and numpy's rint: half to even. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** `int(x)`: towards zero. */
export const truncate = Math.trunc;

const I0A = [
  -4.4153416464793393795e-18, 3.33079451882223809783e-17, -2.43127984654795469359e-16, 1.71539128555513303061e-15,
  -1.16853328779934516808e-14, 7.67618549860493561688e-14, -4.8564467831119294609e-13, 2.95505266312963983461e-12,
  -1.72682629144155570723e-11, 9.67580903537323691224e-11, -5.18979560163526290666e-10, 2.65982372468238665035e-9,
  -1.30002500998624804212e-8, 6.04699502254191894932e-8, -2.67079385394061173391e-7, 1.11738753912010371815e-6,
  -4.41673835845875056359e-6, 1.64484480707288970893e-5, -5.75419501008210370398e-5, 1.88502885095841655729e-4,
  -5.76375574538582365885e-4, 1.63947561694133579842e-3, -4.3243099950505759443e-3, 1.05464603945949983183e-2,
  -2.37374148058994688156e-2, 4.93052842396707084878e-2, -9.4901097048047644421e-2, 1.71620901522208775349e-1,
  -3.04682672343198398683e-1, 6.76795274409476084995e-1,
];
const I0B = [
  -7.23318048787475395456e-18, -4.83050448594418207126e-18, 4.46562142029675999901e-17, 3.4612228676974610931e-17,
  -2.82762398051658348494e-16, -3.42548561967721913462e-16, 1.7725601330565263836e-15, 3.81168066935262242075e-15,
  -9.5548466988283076487e-15, -4.15056934728722208663e-14, 1.54008621752140982691e-14, 3.85277838274214270114e-13,
  7.18012445138366623367e-13, -1.79417853150680611778e-12, -1.32158118404477131188e-11, -3.14991652796324136454e-11,
  1.18891471078464383424e-11, 4.9406023882249695891e-10, 3.39623202570838634515e-9, 2.26666899049817806459e-8,
  2.04891858946906374183e-7, 2.89137052083475648297e-6, 6.88975834691682398426e-5, 3.3691164782556940899e-3,
  8.04490411014108831608e-1,
];

function chbevl(x: number, values: number[]): number {
  let b0 = values[0];
  let b1 = 0;
  let b2 = 0;
  for (let index = 1; index < values.length; index += 1) {
    b2 = b1;
    b1 = b0;
    b0 = x * b1 - b2 + values[index];
  }
  return 0.5 * (b0 - b2);
}

/** `np.i0`: Cephes' Chebyshev expansions, as numpy writes them in Python. */
export function i0(value: number): number {
  const x = Math.abs(value);
  if (x <= 8) return Math.exp(x) * chbevl(x / 2 - 2, I0A);
  return (Math.exp(x) * chbevl(32 / x - 2, I0B)) / Math.sqrt(x);
}

/** `np.kaiser(size, beta)`. */
export function kaiser(size: number, beta: number): Float64Array {
  const out = new Float64Array(size);
  if (size === 1) {
    out[0] = 1;
    return out;
  }
  const alpha = (size - 1) / 2;
  const norm = i0(beta);
  for (let n = 0; n < size; n += 1) {
    const ratio = (n - alpha) / alpha;
    out[n] = i0(beta * Math.sqrt(1 - ratio * ratio)) / norm;
  }
  return out;
}

/** `np.sinc`: sin(pi x) / (pi x), with x = 0 read as 1e-20. */
export function sinc(x: number): number {
  const y = Math.PI * (x === 0 ? 1e-20 : x);
  return Math.sin(y) / y;
}

// numpy rules the whole-song analysis port already wrote (percentile in float32, Python's round)
export { percentile, median, medianFilterNearest, pyRound, argmax, linspace } from '../analysis/numeric';
