/** librosa's mel filterbank, decibels and DCT, as librosa 1.0 computes them.
 *
 * `melFilterbank` is librosa.filters.mel (Slaney mel scale, Slaney area normalisation, float32
 * weights), kept sparse: each filter's nonzero bins only, so a frame costs about two
 * multiply-adds per FFT bin instead of one per bin per filter.
 */

const f32 = Math.fround;

/** librosa.hz_to_mel, Slaney scale. */
export function hzToMel(hz: number): number {
  const fSp = 200 / 3;
  let mel = hz / fSp;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logStep = Math.log(6.4) / 27;
  if (hz >= minLogHz) mel = minLogMel + Math.log(hz / minLogHz) / logStep;
  return mel;
}

/** librosa.mel_to_hz, Slaney scale. */
export function melToHz(mel: number): number {
  const fSp = 200 / 3;
  let hz = fSp * mel;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logStep = Math.log(6.4) / 27;
  if (mel >= minLogMel) hz = minLogHz * Math.exp(logStep * (mel - minLogMel));
  return hz;
}

export interface SparseFilterbank {
  filters: number;
  bins: number;
  /** For each filter, its first nonzero bin and its weights from there. */
  starts: Int32Array;
  weights: Float32Array[];
}

/** librosa.filters.mel(sr, n_fft, n_mels, fmin=0, fmax=sr/2). */
export function melFilterbank(sampleRate: number, nFft: number, nMels: number, fmax = sampleRate / 2): SparseFilterbank {
  const bins = 1 + Math.floor(nFft / 2);
  const fftFreqs = new Float64Array(bins);
  for (let bin = 0; bin < bins; bin += 1) fftFreqs[bin] = (bin * sampleRate) / nFft;
  // mel_frequencies: linspace on the mel scale, back to hertz
  const count = nMels + 2;
  const minMel = hzToMel(0);
  const maxMel = hzToMel(fmax);
  const melF = new Float64Array(count);
  const step = (maxMel - minMel) / (count - 1);
  for (let index = 0; index < count; index += 1) melF[index] = melToHz(index * step + minMel);
  melF[count - 1] = melToHz(maxMel);
  const starts = new Int32Array(nMels);
  const weights: Float32Array[] = [];
  for (let filter = 0; filter < nMels; filter += 1) {
    const lowerDiff = melF[filter + 1] - melF[filter];
    const upperDiff = melF[filter + 2] - melF[filter + 1];
    const enorm = 2 / (melF[filter + 2] - melF[filter]);
    const row = new Float32Array(bins);
    let first = -1;
    let last = -1;
    for (let bin = 0; bin < bins; bin += 1) {
      const lower = -(melF[filter] - fftFreqs[bin]) / lowerDiff;
      const upper = (melF[filter + 2] - fftFreqs[bin]) / upperDiff;
      // weights are stored as float32, then scaled in place by the float64 norm
      const weight = f32(f32(Math.max(0, Math.min(lower, upper))) * enorm);
      row[bin] = weight;
      if (weight !== 0) {
        if (first < 0) first = bin;
        last = bin;
      }
    }
    starts[filter] = Math.max(first, 0);
    weights.push(first < 0 ? new Float32Array(0) : row.slice(first, last + 1));
  }
  return { filters: nMels, bins, starts, weights };
}

/** One frame through the filterbank, summed in float64 and rounded to float32. */
export function applyFilterbank(bank: SparseFilterbank, power: Float32Array, out: Float32Array, offset = 0): void {
  for (let filter = 0; filter < bank.filters; filter += 1) {
    const row = bank.weights[filter];
    const start = bank.starts[filter];
    let total = 0;
    for (let k = 0; k < row.length; k += 1) total += row[k] * power[start + k];
    out[offset + filter] = f32(total);
  }
}

/** librosa.power_to_db(S, ref=1.0, amin=1e-10, top_db) over a whole float32 array, in place. */
export function powerToDbInPlace(values: Float32Array, topDb: number | null = 80): void {
  let top = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const db = f32(10 * f32(Math.log10(f32(Math.max(1e-10, values[index])))));
    values[index] = db;
    if (db > top) top = db;
  }
  if (topDb === null) return;
  const floor = f32(top - topDb);
  for (let index = 0; index < values.length; index += 1) if (values[index] < floor) values[index] = floor;
}

/** The orthonormal DCT-II of `input` (length n), its first `keep` coefficients into `out`
 * (scipy.fft.dct(type=2, norm='ortho')). `table` is from `dctTable`. */
export function dctOrtho(input: ArrayLike<number>, offset: number, n: number, keep: number, table: Float64Array, out: Float32Array, outOffset: number): void {
  for (let k = 0; k < keep; k += 1) {
    let total = 0;
    const row = k * n;
    for (let index = 0; index < n; index += 1) total += input[offset + index] * table[row + index];
    out[outOffset + k] = f32(total);
  }
}

/** Cosines and the orthonormal scale for `dctOrtho`. */
export function dctTable(n: number, keep: number): Float64Array {
  const table = new Float64Array(keep * n);
  for (let k = 0; k < keep; k += 1) {
    const scale = k === 0 ? Math.sqrt(1 / (4 * n)) * 2 : Math.sqrt(1 / (2 * n)) * 2;
    for (let index = 0; index < n; index += 1) table[k * n + index] = scale * Math.cos((Math.PI * k * (2 * index + 1)) / (2 * n));
  }
  return table;
}
