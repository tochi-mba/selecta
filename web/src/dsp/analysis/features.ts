/** Bar-level features: an exact port of `src/selecta/analysis/features.py::extract`.
 *
 * One STFT (2048-sample centred Hann frames every 512 samples at 22,050 Hz) feeds everything:
 * a 64-band mel spectrogram in dB and its 20 MFCCs, chroma, the frame level in dB, the share of
 * power below 200 Hz, spectral flux and the spectral centroid. Each is averaged per bar between
 * the bar times, and four of them make the bar energy. The sections come from the bar features
 * (`sections.ts`).
 *
 * Python keeps the STFT in memory; here it is streamed twice instead (chroma needs the tuning,
 * which needs every frame first), so a long song never holds its whole spectrogram. Work: two
 * 2048-point real FFTs per 512 samples, a sparse mel pass and a 12 by 1025 chroma projection.
 */

import { chromaFilterbank, chromaFrame, PeakCollector } from './chroma';
import { PowerFrames, stftFrameCount } from './fftPlan';
import { applyFilterbank, dctOrtho, dctTable, melFilterbank, powerToDbInPlace, type SparseFilterbank } from './mel';
import { mean, percentile } from './numeric';
import { findSections, type Section } from './sections';

export const N_FFT = 2048;
export const HOP = 512;
export const FEATURE_SR = 22050;
export const N_MELS = 64;
export const N_MFCC = 20;

const f32 = Math.fround;

export interface SongFeatures {
  /** bars x 12, row-major. */
  chromaBars: Float64Array;
  /** bars x 20, row-major. */
  mfccBars: Float64Array;
  energyBars: Float64Array;
  rmsDbBars: Float64Array;
  lowShareBars: Float64Array;
  onsetDensityBars: Float64Array;
  timbre: Float64Array;
  chromaProfile: Float32Array;
  energy: number;
  sections: Section[];
  bars: number;
}

/** The frame-level values `extract` averages per bar, kept for the stage fixtures. */
export interface FrameFeatures {
  frames: number;
  tuning: number;
  /** frames x 12 and frames x 20, row-major, float32 as librosa gives them. */
  chroma: Float32Array;
  mfcc: Float32Array;
  logMel: Float32Array;
  powerSum: Float32Array;
  rmsDb: Float32Array;
  lowShare: Float32Array;
  flux: Float32Array;
  centroid: Float64Array;
}

let melBank: SparseFilterbank | null = null;

/** Everything `extract` computes per frame. */
export function frameFeatures(mono22k: Float32Array): FrameFeatures {
  melBank ??= melFilterbank(FEATURE_SR, N_FFT, N_MELS);
  const frames = stftFrameCount(mono22k.length, HOP);
  const stft = new PowerFrames(N_FFT, HOP);
  const bins = stft.fft.bins;
  const power = new Float32Array(bins);
  const peaks = new PeakCollector(FEATURE_SR, bins);
  const logMel = new Float32Array(frames * N_MELS);
  const powerSum = new Float32Array(frames);
  const rmsDb = new Float32Array(frames);
  const lowShare = new Float32Array(frames);
  const centroid = new Float64Array(frames);
  const lowBins = Math.ceil((200 * N_FFT) / FEATURE_SR); // bins below 200 Hz
  for (let frame = 0; frame < frames; frame += 1) {
    stft.power(mono22k, frame, power);
    applyFilterbank(melBank, power, logMel, frame * N_MELS);
    let total = 0;
    let low = 0;
    let weighted = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      total += power[bin];
      if (bin < lowBins) low += power[bin];
      weighted += ((bin * FEATURE_SR) / N_FFT) * power[bin];
    }
    const sum = f32(total);
    powerSum[frame] = sum;
    rmsDb[frame] = f32(10 * f32(Math.log10(f32(Math.max(f32(sum / N_FFT), 1e-10)))));
    lowShare[frame] = f32(f32(low) / f32(Math.max(sum, 1e-10)));
    centroid[frame] = weighted / Math.max(sum, 1e-10);
    peaks.add(power);
  }
  powerToDbInPlace(logMel, 80);

  const table = dctTable(N_MELS, N_MFCC);
  const mfcc = new Float32Array(frames * N_MFCC);
  const flux = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    dctOrtho(logMel, frame * N_MELS, N_MELS, N_MFCC, table, mfcc, frame * N_MFCC);
    // the rise from the previous frame (the first frame is compared with itself)
    const previous = (frame === 0 ? 0 : frame - 1) * N_MELS;
    let rises = 0;
    for (let band = 0; band < N_MELS; band += 1) {
      const rise = f32(logMel[frame * N_MELS + band] - logMel[previous + band]);
      rises += rise > 0 ? rise : 0;
    }
    flux[frame] = f32(rises / N_MELS);
  }

  const tuning = peaks.tuning();
  const bank = chromaFilterbank(FEATURE_SR, N_FFT, tuning);
  const chroma = new Float32Array(frames * 12);
  for (let frame = 0; frame < frames; frame += 1) {
    stft.power(mono22k, frame, power);
    chromaFrame(bank, power, chroma, frame * 12);
  }
  return { frames, tuning, chroma, mfcc, logMel, powerSum, rmsDb, lowShare, flux, centroid };
}

