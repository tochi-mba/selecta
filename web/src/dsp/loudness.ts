/** K-weighted integrated loudness and true peak (ADR-0459 Tier 1, BF-0459-02).
 *
 * Integrated loudness follows ITU-R BS.1770-4 as the Python reference (pyloudnorm in
 * `src/selecta/analysis/features.py::loudness`) does: a two-stage K-weighting filter whose
 * coefficients are designed at the given sample rate, 400 ms gating blocks with 75% overlap,
 * an absolute gate at -70 LUFS and a relative gate 10 LU under the ungated mean.
 *
 * True peak uses genuine 4x polyphase FIR oversampling (48-tap windowed sinc, per-phase
 * normalised), not bare linear interpolation, mirroring the reference's 4x resample in
 * `src/selecta/render/dsp.py::true_peaks`. The implementation id states the method so no
 * surface can claim more than was measured.
 *
 * Pure functions over Float32Array channels; deterministic; no Web Audio dependency.
 */

export const LOUDNESS_IMPLEMENTATION = 'bs1770-k-weighted-gated-400ms-v1';
export const TRUE_PEAK_IMPLEMENTATION = 'true-peak-4x-polyphase-fir-48tap-v1';

export const ABSOLUTE_GATE_LUFS = -70;
export const RELATIVE_GATE_LU = 10;
export const BLOCK_SECONDS = 0.4;
export const BLOCK_STEP_SECONDS = 0.1;

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The BS.1770 pre-filter (high shelf) designed from its analog prototype at this rate. */
export function kWeightShelf(sampleRate: number): BiquadCoefficients {
  const gainDb = 3.999843853973347;
  const centreHz = 1681.974450955533;
  const q = 0.7071752369554196;
  const amp = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * centreHz) / sampleRate;
  const cosOmega = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const root = 2 * Math.sqrt(amp) * alpha;
  const a0 = amp + 1 - (amp - 1) * cosOmega + root;
  return {
    b0: (amp * (amp + 1 + (amp - 1) * cosOmega + root)) / a0,
    b1: (-2 * amp * (amp - 1 + (amp + 1) * cosOmega)) / a0,
    b2: (amp * (amp + 1 + (amp - 1) * cosOmega - root)) / a0,
    a1: (2 * (amp - 1 - (amp + 1) * cosOmega)) / a0,
    a2: (amp + 1 - (amp - 1) * cosOmega - root) / a0,
  };
}

/** The BS.1770 RLB high-pass stage at this rate. */
export function kWeightHighpass(sampleRate: number): BiquadCoefficients {
  const centreHz = 38.13547087602444;
  const q = 0.5003270373238773;
  const omega = (2 * Math.PI * centreHz) / sampleRate;
  const cosOmega = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosOmega) / 2 / a0,
    b1: -(1 + cosOmega) / a0,
    b2: (1 + cosOmega) / 2 / a0,
    a1: (-2 * cosOmega) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyBiquad(input: Float64Array, c: BiquadCoefficients): Float64Array {
  const output = new Float64Array(input.length);
  let state1 = 0;
  let state2 = 0;
  for (let index = 0; index < input.length; index += 1) {
    const x = input[index];
    const y = c.b0 * x + state1;
    state1 = c.b1 * x - c.a1 * y + state2;
    state2 = c.b2 * x - c.a2 * y;
    output[index] = y;
  }
  return output;
}

function kWeight(channel: Float32Array, sampleRate: number): Float64Array {
  const wide = Float64Array.from(channel);
  return applyBiquad(applyBiquad(wide, kWeightShelf(sampleRate)), kWeightHighpass(sampleRate));
}

