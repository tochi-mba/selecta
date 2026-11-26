/** The resampler that brings a decoded song to the analysis rate (22,050 Hz).
 *
 * The Desktop resamples with soxr at quality "HQ" (analysis/pipeline.py), which has no browser
 * port, and a browser's own resampler differs by browser. So the port uses this one everywhere,
 * and the golden fixtures use the same one written in numpy (tools/device_analysis_golden.py):
 * every later stage is then compared on the same signal, and the fixtures measure separately
 * what this choice costs against soxr (docs/engineering/device-analysis.md).
 *
 * A Kaiser-windowed sinc, polyphase: output n sits at input position n * from / to, and each of
 * the `to / gcd` phases has its own taps, normalised to unit sum so a constant stays constant.
 * Samples outside the signal count as zero. Summed in float64 from the most negative tap to the
 * most positive, as the numpy reference sums, and rounded to float32 once.
 */

export const RESAMPLE_ZEROS = 28;
export const RESAMPLE_ROLLOFF = 0.97;
export const RESAMPLE_BETA = 9.0;

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Modified Bessel function of the first kind, order 0, by its power series. */
export function besselI0(x: number): number {
  let total = 1;
  let term = 1;
  const half = x / 2;
  for (let k = 1; ; k += 1) {
    term *= (half / k) * (half / k);
    total += term;
    if (term < 1e-21 * total) return total;
  }
}

export interface ResamplePlan {
  up: number;
  down: number;
  reach: number;
  /** `up` rows of `2 * reach + 1` taps, for input offsets -reach..reach. */
  taps: Float64Array;
}

const plans = new Map<string, ResamplePlan>();

export function resamplePlan(from: number, to: number): ResamplePlan {
  const name = `${from}>${to}`;
  const cached = plans.get(name);
  if (cached) return cached;
  const common = gcd(from, to);
  const up = to / common;
  const down = from / common;
  const cutoff = RESAMPLE_ROLLOFF * Math.min(1, up / down);
  const half = RESAMPLE_ZEROS / cutoff;
  const reach = Math.ceil(half);
  const width = 2 * reach + 1;
  const norm = besselI0(RESAMPLE_BETA);
  const taps = new Float64Array(up * width);
  for (let phase = 0; phase < up; phase += 1) {
    const frac = phase / up;
    for (let column = 0; column < width; column += 1) {
      const distance = frac - (column - reach);
      if (Math.abs(distance) >= half) continue;
      const u = distance / half;
      const window = besselI0(RESAMPLE_BETA * Math.sqrt(1 - u * u)) / norm;
      const x = cutoff * distance;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      taps[phase * width + column] = cutoff * sinc * window;
    }
    let sum = 0;
    for (let column = 0; column < width; column += 1) sum += taps[phase * width + column];
    for (let column = 0; column < width; column += 1) taps[phase * width + column] /= sum;
  }
  const plan = { up, down, reach, taps };
  plans.set(name, plan);
  return plan;
}

/** Output length: ceil(length * to / from). */
export function resampledLength(length: number, from: number, to: number): number {
  const { up, down } = resamplePlan(from, to);
  return Math.floor((length * up + down - 1) / down);
}

/** Resample a float32 signal. O(output length times taps): 117 taps from 44.1 kHz and 127 from
 * 48 kHz, so a four-minute song is some 620 million multiply-adds. The settings (28 zero
 * crossings, passband to 0.97 of the lower Nyquist, Kaiser beta 9) were chosen as the closest
 * of those tried to soxr HQ on the fixtures' bar features. */
export function resample(signal: Float32Array, from: number, to: number): Float32Array {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to <= 0) {
    throw new Error('resample needs positive whole sample rates.');
  }
  if (from === to) return Float32Array.from(signal);
  const plan = resamplePlan(from, to);
  const { up, down, reach, taps } = plan;
  const width = 2 * reach + 1;
  const length = signal.length;
  const count = resampledLength(length, from, to);
  const out = new Float32Array(count);
  for (let n = 0; n < count; n += 1) {
    const position = n * down;
    const base = Math.floor(position / up);
    const row = (position - base * up) * width;
    let total = 0;
    const first = base - reach;
    if (first >= 0 && base + reach < length) {
      for (let column = 0; column < width; column += 1) total += taps[row + column] * signal[first + column];
    } else {
      for (let column = 0; column < width; column += 1) {
        const at = first + column;
        total += taps[row + column] * (at >= 0 && at < length ? signal[at] : 0);
      }
    }
    out[n] = total;
  }
  return out;
}
