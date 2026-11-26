/** numpy and scipy behaviours the whole-song ports depend on, reproduced exactly.
 *
 * The Desktop analysis (src/selecta/analysis/) leans on numpy's rounding, medians, percentiles
 * and least-squares fits. Where a numpy rule differs from the obvious JavaScript one (rounding
 * half to even, percentile interpolation in float32), the numpy rule is written here so every
 * port takes the same decision Python takes. docs/engineering/device-analysis.md is the contract.
 */

const f32 = Math.fround;

/** numpy's `round` and Python's `round(x)`: half to even. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python's `round(x, digits)`: correctly rounded from the double's exact value, ties to even. */
export function pyRound(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  // the exact decimal expansion, far enough past the kept digits to see a true tie
  const exact = Math.abs(value).toFixed(Math.min(100, digits + 40));
  const point = exact.indexOf('.');
  const kept = Number(exact.slice(0, point) + exact.slice(point + 1, point + 1 + digits));
  const tail = exact.slice(point + 1 + digits);
  let units = kept;
  if (/^50*$/.test(tail)) units = kept % 2 === 0 ? kept : kept + 1;
  else if (tail[0] >= '5') units = kept + 1;
  const magnitude = units / 10 ** digits;
  return value < 0 ? -magnitude : magnitude;
}

/** Index of the first largest value (numpy argmax); -1 for an empty range. */
export function argmax(values: ArrayLike<number>, from = 0, to = values.length): number {
  let best = -1;
  let top = -Infinity;
  for (let index = from; index < to; index += 1) {
    if (values[index] > top || best < 0) {
      top = values[index];
      best = index;
    }
  }
  return best;
}

/** Index of the first smallest value (numpy argmin). */
export function argmin(values: ArrayLike<number>): number {
  let best = -1;
  let low = Infinity;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] < low || best < 0) {
      low = values[index];
      best = index;
    }
  }
  return best;
}

function sortedCopy(values: ArrayLike<number>): Float64Array {
  const copy = Float64Array.from(values as ArrayLike<number>);
  copy.sort();
  return copy;
}

/** np.median of float64 values. */
export function median(values: ArrayLike<number>): number {
  const sorted = sortedCopy(values);
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** np.median of a float32 array: the mean of the middle two is taken in float32. */
export function medianF32(values: ArrayLike<number>): number {
  const sorted = sortedCopy(values);
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : f32(f32(sorted[mid - 1] + sorted[mid]) / 2);
}

/** Median of the first `count` entries of a scratch array, sorting it in place (no allocation). */
export function medianInPlaceF32(scratch: Float64Array, count: number): number {
  const view = scratch.subarray(0, count);
  view.sort();
  const mid = count >> 1;
  return count % 2 ? view[mid] : f32(f32(view[mid - 1] + view[mid]) / 2);
}

/** np.percentile(values, q) with numpy's default linear method. `float32` interpolates the way
 * numpy does for a float32 array (in float32, with its two-sided lerp). */
export function percentile(values: ArrayLike<number>, q: number, float32 = false): number {
  const sorted = sortedCopy(values);
  const n = sorted.length;
  if (n === 0) return NaN;
  const quantile = q / 100;
  // numpy's _compute_virtual_index for the linear method (alpha = beta = 1)
  const virtual = n * quantile + (1 + quantile * (1 - 1 - 1)) - 1;
  let previous = Math.floor(virtual);
  let next = previous + 1;
  if (previous < 0) previous = 0;
  if (previous > n - 1) previous = n - 1;
  if (next > n - 1) next = n - 1;
  if (next < 0) next = 0;
  const gamma = virtual - Math.floor(virtual);
  const a = sorted[previous];
  const b = sorted[next];
  if (float32) {
    const diff = f32(b - a);
    return gamma >= 0.5 ? f32(b - f32(diff * (1 - gamma))) : f32(a + f32(diff * gamma));
  }
  const diff = b - a;
  return gamma >= 0.5 ? b - diff * (1 - gamma) : a + diff * gamma;
}

/** np.mean in float64. */
export function mean(values: ArrayLike<number>): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index];
  return total / values.length;
}

/** Population standard deviation (np.std). */
export function std(values: ArrayLike<number>): number {
  const centre = mean(values);
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    const offset = values[index] - centre;
    total += offset * offset;
  }
  return Math.sqrt(total / values.length);
}

/** np.diff. */
export function diff(values: ArrayLike<number>): Float64Array {
  const out = new Float64Array(Math.max(0, values.length - 1));
  for (let index = 1; index < values.length; index += 1) out[index - 1] = values[index] - values[index - 1];
  return out;
}

/** np.linspace(start, stop, count) exactly as numpy builds it (step times index plus start, the
 * last value set to `stop`). */