/** librosa.time_to_frames of the bar times and the song's end. */
export function barFrames(barTimes: Float64Array, duration: number): Int32Array {
  const edges = new Int32Array(barTimes.length + 1);
  for (let k = 0; k <= barTimes.length; k += 1) {
    const time = k < barTimes.length ? barTimes[k] : duration;
    edges[k] = Math.floor(Math.trunc(time * FEATURE_SR) / HOP);
  }
  return edges;
}

/** `_aggregate`: each row's mean between successive frame edges, through a running sum taken in
 * the values' own precision (float32 for librosa's arrays, as numpy's cumsum takes it). */
export function aggregate(values: ArrayLike<number>, rows: number, frames: number, edges: Int32Array, float32: boolean): Float64Array {
  const bars = edges.length - 1;
  const out = new Float64Array(rows * bars);
  const running = new Float64Array(frames + 1);
  for (let row = 0; row < rows; row += 1) {
    let sum = 0;
    running[0] = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      sum = float32 ? f32(sum + values[frame * rows + row]) : sum + values[frame * rows + row];
      running[frame + 1] = sum;
    }
    for (let bar = 0; bar < bars; bar += 1) {
      const loClipped = Math.min(Math.max(edges[bar], 0), frames);
      const hiClipped = Math.min(Math.max(edges[bar + 1], 0), frames);
      const hi = Math.min(Math.max(hiClipped, loClipped + 1), frames);
      const lo = Math.min(loClipped, hi - 1);
      out[bar * rows + row] = (running[hi] - running[lo]) / (hi - lo);
    }
  }
  return out;
}

/** `_scale`; `span` is high minus low in the precision Python takes it (float32 for the level). */
function scale(value: number, low: number, span: number): number {
  return Math.min(Math.max((value - low) / span, 0), 1);
}

/** `extract(mono_22k, bar_times, duration)`. */
export function extractFeatures(mono22k: Float32Array, barTimes: Float64Array, duration: number, frames = frameFeatures(mono22k)): SongFeatures {
  const count = frames.frames;
  const edges = barFrames(barTimes, duration);
  const bars = edges.length - 1;
  const chromaRaw = aggregate(frames.chroma, 12, count, edges, true);
  const chromaBars = new Float64Array(bars * 12);
  for (let bar = 0; bar < bars; bar += 1) {
    let top = 0;
    for (let c = 0; c < 12; c += 1) top = Math.max(top, chromaRaw[bar * 12 + c]);
    const divisor = Math.max(top, 1e-6);
    for (let c = 0; c < 12; c += 1) chromaBars[bar * 12 + c] = chromaRaw[bar * 12 + c] / divisor;
  }
  const mfccBars = aggregate(frames.mfcc, N_MFCC, count, edges, true);
  const rmsDbBars = aggregate(frames.rmsDb, 1, count, edges, true);
  const lowShareBars = aggregate(frames.lowShare, 1, count, edges, true);
  const fluxBars = aggregate(frames.flux, 1, count, edges, true);
  const brightBars = aggregate(frames.centroid, 1, count, edges, false);

  const low = f32(percentile(frames.rmsDb, 5, true) - 3);
  const high = f32(percentile(frames.rmsDb, 99, true) + 1);
  const energyBars = new Float64Array(bars);
  for (let bar = 0; bar < bars; bar += 1) {
    energyBars[bar] =
      0.45 * scale(rmsDbBars[bar], low, f32(high - low)) +
      0.3 * scale(fluxBars[bar], 0.5, 6.0 - 0.5) +
      0.15 * scale(brightBars[bar], 800.0, 4000.0 - 800.0) +
      0.1 * scale(lowShareBars[bar], 0.05, 0.5 - 0.05);
  }
  const sorted = Float64Array.from(energyBars).sort();
  const top = sorted.subarray(sorted.length - Math.max(1, Math.floor(sorted.length / 2)));
  const energy = mean(top);

  // timbre: MFCC 1..13 means and spreads, then mean centroid, low share and flux
  const timbre = new Float64Array(29);
  for (let coefficient = 1; coefficient < 14; coefficient += 1) {
    let total = 0;
    for (let frame = 0; frame < count; frame += 1) total += frames.mfcc[frame * N_MFCC + coefficient];
    const centre = f32(total / count);
    let squares = 0;
    for (let frame = 0; frame < count; frame += 1) {
      const offset = f32(frames.mfcc[frame * N_MFCC + coefficient] - centre);
      squares += offset * offset;
    }
    timbre[coefficient - 1] = centre;
    timbre[coefficient + 12] = f32(Math.sqrt(f32(squares / count)));
  }
  timbre[26] = mean(frames.centroid);
  timbre[27] = f32(mean(frames.lowShare));
  timbre[28] = f32(mean(frames.flux));

  const chromaProfile = new Float32Array(12);
  for (let c = 0; c < 12; c += 1) {
    let total = 0;
    for (let frame = 0; frame < count; frame += 1) total += frames.chroma[frame * 12 + c];
    chromaProfile[c] = total / count;
  }

  const features: SongFeatures = {
    chromaBars, mfccBars, energyBars, rmsDbBars, lowShareBars, onsetDensityBars: fluxBars,
    timbre, chromaProfile, energy, sections: [], bars,
  };
  features.sections = findSections(features);
  return features;
}
