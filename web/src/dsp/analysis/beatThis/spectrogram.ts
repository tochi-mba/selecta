/** The log-mel spectrogram Beat This hears, as `beat_this.preprocessing.LogMelSpect` makes it.
 *
 * torchaudio's MelSpectrogram at 22,050 Hz: a 1024-point STFT every 441 samples (50 frames a
 * second), centred with reflect padding, a periodic Hann window, scaled by 1/sqrt(1024)
 * (`normalized="frame_length"`), magnitude (power 1), then 128 triangular mel filters on the
 * Slaney mel scale from 30 Hz to 11 kHz with no area normalisation (torchaudio's `norm=None`),
 * and finally log1p(1000 * mel). docs/engineering/device-beats.md is the contract.
 *
 * torch computes in float32. The filter bank here equals torchaudio's exactly; the FFT runs in
 * float64 (fftPlan.ts) and is rounded where torch rounds. On the golden songs a frame matches
 * within 3e-4 in log-mel units, and within 5e-5 wherever the value is above 1: the remaining
 * difference sits in near-silent bins, where torch's own float32 FFT rounding is the size of the
 * signal. Frames are made for any range, so a song is never held whole.
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

/** torchaudio's filter edges in hertz (`_mel_to_hz` of the float32 mel linspace), as torch 2.15
 * computes them. Recomputing them here with Math.exp lands one float32 step off on some
 * edges, which moves weights by 4e-6 and log-mel frames by 3e-4; the table removes that. */
const TORCH_MEL_EDGES_HZ = [
  29.9999981, 55.5439606, 81.0879288, 106.631897, 132.175858, 157.719833, 183.263794, 208.80777,
  234.351715, 259.895691, 285.439636, 310.983612, 336.527557, 362.071533, 387.615509,
  413.159454, 438.70343, 464.247406, 489.791351, 515.335327, 540.879272, 566.423279, 591.967224,
  617.511169, 643.055115, 668.599121, 694.143066, 719.687073, 745.231018, 770.774963,
  796.318909, 821.862915, 847.40686, 872.950867, 898.494812, 924.038818, 949.582703, 975.126648,
  1000.69189, 1027.40332, 1054.82764, 1082.98438, 1111.89233, 1141.57202, 1172.04395, 1203.3291,
  1235.44946, 1268.42725, 1302.28528, 1337.04712, 1372.73694, 1409.37927, 1446.99976,
  1485.62439, 1525.28015, 1565.99438, 1607.79541, 1650.71216, 1694.77429, 1740.01294,
  1786.45886, 1834.14465, 1883.10352, 1933.36902, 1984.97644, 2037.9613, 2092.3606, 2148.21167,
  2205.55371, 2264.42651, 2324.87061, 2386.92822, 2450.64209, 2516.05713, 2583.21802,
  2652.17163, 2722.96606, 2795.6499, 2870.27441, 2946.89038, 3025.55127, 3106.31201, 3189.229,
  3274.35864, 3361.76074, 3451.49536, 3543.62695, 3638.21582, 3735.33179, 3835.0376, 3937.40698,
  4042.50659, 4150.41455, 4261.2002, 4374.94434, 4491.72412, 4611.62207, 4734.71924, 4861.10254,
  4990.86035, 5124.08105, 5260.85742, 5401.28564, 5545.46143, 5693.48633, 5845.46289,
  6001.49512, 6161.69238, 6326.16602, 6495.03027, 6668.40186, 6846.40088, 7029.15186,
  7216.78076, 7409.41748, 7607.19629, 7810.25244, 8018.73486, 8232.77637, 8452.5332, 8678.15625,
  8909.80078, 9147.62988, 9391.80664, 9642.50391, 9899.88965, 10164.1465, 10435.457, 10714.0098,
  10999.998,
];

/** The filter edges recomputed from the recipe (Slaney mel of 30 Hz and 11 kHz, 130 points),
 * for checking the table above: equal within one float32 step. */
export function melEdgesHz(): Float64Array {
  const mels = torchLinspaceF32(slaneyHzToMel(BEAT_FMIN), slaneyHzToMel(BEAT_FMAX), BEAT_MELS + 2);
  const fSp = f32(200 / 3);
  const minLogMel = f32(1000 / (200 / 3));
  const logStep = f32(Math.log(6.4) / 27);
  return Float64Array.from(mels, (mel) => (mel >= minLogMel
    ? f32(1000 * f32(Math.exp(f32(logStep * f32(mel - minLogMel)))))
    : f32(fSp * mel)));
}

/** torchaudio `melscale_fbanks(513, 30, 11000, 128, 22050, norm=None, mel_scale="slaney")`, kept
 * sparse in mel.ts's form so mel.ts's `applyFilterbank` applies it. */
export function beatThisFilterbank(): SparseFilterbank {
  const bins = BEAT_FFT / 2 + 1;
  const allFreqs = torchLinspaceF32(0, Math.floor(BEAT_SR / 2), bins);
  const fPts = Float64Array.from(TORCH_MEL_EDGES_HZ, (hz) => f32(hz));
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
