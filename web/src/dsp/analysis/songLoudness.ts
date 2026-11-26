/** Integrated loudness and sample peak exactly as the Desktop measures them
 * (`features.py::loudness`: pyloudnorm 0.2's Meter at the song's rate, and the largest sample).
 *
 * ../loudness.ts is the browser's BS.1770 meter for playback, and it is close to this but not
 * the same: it designs the K-weighting from the libebur128 constants (a 1681.97 Hz shelf of
 * 3.9998 dB, a 38.135 Hz high-pass) where pyloudnorm uses the RBJ cookbook at 1500 Hz, +4 dB,
 * Q 1/sqrt(2) and 38 Hz, Q 0.5; it counts only whole 400 ms blocks where pyloudnorm rounds the
 * block count (the last block may run past the end and is still divided by a full block); and it
 * gates at strictly above -70 LUFS where pyloudnorm keeps -70 itself in the first pass. The
 * planner's level gates were calibrated on pyloudnorm, so this file follows pyloudnorm and reuses
 * only the biquad form. docs/engineering/device-analysis.md has the measured difference.
 */

import type { BiquadCoefficients } from '../loudness';
import { roundHalfEven } from './numeric';

/** pyloudnorm's IIRfilter, RBJ cookbook, normalised by a0 as scipy.signal.lfilter does. */
function rbj(gainDb: number, q: number, centreHz: number, rate: number, kind: 'high_shelf' | 'high_pass'): BiquadCoefficients {
  const A = 10 ** (gainDb / 40.0);
  const w0 = 2.0 * Math.PI * (centreHz / rate);
  const alpha = Math.sin(w0) / (2.0 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (kind === 'high_shelf') {
    b0 = A * ((A + 1) + (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha);
    b1 = -2 * A * ((A - 1) + (A + 1) * Math.cos(w0));
    b2 = A * ((A + 1) + (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha);
    a0 = (A + 1) - (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha;
    a1 = 2 * ((A - 1) - (A + 1) * Math.cos(w0));
    a2 = (A + 1) - (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha;
  } else {
    b0 = (1 + Math.cos(w0)) / 2;
    b1 = -(1 + Math.cos(w0));
    b2 = (1 + Math.cos(w0)) / 2;
    a0 = 1 + alpha;
    a1 = -2 * Math.cos(w0);
    a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** One biquad in transposed direct form II (scipy.signal.lfilter), in place. */
function filterInPlace(values: Float64Array, c: BiquadCoefficients): void {
  let z1 = 0;
  let z2 = 0;
  for (let index = 0; index < values.length; index += 1) {
    const x = values[index];
    const y = c.b0 * x + z1;
    z1 = c.b1 * x - c.a1 * y + z2;
    z2 = c.b2 * x - c.a2 * y;
    values[index] = y;
  }
}

const GAINS = [1.0, 1.0, 1.0, 1.41, 1.41];

/** pyloudnorm `Meter(rate).integrated_loudness(data)` for up to five channels; -Infinity when no
 * block passes the gates. Memory: one float64 copy of one channel at a time. */
export function pyloudnormIntegrated(channels: Float32Array[], rate: number): number {
  const blockSeconds = 0.4;
  const step = 1.0 - 0.75;
  const samples = channels[0]?.length ?? 0;
  if (!channels.length || samples < blockSeconds * rate) throw new Error('Audio must be longer than one 400 ms block.');
  const total = samples / rate;
  // int(np.round(...)) + 1: numpy rounds half to even
  const blocks = roundHalfEven((total - blockSeconds) / (blockSeconds * step)) + 1;
  const z = channels.map(() => new Float64Array(blocks));
  const shelf = rbj(4.0, 1 / Math.sqrt(2), 1500.0, rate, 'high_shelf');
  const highPass = rbj(0.0, 0.5, 38.0, rate, 'high_pass');
  channels.forEach((channel, i) => {
    const weighted = Float64Array.from(channel);
    filterInPlace(weighted, shelf);
    filterInPlace(weighted, highPass);
    for (let j = 0; j < blocks; j += 1) {
      const lower = Math.trunc(blockSeconds * (j * step) * rate);
      const upper = Math.min(Math.trunc(blockSeconds * (j * step + 1) * rate), samples);
      let sum = 0;
      for (let k = lower; k < upper; k += 1) sum += weighted[k] * weighted[k];
      z[i][j] = (1.0 / (blockSeconds * rate)) * sum;
    }
  });
  const loudness = (j: number) => {
    let sum = 0;
    for (let i = 0; i < channels.length; i += 1) sum += GAINS[i] * z[i][j];
    return -0.691 + 10.0 * Math.log10(sum);
  };
  const blockLoudness = Array.from({ length: blocks }, (_, j) => loudness(j));
  // each channel's mean block energy over the kept blocks, weighted and summed; an empty set
  // averages to NaN in the first pass (no relative gate) and to zero in the last (nan_to_num)
  const gatedSum = (kept: number[], empty: number) => {
    let sum = 0;
    for (let i = 0; i < channels.length; i += 1) {
      let channelSum = 0;
      for (const j of kept) channelSum += z[i][j];
      sum += GAINS[i] * (kept.length ? channelSum / kept.length : empty);
    }
    return sum;
  };
  const absolute = blockLoudness.flatMap((value, j) => (value >= -70.0 ? [j] : []));
  const relativeGate = -0.691 + 10.0 * Math.log10(gatedSum(absolute, NaN)) - 10.0;
  const kept = blockLoudness.flatMap((value, j) => (value > relativeGate && value > -70.0 ? [j] : []));
  return -0.691 + 10.0 * Math.log10(gatedSum(kept, 0));
}

/** `20 * log10(max |sample|)` over every channel, with silence read as 1e-6. */
export function samplePeakDecibels(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const magnitude = Math.abs(channel[index]);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return 20.0 * Math.log10(peak || 1e-6);
}
