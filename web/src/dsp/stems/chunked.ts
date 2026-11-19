/** Chunked separation of a long stereo window, as demucs's apply_model does it.
 *
 * The model sees fixed segments. Neighbouring segments overlap by `overlap` of a segment and are
 * joined by a linear crossfade (weighted overlap-add, normalised by the summed weights), so no
 * segment edge is audible. The whole window is normalised by its mono mean and deviation before
 * inference and restored after, as demucs normalises a track; here the window stands in for the
 * track, a reduced but stated difference from local mode.
 */

export type SegmentRunner = (left: Float32Array, right: Float32Array) => Promise<Float32Array[]>;

export interface ChunkOptions {
  segmentSamples: number;
  overlap: number;
  /** Output planes per segment (stems x 2). */
  planes: number;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

export class SeparationCancelled extends Error {
  constructor() {
    super('The stem separation was cancelled.');
    this.name = 'AbortError';
  }
}

/** Segment start offsets covering `length` samples. */
export function segmentOffsets(length: number, segmentSamples: number, overlap: number): number[] {
  if (!(segmentSamples > 0)) throw new Error('A segment needs a positive length.');
  if (!(overlap >= 0 && overlap < 1)) throw new Error('Overlap must sit in [0, 1).');
  const stride = Math.max(1, Math.round(segmentSamples * (1 - overlap)));
  const offsets = [0];
  while (offsets[offsets.length - 1] + segmentSamples < length) offsets.push(offsets[offsets.length - 1] + stride);
  return offsets;
}

/** Crossfade weights for one segment: ramps only where a neighbour overlaps it. */
export function segmentWeights(segmentSamples: number, ramp: number, first: boolean, last: boolean): Float32Array {
  const weights = new Float32Array(segmentSamples).fill(1);
  for (let index = 0; index < ramp && index < segmentSamples; index += 1) {
    const rising = (index + 1) / (ramp + 1);
    if (!first) weights[index] = Math.min(weights[index], rising);
    if (!last) weights[segmentSamples - 1 - index] = Math.min(weights[segmentSamples - 1 - index], rising);
  }
  return weights;
}

function stats(left: Float32Array, right: Float32Array): { mean: number; std: number } {
  const length = left.length;
  if (length === 0) return { mean: 0, std: 1 };
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += (left[index] + right[index]) / 2;
  const mean = sum / length;
  let squares = 0;
  for (let index = 0; index < length; index += 1) {
    const centred = (left[index] + right[index]) / 2 - mean;
    squares += centred * centred;
  }
  const std = Math.sqrt(squares / Math.max(1, length - 1));
  return { mean, std: std > 1e-8 ? std : 1 };
}

/** Separate a stereo window. Returns `planes` arrays of the window's length. */
export async function separateChunked(
  left: Float32Array,
  right: Float32Array,
  runSegment: SegmentRunner,
  options: ChunkOptions,
): Promise<Float32Array[]> {
  const { segmentSamples, overlap, planes } = options;
  const length = left.length;
  if (right.length !== length) throw new Error('Both channels of a window must be the same length.');
  const offsets = segmentOffsets(length, segmentSamples, overlap);
  const stride = offsets.length > 1 ? offsets[1] - offsets[0] : segmentSamples;
  const ramp = Math.max(0, segmentSamples - stride);
  const { mean, std } = stats(left, right);
  const out = Array.from({ length: planes }, () => new Float32Array(length));
  const weightSum = new Float32Array(length);
  options.onProgress?.(0, offsets.length);
  for (let segment = 0; segment < offsets.length; segment += 1) {
    if (options.isCancelled?.()) throw new SeparationCancelled();
    const offset = offsets[segment];
    const take = Math.min(segmentSamples, length - offset);
    const segLeft = new Float32Array(segmentSamples);
    const segRight = new Float32Array(segmentSamples);
    for (let index = 0; index < take; index += 1) {
      segLeft[index] = (left[offset + index] - mean) / std;
      segRight[index] = (right[offset + index] - mean) / std;
    }
    const result = await runSegment(segLeft, segRight);
    if (result.length !== planes || result.some((plane) => plane.length !== segmentSamples)) {
      throw new Error('The stem model returned the wrong number or length of channels.');
    }
    const weights = segmentWeights(segmentSamples, ramp, segment === 0, segment === offsets.length - 1);
    for (let plane = 0; plane < planes; plane += 1) {
      const source = result[plane];
      const target = out[plane];
      for (let index = 0; index < take; index += 1) target[offset + index] += source[index] * weights[index];
    }
    for (let index = 0; index < take; index += 1) weightSum[offset + index] += weights[index];
    options.onProgress?.(segment + 1, offsets.length);
  }
  for (const plane of out) {
    for (let index = 0; index < length; index += 1) {
      plane[index] = (plane[index] / (weightSum[index] || 1)) * std + mean;
    }
  }
  return out;
}
