/** The renderer's last stage, `dsp.limit`, and the audit's true peak, in src/selecta/render/dsp.py
 * and src/selecta/audit/checks.py.
 *
 * Both read peaks between samples from a four-times upsample. Python uses soxr at quality "HQ",
 * which has no browser port; this uses the analysis resampler (analysis/resample.ts, the same
 * Kaiser-windowed sinc the device-analysis fixtures use), worked out one input sample at a time
 * so the upsampled signal is never held. The fixtures measure what that choice changes.
 */

import { resamplePlan } from '../analysis/resample';
import type { Channels } from './filters';
import { f32 } from './npy';
import { SAMPLE_RATE } from './script';

const UPSAMPLE = 4;

/** For each input sample, the largest of the four upsampled values in any channel (float32), as
 * `true_peaks` reshapes and takes the maximum. */
export function truePeaks(audio: Channels): Float32Array {
  const plan = resamplePlan(SAMPLE_RATE, SAMPLE_RATE * UPSAMPLE);
  const { reach, taps } = plan;
  const width = 2 * reach + 1;
  const length = audio[0].length;
  const out = new Float32Array(length);
  for (const channel of audio) {
    for (let base = 0; base < length; base += 1) {
      let largest = out[base];
      const first = base - reach;
      for (let phase = 0; phase < UPSAMPLE; phase += 1) {
        const row = phase * width;
        let total = 0;
        if (first >= 0 && base + reach < length) {
          for (let column = 0; column < width; column += 1) total += taps[row + column] * channel[first + column];
        } else {
          for (let column = 0; column < width; column += 1) {
            const at = first + column;
            total += taps[row + column] * (at >= 0 && at < length ? channel[at] : 0);
          }
        }
        const value = Math.abs(f32(total));
        if (value > largest) largest = value;
      }
      out[base] = largest;
    }
  }
  return out;
}

/** The true peak in dBTP (`true_peak_db`). */
export function truePeakDb(audio: Channels): number {
  const peaks = truePeaks(audio);
  let largest = 0;
  for (const value of peaks) if (value > largest) largest = value;
  return 20 * Math.log10(Math.max(largest, 1e-9));
}

/** scipy.ndimage.minimum_filter1d(values, size, mode="nearest") for odd `size`, by a running
 * window of candidates (exact: a minimum has no rounding). */
export function minimumFilter(values: Float32Array, size: number): Float32Array {
  const n = values.length;
  const half = size >> 1;
  const out = new Float32Array(n);
  const queue = new Int32Array(n + size);
  let head = 0;
  let tail = 0;
  // the input extended by its edge values: position k holds values[k - half], clipped
  const at = (k: number): number => values[Math.min(n - 1, Math.max(0, k - half))];
  for (let k = 0; k < n + size - 1; k += 1) {
    const value = at(k);
    while (tail > head && at(queue[tail - 1]) >= value) tail -= 1;
    queue[tail] = k;
    tail += 1;
    const i = k - (size - 1);
    if (i >= 0) {
      while (queue[head] < i) head += 1;
      out[i] = at(queue[head]);
    }
  }
  return out;
}

/** scipy.ndimage.uniform_filter1d(values, size, mode="nearest") on float32: scipy's running
 * double sum (each step adds the difference over the size), stored as float32. */
export function uniformFilter(values: Float32Array, size: number): Float32Array {
  const n = values.length;
  const before = size >> 1;
  const at = (k: number): number => values[Math.min(n - 1, Math.max(0, k - before))];
  const out = new Float32Array(n);
  let total = 0;
  for (let k = 0; k < size; k += 1) total += at(k);
  total /= size;
  out[0] = total;
  for (let index = 1; index < n; index += 1) {
    total += (at(index + size - 1) - at(index - 1)) / size;
    out[index] = total;
  }
  return out;
}

/** `limit`: a look-ahead limiter that leaves anything under the ceiling sample-identical.
 * Returns the input itself when nothing needs to change. */
export function limit(audio: Channels, ceilingDb = -1.1, releaseMs = 80): Channels {
  const ceiling = f32(10 ** (ceilingDb / 20));
  const n = audio[0].length;
  const peak = truePeaks(audio);
  const floor = f32(1e-9);
  const needed = new Float32Array(n);
  let smallest = Infinity;
  for (let index = 0; index < n; index += 1) {
    let value = peak[index];
    for (const channel of audio) value = Math.max(value, Math.abs(channel[index]));
    needed[index] = Math.min(1, f32(ceiling / Math.max(value, floor)));
    if (needed[index] < smallest) smallest = needed[index];
  }
  if (smallest >= 1) return audio;
  const hold = Math.max(3, Math.trunc((releaseMs / 1000) * SAMPLE_RATE)) | 1;
  const smooth = uniformFilter(minimumFilter(needed, hold), hold);
  return audio.map((channel) => {
    const out = new Float32Array(n);
    for (let index = 0; index < n; index += 1) out[index] = f32(channel[index] * Math.min(smooth[index], needed[index]));
    return out;
  });
}
