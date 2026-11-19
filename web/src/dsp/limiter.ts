/** Lookahead brick-wall limiter (ADR-0459 Tier 1, BF-0459-02).
 *
 * A port of the Python reference `src/selecta/render/dsp.py::limit`: anything already under the
 * ceiling comes back sample-identical; anything over is pulled down by a gain curve built from
 * the per-sample true-peak envelope, held with a centred sliding-minimum window and smoothed
 * with a moving average of the same size. The centred window is what makes it a lookahead
 * design: half the window reacts before the peak arrives. Because the final gain is
 * `min(smoothed, needed)` and the sidechain peak is never below the sample's own magnitude,
 * the output can never exceed the ceiling.
 *
 * Usable two ways:
 *  - pure offline processing via `process` over Float32Array channels;
 *  - `limiterCoefficients` exports the derived numbers for an AudioWorklet to apply the same
 *    design in real time (the worklet file itself belongs to the ADR-0457 engine layer).
 */

import { truePeakEnvelope } from './loudness';

export const LIMITER_IMPLEMENTATION = 'lookahead-brickwall-truepeak-minhold-v1';

export interface LimiterOptions {
  /** Output ceiling in dBTP. Default -1.1, matching the Python reference. */
  ceilingDb?: number;
  /** Lookahead in ms; the gain window reaches this far ahead of a peak. Default releaseMs / 2. */
  lookaheadMs?: number;
  /** Release in ms; the gain window trails this far behind a peak. Default 80. */
  releaseMs?: number;
  /** Required: the sample rate the channels were decoded at. */
  sampleRate: number;
}

export interface LimiterCoefficients {
  implementation: string;
  ceilingLinear: number;
  /** Odd length of the centred min/average window, in samples. */
  windowSamples: number;
  /** Samples of lookahead the centred window provides: (windowSamples - 1) / 2. */
  lookaheadSamples: number;
}

/** The numbers a worklet needs to run the same design in real time. */
export function limiterCoefficients(options: LimiterOptions): LimiterCoefficients {
  const releaseMs = options.releaseMs ?? 80;
  const lookaheadMs = options.lookaheadMs ?? releaseMs / 2;
  const ceilingDb = options.ceilingDb ?? -1.1;
  const spanMs = Math.max(releaseMs, 2 * lookaheadMs);
  let windowSamples = Math.max(3, Math.round((spanMs / 1000) * options.sampleRate));
  windowSamples |= 1;
  return {
    implementation: LIMITER_IMPLEMENTATION,
    ceilingLinear: 10 ** (ceilingDb / 20),
    windowSamples,
    lookaheadSamples: (windowSamples - 1) / 2,
  };
}

/** Centred sliding minimum with nearest-edge padding, O(n) via a monotonic deque. */
function slidingMinimum(values: Float32Array, window: number): Float32Array {
  const half = (window - 1) / 2;
  const length = values.length;
  const output = new Float32Array(length);
  const indexAt = (index: number) => (index < 0 ? 0 : index >= length ? length - 1 : index);
  const deque = new Int32Array(length + 2 * half);
  let head = 0;
  let tail = 0;
  for (let position = -half; position < length + half; position += 1) {
    const value = values[indexAt(position)];
    while (tail > head && values[indexAt(deque[tail - 1])] >= value) {
      tail -= 1;
    }
    deque[tail] = position;
    tail += 1;
    while (deque[head] < position - window + 1) {
      head += 1;
    }
    const centre = position - half;
    if (centre >= 0 && centre < length) {
      output[centre] = values[indexAt(deque[head])];
    }
  }
  return output;
}

/** Centred moving average with nearest-edge padding, O(n) via a running sum. */
function movingAverage(values: Float32Array, window: number): Float32Array {
  const half = (window - 1) / 2;
  const length = values.length;
  const output = new Float32Array(length);
  const indexAt = (index: number) => (index < 0 ? 0 : index >= length ? length - 1 : index);
  let sum = 0;
  for (let offset = -half; offset <= half; offset += 1) {
    sum += values[indexAt(offset)];
  }
  output[0] = sum / window;
  for (let centre = 1; centre < length; centre += 1) {
    sum += values[indexAt(centre + half)] - values[indexAt(centre - half - 1)];
    output[centre] = sum / window;
  }
  return output;
}

/** Offline limiting. Returns new channel arrays; input under the ceiling is returned as an
 * identical copy, so seams with unprocessed audio stay invisible. */
export function process(channels: Float32Array[], options: LimiterOptions): Float32Array[] {
  const { ceilingLinear, windowSamples } = limiterCoefficients(options);
  const length = channels.length > 0 ? channels[0].length : 0;
  if (length === 0) {
    return channels.map((channel) => channel.slice());
  }
  // Sidechain: the loudest true-peak estimate across channels, never below the sample itself.
  const peak = new Float32Array(length);
  for (const channel of channels) {
    const envelope = truePeakEnvelope(channel);
    for (let index = 0; index < length; index += 1) {
      if (envelope[index] > peak[index]) {
        peak[index] = envelope[index];
      }
    }
  }
  const needed = new Float32Array(length);
  let anyOver = false;
  for (let index = 0; index < length; index += 1) {
    const gain = ceilingLinear / Math.max(peak[index], 1e-9);
    needed[index] = gain < 1 ? gain : 1;
    if (gain < 1) {
      anyOver = true;
    }
  }
  if (!anyOver) {
    return channels.map((channel) => channel.slice());
  }
  const held = slidingMinimum(needed, windowSamples);
  const smooth = movingAverage(held, windowSamples);
  const gainCurve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    gainCurve[index] = Math.min(smooth[index], needed[index]);
  }
  return channels.map((channel) => {
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      output[index] = channel[index] * gainCurve[index];
    }
    return output;
  });
}
