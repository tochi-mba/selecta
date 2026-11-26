/** The log-mel spectrogram Beat This hears, as `beat_this.preprocessing.LogMelSpect` makes it.
 *
 * torchaudio's MelSpectrogram at 22,050 Hz: a 1024-point STFT every 441 samples (50 frames a
 * second), centred with reflect padding, a periodic Hann window, scaled by 1/sqrt(1024)
 * (`normalized="frame_length"`), magnitude (power 1), then 128 triangular mel filters on the
 * Slaney mel scale from 30 Hz to 11 kHz with no area normalisation (torchaudio's `norm=None`),
 * and finally log1p(1000 * mel). docs/engineering/device-beats.md is the contract.
 *
 * torch computes in float32; the filter bank is built here with the same float32 steps, the FFT
 * runs in float64 (fftPlan.ts) and is rounded where torch rounds, so a frame matches within
 * 1e-4 in log-mel units. Frames are made for any range, so a song is never held whole.
 */

import { RealFft } from '../fftPlan';
import { applyFilterbank, type SparseFilterbank } from '../mel';

const f32 = Math.fround;

export const BEAT_SR = 22050;
export const BEAT_FFT = 1024;
export const BEAT_HOP = 441;
export const BEAT_MELS = 128;
export const BEAT_FMIN = 30;
export const BEAT_FMAX = 11000;
export const BEAT_LOG_MULTIPLIER = 1000;
/** Frames per second of the spectrogram and of the model's output. */
export const BEAT_FPS = BEAT_SR / BEAT_HOP;

/** Frames torch.stft gives with `center=True`: 1 + floor(length / hop). */
export function beatFrameCount(length: number): number {
  return 1 + Math.floor(length / BEAT_HOP);
}

/** torch.hann_window(n) (periodic), in float32. */
export function torchHann(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) window[index] = f32(0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size));
  return window;
}

/** torchaudio `_hz_to_mel(freq, "slaney")`, in float64 as Python computes it. */
export function slaneyHzToMel(hz: number): number {
  const fSp = 200 / 3;
  const minLogMel = 1000 / fSp;
  const logStep = Math.log(6.4) / 27;
  return hz >= 1000 ? minLogMel + Math.log(hz / 1000) / logStep : hz / fSp;
}

/** torch.linspace in float32: the first half counted up from the start, the rest down from
 * the end, every step rounded to float32. */
export function torchLinspaceF32(start: number, end: number, steps: number): Float64Array {
  const out = new Float64Array(steps);
  const s = f32(start);
  const e = f32(end);
  const step = f32(f32(e - s) / (steps - 1));
  const half = Math.floor(steps / 2);
  for (let index = 0; index < steps; index += 1) {
    out[index] = index < half ? f32(s + f32(step * index)) : f32(e - f32(step * (steps - index - 1)));
  }
  return out;
}

/** torchaudio `melscale_fbanks(513, 30, 11000, 128, 22050, norm=None, mel_scale="slaney")`, kept
 * sparse in mel.ts's form so mel.ts's `applyFilterbank` applies it. */
export function beatThisFilterbank(): SparseFilterbank {
  const bins = BEAT_FFT / 2 + 1;
  const allFreqs = torchLinspaceF32(0, Math.floor(BEAT_SR / 2), bins);
  const mels = torchLinspaceF32(slaneyHzToMel(BEAT_FMIN), slaneyHzToMel(BEAT_FMAX), BEAT_MELS + 2);
  const fSp = f32(200 / 3);
  const minLogMel = f32(1000 / (200 / 3));
  const logStep = f32(Math.log(6.4) / 27);
  const fPts = Float64Array.from(mels, (mel) => (mel >= minLogMel
    ? f32(1000 * f32(Math.exp(f32(logStep * f32(mel - minLogMel)))))
    : f32(fSp * mel)));
  const fDiff = new Float64Array(fPts.length - 1);
  for (let index = 0; index < fDiff.length; index += 1) fDiff[index] = f32(fPts[index + 1] - fPts[index]);
  const starts = new Int32Array(BEAT_MELS);
  const weights: Float32Array[] = [];
  for (let filter = 0; filter < BEAT_MELS; filter += 1) {
    const row = new Float32Array(bins);
    let first = -1;
    let last = -1;
    for (let bin = 0; bin < bins; bin += 1) {
      const down = f32(f32(-f32(fPts[filter] - allFreqs[bin])) / fDiff[filter]);
      const up = f32(f32(fPts[filter + 2] - allFreqs[bin]) / fDiff[filter + 1]);
      const weight = Math.max(0, Math.min(down, up));
      row[bin] = weight;
      if (weight !== 0) {
        if (first < 0) first = bin;
        last = bin;
      }
    }
    starts[filter] = Math.max(first, 0);
    weights.push(first < 0 ? new Float32Array(0) : row.slice(first, last + 1));
  }
  return { filters: BEAT_MELS, bins, starts, weights };
}

/** Makes log-mel frames of one 22,050 Hz signal on demand. */
export class BeatSpectrogram {
  readonly frames: number;
  private readonly signal: Float32Array;
  private readonly fft = new RealFft(BEAT_FFT);
  private readonly window = torchHann(BEAT_FFT);
  private readonly bank = beatThisFilterbank();
  private readonly frame = new Float64Array(BEAT_FFT);
  private readonly re = new Float64Array(BEAT_FFT / 2 + 1);
  private readonly im = new Float64Array(BEAT_FFT / 2 + 1);
  private readonly magnitude = new Float32Array(BEAT_FFT / 2 + 1);
  private readonly scale = 1 / Math.sqrt(BEAT_FFT);

  constructor(signal: Float32Array) {
    // reflect padding needs more samples than half a frame, as torch.stft does
    if (signal.length <= BEAT_FFT / 2) throw new Error('The song is too short to track its beats.');
    this.signal = signal;
    this.frames = beatFrameCount(signal.length);
  }

  /** Frames [start, start + count) into `out` (count x 128, row-major). */
  fill(start: number, count: number, out: Float32Array, offset = 0): void {
    const { signal, frame, window, re, im, magnitude, scale } = this;
    const last = signal.length - 1;
    for (let t = 0; t < count; t += 1) {
      const begin = (start + t) * BEAT_HOP - BEAT_FFT / 2;
      for (let k = 0; k < BEAT_FFT; k += 1) {
        let at = begin + k;
        if (at < 0) at = -at;
        else if (at > last) at = 2 * last - at;
        frame[k] = window[k] * signal[at];
      }
      this.fft.forward(frame, re, im);
      for (let bin = 0; bin < magnitude.length; bin += 1) {
        magnitude[bin] = f32(Math.hypot(f32(re[bin] * scale), f32(im[bin] * scale)));
      }
      const row = offset + t * BEAT_MELS;
      applyFilterbank(this.bank, magnitude, out, row);
      for (let mel = 0; mel < BEAT_MELS; mel += 1) out[row + mel] = f32(Math.log1p(f32(BEAT_LOG_MULTIPLIER * out[row + mel])));
    }
  }
}