export function linspace(start: number, stop: number, count: number): Float64Array {
  const out = new Float64Array(count);
  const div = count - 1;
  const step = (stop - start) / div;
  for (let index = 0; index < count; index += 1) out[index] = index * step + start;
  if (count > 1) out[count - 1] = stop;
  return out;
}

/** Least-squares polynomial of `degree` through (x, y), highest power first (np.polyfit).
 * Solved by normal equations on centred x, which agrees with numpy's SVD to about 1e-13 for the
 * small degrees and well-spread points the analysis fits. */
export function polyfit(x: ArrayLike<number>, y: ArrayLike<number>, degree: number): number[] {
  const n = x.length;
  const centre = mean(x);
  const size = degree + 1;
  const matrix: number[][] = Array.from({ length: size }, () => new Array(size + 1).fill(0));
  for (let index = 0; index < n; index += 1) {
    const u = x[index] - centre;
    const powers = [1];
    for (let p = 1; p <= 2 * degree; p += 1) powers.push(powers[p - 1] * u);
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) matrix[row][column] += powers[row + column];
      matrix[row][size] += powers[row] * y[index];
    }
  }
  // Gaussian elimination with partial pivoting
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    for (let row = column + 1; row < size; row += 1) {
      const factor = matrix[row][column] / matrix[column][column];
      for (let k = column; k <= size; k += 1) matrix[row][k] -= factor * matrix[column][k];
    }
  }
  const centred = new Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let total = matrix[row][size];
    for (let k = row + 1; k < size; k += 1) total -= matrix[row][k] * centred[k];
    centred[row] = total / matrix[row][row];
  }
  // expand p(x - centre) into powers of x, highest first
  const ascending = new Array(size).fill(0);
  for (let power = 0; power < size; power += 1) {
    let binomial = 1;
    for (let k = 0; k <= power; k += 1) {
      ascending[k] += centred[power] * binomial * (-centre) ** (power - k);
      binomial = (binomial * (power - k)) / (k + 1);
    }
  }
  return ascending.reverse();
}

/** Evaluate a highest-power-first polynomial (np.polyval). */
export function polyval(coefficients: number[], x: number): number {
  let total = 0;
  for (const coefficient of coefficients) total = total * x + coefficient;
  return total;
}

/** scipy.ndimage.median_filter(values, size, mode="nearest") for odd `size`. */
export function medianFilterNearest(values: ArrayLike<number>, size: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  const half = size >> 1;
  const window = new Float64Array(size);
  for (let index = 0; index < n; index += 1) {
    for (let k = -half; k <= half; k += 1) {
      const at = Math.min(n - 1, Math.max(0, index + k));
      window[k + half] = values[at];
    }
    window.sort();
    out[index] = size % 2 ? window[half] : (window[half - 1] + window[half]) / 2;
  }
  return out;
}

/** scipy.signal.savgol_filter(values, window, order) with its default mode "interp": the
 * least-squares polynomial of each centred window evaluated at its centre, and at the edges the
 * polynomial of the first and last window evaluated across their outer halves. */
export function savgolInterp(values: ArrayLike<number>, window: number, order: number): Float64Array {
  const n = values.length;
  if (window > n) throw new Error('savgol: the window is longer than the values.');
  const out = new Float64Array(n);
  const half = window >> 1;
  const positions = new Float64Array(window);
  for (let k = 0; k < window; k += 1) positions[k] = k;
  // interior: fit each window once
  const centreWeights = savgolCentreWeights(window, order);
  for (let index = half; index < n - half; index += 1) {
    let total = 0;
    for (let k = 0; k < window; k += 1) total += centreWeights[k] * values[index - half + k];
    out[index] = total;
  }
  const first = polyfit(positions, Array.from({ length: window }, (_, k) => values[k]), order);
  for (let index = 0; index < half; index += 1) out[index] = polyval(first, index);
  const last = polyfit(positions, Array.from({ length: window }, (_, k) => values[n - window + k]), order);
  for (let index = n - half; index < n; index += 1) out[index] = polyval(last, index - (n - window));
  return out;
}

/** The weights that give a window's least-squares polynomial at its centre (savgol_coeffs). */
function savgolCentreWeights(window: number, order: number): Float64Array {
  const weights = new Float64Array(window);
  const half = window >> 1;
  const positions = Array.from({ length: window }, (_, k) => k - half);
  for (let k = 0; k < window; k += 1) {
    const unit = new Array(window).fill(0);
    unit[k] = 1;
    weights[k] = polyval(polyfit(positions, unit, order), 0);
  }
  return weights;
}

/** np.searchsorted(sorted, value) on the left. */
export function searchSorted(sorted: ArrayLike<number>, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** np.unique for integers: sorted, without repeats. */
export function uniqueInts(values: ArrayLike<number>): number[] {
  return [...new Set(Array.from(values))].sort((a, b) => a - b);
}