/** Integrated loudness in LUFS, or -Infinity when nothing survives the absolute gate.
 *
 * Channels beyond the first two get the BS.1770 surround weight of 1.41; one or two channels
 * (the SelectaDJ case) weigh 1.0 each.
 */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  if (channels.length === 0 || channels[0].length === 0) {
    return -Infinity;
  }
  const blockSize = Math.round(BLOCK_SECONDS * sampleRate);
  const step = Math.round(BLOCK_STEP_SECONDS * sampleRate);
  const weighted = channels.map((channel) => kWeight(channel, sampleRate));
  const length = Math.min(...weighted.map((channel) => channel.length));
  if (length < blockSize) {
    return -Infinity;
  }
  const blockEnergies: number[] = [];
  for (let start = 0; start + blockSize <= length; start += step) {
    let energy = 0;
    for (let index = 0; index < weighted.length; index += 1) {
      const weight = index < 2 ? 1 : 1.41;
      const channel = weighted[index];
      let sum = 0;
      for (let at = start; at < start + blockSize; at += 1) {
        sum += channel[at] * channel[at];
      }
      energy += (weight * sum) / blockSize;
    }
    blockEnergies.push(energy);
  }
  const toLoudness = (energy: number) => -0.691 + 10 * Math.log10(Math.max(energy, 1e-30));
  const aboveAbsolute = blockEnergies.filter((energy) => toLoudness(energy) > ABSOLUTE_GATE_LUFS);
  if (aboveAbsolute.length === 0) {
    return -Infinity;
  }
  const ungatedMean = aboveAbsolute.reduce((sum, energy) => sum + energy, 0) / aboveAbsolute.length;
  const relativeGate = toLoudness(ungatedMean) - RELATIVE_GATE_LU;
  const kept = aboveAbsolute.filter((energy) => toLoudness(energy) > relativeGate);
  if (kept.length === 0) {
    return -Infinity;
  }
  const mean = kept.reduce((sum, energy) => sum + energy, 0) / kept.length;
  return toLoudness(mean);
}

// --- True peak: 4x polyphase FIR interpolation -------------------------------------------------

const PHASES = 4;
const TAPS_PER_PHASE = 12;
/** The interpolator centres its 12 taps around the sample being estimated. */
const CENTRE_TAP = TAPS_PER_PHASE / 2;

function blackman(position: number, length: number): number {
  const x = (2 * Math.PI * position) / (length - 1);
  return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
}

function sinc(x: number): number {
  if (x === 0) {
    return 1;
  }
  const scaled = Math.PI * x;
  return Math.sin(scaled) / scaled;
}

let polyphaseTaps: Float64Array[] | null = null;

/** 48-tap windowed-sinc interpolation kernel split into 4 phases, each normalised to unit sum. */
export function interpolatorPhases(): Float64Array[] {
  if (polyphaseTaps) {
    return polyphaseTaps;
  }
  const total = PHASES * TAPS_PER_PHASE;
  const centre = (total - 1) / 2;
  const kernel = new Float64Array(total);
  for (let index = 0; index < total; index += 1) {
    kernel[index] = sinc((index - centre) / PHASES) * blackman(index, total);
  }
  const phases: Float64Array[] = [];
  for (let phase = 0; phase < PHASES; phase += 1) {
    const taps = new Float64Array(TAPS_PER_PHASE);
    let sum = 0;
    for (let tap = 0; tap < TAPS_PER_PHASE; tap += 1) {
      taps[tap] = kernel[tap * PHASES + phase];
      sum += taps[tap];
    }
    for (let tap = 0; tap < TAPS_PER_PHASE; tap += 1) {
      taps[tap] /= sum;
    }
    phases.push(taps);
  }
  polyphaseTaps = phases;
  return phases;
}

/** Per-sample true-peak envelope of one channel: max |value| across the 4 interpolated phases
 * around each sample, never below the sample's own |value|. Mirrors the role of
 * `true_peaks` in the Python reference for the limiter's sidechain. */
export function truePeakEnvelope(channel: Float32Array): Float32Array {
  const phases = interpolatorPhases();
  const length = channel.length;
  const envelope = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let peak = Math.abs(channel[index]);
    for (let phase = 0; phase < PHASES; phase += 1) {
      const taps = phases[phase];
      let value = 0;
      for (let tap = 0; tap < TAPS_PER_PHASE; tap += 1) {
        const source = index + CENTRE_TAP - 1 - tap;
        const clamped = source < 0 ? 0 : source >= length ? length - 1 : source;
        value += taps[tap] * channel[clamped];
      }
      const magnitude = Math.abs(value);
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    envelope[index] = peak;
  }
  return envelope;
}

/** True-peak estimate over all channels, in dBTP. */
export function truePeakDb(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    const envelope = truePeakEnvelope(channel);
    for (let index = 0; index < envelope.length; index += 1) {
      if (envelope[index] > peak) {
        peak = envelope[index];
      }
    }
  }
  return 20 * Math.log10(Math.max(peak, 1e-9));
}

/** Plain sample peak in dBFS, for surfaces that must say which number they show. */
export function samplePeakDb(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const magnitude = Math.abs(channel[index]);
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
  }
  return 20 * Math.log10(Math.max(peak, 1e-9));
}
