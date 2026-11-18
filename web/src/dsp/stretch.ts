import {
  STRETCH_IMPLEMENTATION,
  STRETCH_MAX_TEMPO_RATIO,
  STRETCH_MAX_WINDOW_SECONDS,
  STRETCH_MIN_TEMPO_RATIO,
  stretchRefusal,
  StretchUnsupported,
} from './stretchLimits';

/** Bounded pitch-preserving time-stretch (ADR-0459, BF-0459-05), in plain TypeScript.
 *
 * The method is WSOLA (waveform similarity overlap-add, Verhelst and Roelands 1993; as
 * described by Driedger and Mueller, "A Review of Time-Scale Modification of Music Signals",
 * 2016). Output is built from Hann-windowed frames of about 46 ms laid down every half frame.
 * Each frame is read from the input at the nominal position for the tempo ratio, shifted by up
 * to +-10 ms to the spot whose waveform best continues the previous frame, so overlapping frames
 * add in phase instead of cancelling or clicking. Pitch is untouched because samples are never
 * resampled: only which slices of the input are used changes. Multichannel audio shares one
 * shift per frame (chosen on the channel sum), so the stereo image does not wander.
 *
 * Bounds (stretchLimits.ts): the tempo ratio must sit inside 0.92 to 1.08, the native engine's
 * 8 percent audit limit, and one call takes at most 60 seconds of input. Anything outside comes
 * back as the first-class `unsupported_here` state with its reason, never an error and never a
 * worse substitute.
 *
 * ADR-0459 rule, restated so it cannot be "fixed" casually: naive `playbackRate` changes shift
 * pitch along with speed and are never used for musical stretch. This module has no such path.
 * WSOLA is known to double or smear sharp transients a little; stretch.test.ts measures that,
 * and the owner's listening pass is still the gate on calling it good.
 */

export { STRETCH_IMPLEMENTATION, STRETCH_MAX_TEMPO_RATIO, STRETCH_MAX_WINDOW_SECONDS, STRETCH_MIN_TEMPO_RATIO };
export type { StretchUnsupported };

export interface StretchReady {
  status: 'ready';
  channels: Float32Array[];
  sampleRate: number;
  tempoRatio: number;
  implementation: string;
  inputFrames: number;
  outputFrames: number;
}

export type StretchResult = StretchReady | StretchUnsupported;

/** Frame geometry for a sample rate: half frame (synthesis hop), frame and search tolerance. */
export function stretchGeometry(sampleRate: number): { hop: number; frame: number; tolerance: number } {
  const hop = Math.max(64, Math.round(sampleRate * 0.0232));
  return { hop, frame: hop * 2, tolerance: Math.max(16, Math.round(sampleRate * 0.01)) };
}

const unsupported = (reason: string): StretchUnsupported => ({ status: 'unsupported_here', reason, implementation: STRETCH_IMPLEMENTATION });

/** Cross-correlation of guide[a..a+length) with guide[b..b+length), every `step`-th sample;
 * reads outside the input count as silence. */
function correlate(guide: Float32Array, a: number, b: number, length: number, step: number): number {
  // Only indices where both reads land inside the input contribute.
  const first = Math.max(0, -a, -b);
  const last = Math.min(length, guide.length - a, guide.length - b);
  let sum = 0;
  for (let index = first + ((step - (first % step)) % step); index < last; index += step) sum += guide[a + index] * guide[b + index];
  return sum;
}

/** The shift in [-tolerance, tolerance] that best continues the previous frame: a coarse pass
 * on every third shift with every fourth sample, then a fine pass around the winner. */
function bestShift(guide: Float32Array, nominal: number, natural: number, hop: number, tolerance: number): number {
  let best = Number.NEGATIVE_INFINITY;
  let coarse = 0;
  for (let shift = -tolerance; shift <= tolerance; shift += 3) {
    const score = correlate(guide, nominal + shift, natural, hop, 4);
    if (score > best) {
      best = score;
      coarse = shift;
    }
  }
  best = Number.NEGATIVE_INFINITY;
  let fine = coarse;
  for (let shift = Math.max(-tolerance, coarse - 2); shift <= Math.min(tolerance, coarse + 2); shift += 1) {
    const score = correlate(guide, nominal + shift, natural, hop, 1);
    if (score > best) {
      best = score;
      fine = shift;
    }
  }
  return fine;
}

/** Stretch `channels` (equal-length, one Float32Array per channel) by `tempoRatio` (new tempo
 * over old) without changing pitch. The output lasts round(input / tempoRatio) frames. */
export function timeStretch(channels: Float32Array[], sampleRate: number, tempoRatio: number): StretchResult {
  if (!channels || channels.length === 0) return unsupported('there is no audio to stretch');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return unsupported('the audio has no usable sample rate');
  const inputFrames = channels[0].length;
  if (channels.some((channel) => channel.length !== inputFrames)) return unsupported('every channel must be the same length');
  const refusal = stretchRefusal(tempoRatio, inputFrames / sampleRate);
  if (refusal) return unsupported(refusal);

  const { hop, frame, tolerance } = stretchGeometry(sampleRate);
  const outputFrames = Math.round(inputFrames / tempoRatio);
  const analysisHop = hop * tempoRatio;
  const window = new Float32Array(frame);
  for (let index = 0; index < frame; index += 1) window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / frame);

  let guide: Float32Array = channels[0];
  if (channels.length > 1) {
    guide = new Float32Array(inputFrames);
    for (const channel of channels) for (let index = 0; index < inputFrames; index += 1) guide[index] += channel[index];
  }

  const outputs = channels.map(() => new Float32Array(outputFrames));
  // Frame k is centred on output sample k * hop, so frames start half a frame early and every
  // output sample is covered by exactly two windows whose Hann weights sum to one.
  const frames = Math.ceil(outputFrames / hop) + 1;
  let previousStart = -hop;
  for (let k = 0; k < frames; k += 1) {
    const nominal = Math.round(k * analysisHop) - hop;
    const start = k === 0 ? nominal : nominal + bestShift(guide, nominal, previousStart + hop, hop, tolerance);
    const outStart = k * hop - hop;
    for (let channel = 0; channel < channels.length; channel += 1) {
      const input = channels[channel];
      const output = outputs[channel];
      for (let index = 0; index < frame; index += 1) {
        const at = outStart + index;
        if (at < 0 || at >= outputFrames) continue;
        const from = start + index;
        if (from < 0 || from >= inputFrames) continue;
        output[at] += input[from] * window[index];
      }
    }
    previousStart = start;
  }

  return { status: 'ready', channels: outputs, sampleRate, tempoRatio, implementation: STRETCH_IMPLEMENTATION, inputFrames, outputFrames };
}
